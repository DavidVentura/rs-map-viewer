import { ByteBuffer } from "../../io/ByteBuffer";
import { ByteWriter } from "../../io/ByteWriter";
import { StringUtil } from "../../util/StringUtil";
import { ArchiveReference } from "./ArchiveReference";

const FLAG_NAMED = 0x1;
const FLAG_WHIRLPOOL = 0x2;
const FLAG_SIZES = 0x4;

const WHIRLPOOL_SIZE = 64;

export type ReferenceTableFormat = {
    readonly protocol: number;
    readonly revision: number;
    readonly named: boolean;
    readonly usesWhirlpool: boolean;
    readonly hasSizes: boolean;
};

function assertAscending(kind: string, ids: ArrayLike<number>): void {
    for (let i = 1; i < ids.length; i++) {
        if (ids[i] <= ids[i - 1]) {
            throw new Error(`Reference table ${kind} ids must ascend: ${ids[i - 1]}, ${ids[i]}`);
        }
    }
}

export class ReferenceTable {
    static INVALID_TABLE = new ReferenceTable(
        -1,
        -1,
        false,
        false,
        false,
        0,
        -1,
        new Map(),
        new Int32Array(),
        new Int32Array(),
        [],
        new DataView(new ArrayBuffer(0)),
        new DataView(new ArrayBuffer(0)),
        new DataView(new ArrayBuffer(0)),
        new Int32Array(),
        new Int32Array(),
        [],
        [],
    );

    static fromArchiveCount(archiveCount: number): ReferenceTable {
        const archiveIds = new Int32Array(archiveCount);
        const archiveIdIndexMap: Map<number, number> = new Map();
        for (let i = 0; i < archiveCount; i++) {
            archiveIds[i] = i;
            archiveIdIndexMap.set(i, i);
        }
        const lastArchiveId = archiveCount - 1;

        const archiveNameHashes = new Int32Array(archiveCount);
        const archiveWhirlpools = new Array<Int8Array>(archiveCount);

        const archiveFileCounts = new Int32Array(archiveCount).fill(-1);

        const archiveFileIds = new Array<Int32Array>(archiveCount);
        const archiveLastFileIds = new Int32Array(archiveCount);

        const archiveFileNameHashes = new Array<Int32Array>(archiveCount);

        return new ReferenceTable(
            -1,
            -1,
            false,
            false,
            false,
            archiveCount,
            lastArchiveId,
            archiveIdIndexMap,
            archiveIds,
            archiveNameHashes,
            archiveWhirlpools,
            new DataView(new ArrayBuffer(archiveCount * 4)),
            new DataView(new ArrayBuffer(0)),
            new DataView(new ArrayBuffer(archiveCount * 4)),
            archiveFileCounts,
            archiveLastFileIds,
            archiveFileIds,
            archiveFileNameHashes,
        );
    }

    // The inverse of decode. Uncompressed crcs are never written, since decode does not read them.
    static encode(format: ReferenceTableFormat, archives: readonly ArchiveReference[]): Int8Array {
        const { protocol, named, usesWhirlpool, hasSizes } = format;
        if (protocol < 5 || protocol > 7) {
            throw new Error("Invalid protocol: " + protocol);
        }
        assertAscending(
            "archive",
            archives.map((archive) => archive.id),
        );

        const writer = new ByteWriter();
        const writeCount = (value: number) => {
            if (protocol === 7) {
                writer.writeBigSmart(value);
                return;
            }
            if (value > 0xffff) {
                throw new Error(`Reference table protocol ${protocol} cannot hold ${value}`);
            }
            writer.writeShort(value);
        };

        writer.writeByte(protocol);
        if (protocol > 5) {
            writer.writeInt(format.revision);
        }
        writer.writeByte(
            (named ? FLAG_NAMED : 0) |
                (usesWhirlpool ? FLAG_WHIRLPOOL : 0) |
                (hasSizes ? FLAG_SIZES : 0),
        );
        writeCount(archives.length);

        let lastArchiveId = 0;
        for (const archive of archives) {
            writeCount(archive.id - lastArchiveId);
            lastArchiveId = archive.id;
        }
        if (named) {
            for (const archive of archives) {
                writer.writeInt(archive.nameHash);
            }
        }
        if (usesWhirlpool) {
            for (const archive of archives) {
                if (archive.whirlpool.length !== WHIRLPOOL_SIZE) {
                    throw new Error(`Archive ${archive.id} has no whirlpool digest`);
                }
                writer.writeBytes(archive.whirlpool);
            }
        }
        for (const archive of archives) {
            writer.writeInt(archive.crc);
        }
        if (hasSizes) {
            for (const archive of archives) {
                writer.writeInt(archive.compressedSize);
                writer.writeInt(archive.decompressedSize);
            }
        }
        for (const archive of archives) {
            writer.writeInt(archive.revision);
        }
        for (const archive of archives) {
            writeCount(archive.fileIds.length);
        }
        for (const archive of archives) {
            assertAscending(`archive ${archive.id} file`, archive.fileIds);
            let lastFileId = 0;
            for (const fileId of archive.fileIds) {
                writeCount(fileId - lastFileId);
                lastFileId = fileId;
            }
        }
        if (named) {
            for (const archive of archives) {
                for (let i = 0; i < archive.fileIds.length; i++) {
                    writer.writeInt(archive.fileNameHashes[i]);
                }
            }
        }
        return writer.toBytes();
    }

    static decode(buffer: ByteBuffer): ReferenceTable {
        const protocol = buffer.readUnsignedByte();
        if (protocol < 5 || protocol > 7) {
            throw new Error("Invalid protocol: " + protocol);
        }
        const revision = protocol > 5 ? buffer.readInt() : 0;
        const flag = buffer.readUnsignedByte();
        const hasNames = (flag & 0x1) !== 0;
        const hasWhirlpool = (flag & 0x2) !== 0;
        const hasSizes = (flag & 0x4) !== 0;
        const hasUncompressedCrcs = (flag & 0x8) !== 0;
        const archiveCount = protocol === 7 ? buffer.readBigSmart() : buffer.readUnsignedShort();

        let lastArchiveId = 0;
        const archiveIds = new Int32Array(archiveCount);
        const archiveIdIndexMap: Map<number, number> = new Map();
        if (protocol === 7) {
            for (let i = 0; i < archiveCount; i++) {
                lastArchiveId += buffer.readBigSmart();
                archiveIds[i] = lastArchiveId;
                archiveIdIndexMap.set(lastArchiveId, i);
            }
        } else {
            for (let i = 0; i < archiveCount; i++) {
                lastArchiveId += buffer.readUnsignedShort();
                archiveIds[i] = lastArchiveId;
                archiveIdIndexMap.set(lastArchiveId, i);
            }
        }

        const archiveNameHashes = new Int32Array(archiveCount);
        if (hasNames) {
            for (let i = 0; i < archiveCount; i++) {
                archiveNameHashes[i] = buffer.readInt();
            }
        }

        const archiveWhirlpools = new Array<Int8Array>(archiveCount);
        if (hasWhirlpool) {
            for (let i = 0; i < archiveCount; i++) {
                archiveWhirlpools[i] = buffer.readBytes(64);
            }
        }

        // buffer.data may be a view into a larger buffer (an uncompressed container, or a cache
        // pack's entry), so the views are anchored to its byteOffset.
        const archiveCrcs = new DataView(
            buffer.data.buffer,
            buffer.data.byteOffset + buffer.offset,
            archiveCount * 4,
        );
        buffer.offset += archiveCrcs.byteLength;

        const archiveSizes = new DataView(
            buffer.data.buffer,
            buffer.data.byteOffset + buffer.offset,
            hasSizes ? archiveCount * 8 : 0,
        );
        buffer.offset += archiveSizes.byteLength;

        const archiveRevisions = new DataView(
            buffer.data.buffer,
            buffer.data.byteOffset + buffer.offset,
            archiveCount * 4,
        );
        buffer.offset += archiveRevisions.byteLength;

        const archiveFileCounts = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveFileCounts[i] =
                protocol === 7 ? buffer.readBigSmart() : buffer.readUnsignedShort();
        }

        const archiveFileIds = new Array<Int32Array>(archiveCount);
        const archiveLastFileIds = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveFileIds[i] = new Int32Array(archiveFileCounts[i]);
        }
        for (let archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
            let lastFileId = 0;
            for (let fileIdx = 0; fileIdx < archiveFileCounts[archiveIdx]; fileIdx++) {
                lastFileId += protocol === 7 ? buffer.readBigSmart() : buffer.readUnsignedShort();
                archiveFileIds[archiveIdx][fileIdx] = lastFileId;
            }
            archiveLastFileIds[archiveIdx] = lastFileId;
        }

        const archiveFileNameHashes = new Array<Int32Array>(archiveCount);
        if (hasNames) {
            for (let i = 0; i < archiveCount; i++) {
                archiveFileNameHashes[i] = new Int32Array(archiveFileCounts[i]);
            }
            for (let archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
                for (let fileIdx = 0; fileIdx < archiveFileCounts[archiveIdx]; fileIdx++) {
                    archiveFileNameHashes[archiveIdx][fileIdx] = buffer.readInt();
                }
            }
        }

        return new ReferenceTable(
            protocol,
            revision,
            hasNames,
            hasWhirlpool,
            hasSizes,
            archiveCount,
            lastArchiveId,
            archiveIdIndexMap,
            archiveIds,
            archiveNameHashes,
            archiveWhirlpools,
            archiveCrcs,
            archiveSizes,
            archiveRevisions,
            archiveFileCounts,
            archiveLastFileIds,
            archiveFileIds,
            archiveFileNameHashes,
        );
    }

    constructor(
        readonly protocol: number,
        readonly revision: number,
        readonly named: boolean,
        readonly usesWhirlpool: boolean,
        readonly hasSizes: boolean,
        readonly archiveCount: number,
        readonly lastArchiveId: number,
        private readonly _archiveIdIndexMap: Map<number, number>,
        readonly archiveIds: Int32Array,
        private readonly _archiveNameHashes: Int32Array,
        private readonly _archiveWhirlpools: Int8Array[],
        private readonly _archiveCrcs: DataView,
        private readonly _archiveSizes: DataView,
        private readonly _archiveRevisions: DataView,
        private readonly _archiveFileCounts: Int32Array,
        private readonly _archiveLastFileIds: Int32Array,
        private readonly _archiveFileIds: Int32Array[],
        private readonly _archiveFileNameHashes: Int32Array[],
        private readonly _archiveNameHashIdMap: Map<number, number> = new Map(),
    ) {
        if (named) {
            for (let i = 0; i < this.archiveIds.length; i++) {
                this._archiveNameHashIdMap.set(this._archiveNameHashes[i], this.archiveIds[i]);
            }
        }
    }

    get format(): ReferenceTableFormat {
        return {
            protocol: this.protocol,
            revision: this.revision,
            named: this.named,
            usesWhirlpool: this.usesWhirlpool,
            hasSizes: this.hasSizes,
        };
    }

    getArchiveId(name: string): number | undefined {
        return this._archiveNameHashIdMap.get(StringUtil.hashDjb2(name));
    }

    archiveExists(id: number): boolean {
        return this._archiveIdIndexMap.has(id);
    }

    getArchiveReference(id: number): ArchiveReference | undefined {
        const i = this._archiveIdIndexMap.get(id);
        if (i === undefined) {
            return undefined;
        }

        const nameHash = this._archiveNameHashes[i];
        const whirlpool = this._archiveWhirlpools[i];
        const crc = this._archiveCrcs.getInt32(i * 4, false);
        const compressedSize = this.hasSizes ? this._archiveSizes.getInt32(i * 8, false) : 0;
        const decompressedSize = this.hasSizes ? this._archiveSizes.getInt32(i * 8 + 4, false) : 0;
        const revision = this._archiveRevisions.getInt32(i * 4, false);
        const fileCount = this._archiveFileCounts[i];
        const lastFileId = this._archiveLastFileIds[i];
        const fileIds = this._archiveFileIds[i];
        const fileNameHashes = this._archiveFileNameHashes[i];

        const fileIdIndexMap: Map<number, number> = new Map();
        for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
            fileIdIndexMap.set(fileIds[fileIdx], fileIdx);
        }
        return new ArchiveReference(
            id,
            nameHash,
            whirlpool,
            crc,
            compressedSize,
            decompressedSize,
            revision,
            fileCount,
            lastFileId,
            fileIdIndexMap,
            fileIds,
            fileNameHashes,
        );
    }

    get archiveReferences(): ArchiveReference[] {
        const refs = new Array<ArchiveReference>(this.archiveIds.length);
        for (let i = 0; i < this.archiveIds.length; i++) {
            const ref = this.getArchiveReference(this.archiveIds[i]);
            if (ref) {
                refs[i] = ref;
            }
        }
        return refs;
    }
}
