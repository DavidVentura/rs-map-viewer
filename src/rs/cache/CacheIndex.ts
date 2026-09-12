import { ByteBuffer } from "../io/ByteBuffer";
import { ApiReturnType, ApiType } from "./ApiType";
import { Archive } from "./Archive";
import { ArchiveFile } from "./ArchiveFile";
import { ArchiveReference } from "./ref/ArchiveReference";
import { ReferenceTable } from "./ref/ReferenceTable";
import { ArchiveStore } from "./store/ArchiveStore";

export abstract class CacheIndex<A extends ApiType = ApiType.SYNC> {
    static META_INDEX_ID = 255;

    constructor(
        readonly id: number,
        readonly table: ReferenceTable,
    ) {}

    getArchiveIds(): Int32Array {
        return this.table.archiveIds;
    }

    getArchiveCount(): number {
        return this.table.archiveCount;
    }

    getLastArchiveId(): number {
        return this.table.lastArchiveId;
    }

    getArchiveReference(archiveId: number): ArchiveReference | undefined {
        return this.table.getArchiveReference(archiveId);
    }

    getArchiveId(name: string): number {
        return this.table.getArchiveId(name) ?? -1;
    }

    getFileIds(archiveId: number): Int32Array | undefined {
        return this.getArchiveReference(archiveId)?.fileIds;
    }

    archiveExists(archiveId: number): boolean {
        return this.table.archiveExists(archiveId);
    }

    getFileCount(archiveId: number): number {
        return this.table.getArchiveReference(archiveId)?.fileCount ?? 0;
    }

    abstract getArchive(archiveId: number): ApiReturnType<A, Archive>;

    abstract getFile(archiveId: number, fileId: number): ApiReturnType<A, ArchiveFile | undefined>;

    // A one-file archive named by the id comes first: in a pack's subset table a one-file-per-archive
    // index can list a single archive, which the archive count alone would misread as one archive
    // holding every file.
    getFileSmart(id: number): ApiReturnType<A, ArchiveFile | undefined> {
        if (this.getFileCount(id) === 1) {
            return this.getFile(id, 0);
        } else if (this.getArchiveCount() === 1) {
            return this.getFile(0, id);
        }
        throw new Error("Invalid archive");
    }
}

export class CacheIndexDat2 extends CacheIndex {
    static fromStore(id: number, store: ArchiveStore): CacheIndexDat2 {
        const data = store.read(CacheIndex.META_INDEX_ID, id);
        try {
            return new CacheIndexDat2(id, ReferenceTable.decode(new ByteBuffer(data)), store);
        } catch (e) {
            console.error(data, e);
            throw new Error("Failed to decode index: " + id);
        }
    }

    constructor(
        id: number,
        table: ReferenceTable,
        readonly store: ArchiveStore,
    ) {
        super(id, table);
    }

    override getArchive(id: number): Archive {
        const archiveRef = this.getArchiveReference(id);
        if (!archiveRef) {
            throw new Error("Archive reference not found for: " + id);
        }
        return Archive.decode(
            id,
            archiveRef.lastFileId,
            archiveRef.fileCount,
            archiveRef.fileIds,
            archiveRef.fileNameHashes,
            new ByteBuffer(this.store.read(this.id, id)),
        );
    }

    override getFile(archiveId: number, fileId: number): ArchiveFile | undefined {
        return this.getArchive(archiveId).getFile(fileId);
    }
}
