import { Bzip2 } from "../compression/Bzip2";
import { Gzip } from "../compression/Gzip";
import { ByteBuffer } from "../io/ByteBuffer";
import { XteaMap } from "../map/XteaMap";
import { StringUtil } from "../util/StringUtil";
import { ApiType } from "./ApiType";
import { Archive } from "./Archive";
import { ArchiveFile } from "./ArchiveFile";
import { CacheFiles } from "./CacheFiles";
import { CacheIndex } from "./CacheIndex";
import { CacheSystem } from "./CacheSystem";
import { CacheType } from "./CacheType";
import { IndexType } from "./IndexType";
import { ReferenceTable } from "./ref/ReferenceTable";
import { CacheStore } from "./store/CacheStore";
import { Dat2ArchiveStore } from "./store/Dat2ArchiveStore";
import { MemoryStore } from "./store/MemoryStore";
import { SectorCluster } from "./store/SectorCluster";

// Full caches as the Node side reads them from disk, in every format the engine decodes. The
// browser only ever opens packs, whose archives were decoded here when they were cut.

function decodeOldArchive(id: number, data: Int8Array, multipleFiles: boolean): Archive {
    const buffer = new ByteBuffer(data);
    const files = new Map<number, ArchiveFile>();

    let fileCount: number;
    let fileIds: Int32Array;
    let fileNameHashes: Int32Array;
    if (multipleFiles) {
        const actualSize = buffer.readMedium();
        const size = buffer.readMedium();

        const isCompressed = actualSize !== size;

        let dataBuffer: ByteBuffer;
        let metaBuffer: ByteBuffer;
        if (isCompressed) {
            const data = buffer.readUnsignedBytes(size);
            const decompressed = Bzip2.decompress(data, actualSize);
            dataBuffer = new ByteBuffer(decompressed);
            metaBuffer = new ByteBuffer(decompressed);
        } else {
            dataBuffer = new ByteBuffer(data);
            metaBuffer = buffer;
        }

        fileCount = metaBuffer.readUnsignedShort();
        dataBuffer.offset = metaBuffer.offset + fileCount * 10;

        fileIds = new Int32Array(fileCount);
        fileNameHashes = new Int32Array(fileCount);
        for (let i = 0; i < fileCount; i++) {
            const nameHash = metaBuffer.readInt();
            const fileActualSize = metaBuffer.readMedium();
            const fileSize = metaBuffer.readMedium();

            let decompressedFile: Int8Array;
            if (isCompressed) {
                decompressedFile = dataBuffer.readBytes(fileSize);
            } else {
                const data = dataBuffer.readUnsignedBytes(fileSize);
                decompressedFile = Bzip2.decompress(data, fileActualSize);
            }
            files.set(i, new ArchiveFile(i, id, decompressedFile));
            fileIds[i] = i;
            fileNameHashes[i] = nameHash;
        }
    } else {
        const decompressed = Gzip.decompress(buffer.readUnsignedBytes(buffer.remaining));

        fileCount = 1;
        fileIds = new Int32Array(fileCount);
        fileNameHashes = new Int32Array(fileCount);
        files.set(0, new ArchiveFile(0, id, decompressed));
    }

    const lastFileId = fileCount - 1;

    return new Archive(
        StringUtil.hashOld,
        id,
        lastFileId,
        fileCount,
        fileIds,
        fileNameHashes,
        files,
    );
}

class CacheIndexDat extends CacheIndex {
    static fromStore(
        id: number,
        store: CacheStore<ApiType.SYNC>,
        indexFile: ArrayBuffer,
    ): CacheIndexDat {
        const table = ReferenceTable.fromArchiveCount(indexFile.byteLength / SectorCluster.SIZE);
        return new CacheIndexDat(id, table, store);
    }

    constructor(
        id: number,
        table: ReferenceTable,
        readonly store: CacheStore<ApiType.SYNC>,
    ) {
        super(id, table);
    }

    override getArchive(id: number): Archive {
        const data = this.store.read(this.id, id);
        return decodeOldArchive(id, data, this.id === IndexType.DAT.configs);
    }

    override getFile(archiveId: number, fileId: number): ArchiveFile | undefined {
        return this.getArchive(archiveId).getFile(fileId);
    }
}

class LegacyCacheIndex extends CacheIndex {
    constructor(
        readonly id: number,
        readonly archives: Archive[],
        readonly archiveNameHashes: Map<number, number> = new Map(),
    ) {
        super(id, ReferenceTable.INVALID_TABLE);
    }

    override getArchive(archiveId: number): Archive {
        return this.archives[archiveId];
    }

    override getArchiveId(name: string): number {
        return this.archiveNameHashes.get(StringUtil.hashOld(name)) ?? -1;
    }

    override getFile(archiveId: number, fileId: number): ArchiveFile | undefined {
        return this.archives[archiveId]?.getFile(fileId);
    }
}

function loadLegacy(cacheFiles: CacheFiles): CacheSystem {
    const configData = cacheFiles.files.get("config");
    if (!configData) {
        throw new Error("Missing config file");
    }
    const configArchive = decodeOldArchive(0, new Int8Array(configData), true);
    const configIndex = new LegacyCacheIndex(IndexType.LEGACY.configs, [configArchive]);

    const mediaData = cacheFiles.files.get("media");
    if (!mediaData) {
        throw new Error("Missing media file");
    }
    const mediaArchive = decodeOldArchive(0, new Int8Array(mediaData), true);
    const mediaIndex = new LegacyCacheIndex(IndexType.LEGACY.media, [mediaArchive]);

    const textureData = cacheFiles.files.get("textures");
    if (!textureData) {
        throw new Error("Missing textures file");
    }
    const textureArchive = decodeOldArchive(0, new Int8Array(textureData), true);
    const textureIndex = new LegacyCacheIndex(IndexType.LEGACY.textures, [textureArchive]);

    const modelData = cacheFiles.files.get("models");
    if (!modelData) {
        throw new Error("Missing models file");
    }
    const modelArchive = decodeOldArchive(0, new Int8Array(modelData), true);
    const modelIndex = new LegacyCacheIndex(IndexType.LEGACY.models, [modelArchive]);

    const mapsPrefix = "maps/";
    const mapArchives: Archive[] = [];
    const mapArchiveNameHashes = new Map<number, number>();
    for (const [name, data] of cacheFiles.files) {
        if (!name.startsWith(mapsPrefix)) {
            continue;
        }
        const archiveName = name.substring(mapsPrefix.length);
        const archiveId = mapArchives.length;
        mapArchives.push(Archive.create(archiveId, new Int8Array(data)));
        mapArchiveNameHashes.set(StringUtil.hashOld(archiveName), archiveId);
    }
    const mapIndex = new LegacyCacheIndex(IndexType.LEGACY.maps, mapArchives, mapArchiveNameHashes);

    return new CacheSystem([configIndex, mediaIndex, textureIndex, modelIndex, mapIndex]);
}

export function openCacheFiles(
    cacheType: CacheType,
    cacheFiles: CacheFiles,
    mapKeys: XteaMap,
): CacheSystem {
    switch (cacheType) {
        case "legacy":
            return loadLegacy(cacheFiles);
        case "dat": {
            const store = MemoryStore.fromFiles(cacheFiles);
            return new CacheSystem(
                store.indexFiles.map(
                    (indexFile, id) => indexFile && CacheIndexDat.fromStore(id, store, indexFile),
                ),
            );
        }
        case "dat2": {
            const store = MemoryStore.fromFiles(cacheFiles);
            return CacheSystem.fromStore(new Dat2ArchiveStore(store, mapKeys), store.indexIds());
        }
    }
    throw new Error("Not implemented");
}
