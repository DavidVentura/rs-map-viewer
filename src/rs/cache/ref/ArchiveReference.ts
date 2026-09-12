import { ArchiveFileReference } from "./ArchiveFileReference";

export class ArchiveReference {
    constructor(
        readonly id: number,
        readonly nameHash: number,
        readonly whirlpool: Int8Array,
        readonly crc: number,
        // Zero when the table records no sizes.
        readonly compressedSize: number,
        readonly decompressedSize: number,
        readonly revision: number,
        readonly fileCount: number,
        readonly lastFileId: number,
        private readonly _fileIdIndexMap: Map<number, number>,
        readonly fileIds: Int32Array,
        readonly fileNameHashes: Int32Array,
    ) {}

    // The same archive listing only the given files, keeping their name hashes, stored as a
    // container of the given sizes. An empty listing gets lastFileId 0, which is what
    // ReferenceTable.decode reads back for it.
    withFiles(
        fileIds: readonly number[],
        compressedSize: number,
        decompressedSize: number,
    ): ArchiveReference {
        const indexMap = new Map<number, number>();
        const nameHashes = new Int32Array(fileIds.length);
        fileIds.forEach((fileId, i) => {
            const sourceIndex = this._fileIdIndexMap.get(fileId);
            if (sourceIndex === undefined) {
                throw new Error(`Archive ${this.id} has no file ${fileId}`);
            }
            indexMap.set(fileId, i);
            nameHashes[i] = this.fileNameHashes ? this.fileNameHashes[sourceIndex] : 0;
        });
        return new ArchiveReference(
            this.id,
            this.nameHash,
            this.whirlpool,
            this.crc,
            compressedSize,
            decompressedSize,
            this.revision,
            fileIds.length,
            fileIds.length > 0 ? fileIds[fileIds.length - 1] : 0,
            indexMap,
            Int32Array.from(fileIds),
            nameHashes,
        );
    }

    getFileReference(id: number): ArchiveFileReference | undefined {
        const i = this._fileIdIndexMap.get(id);
        if (i === undefined) {
            return undefined;
        }

        return new ArchiveFileReference(
            this.fileIds[i],
            id,
            this.fileNameHashes ? this.fileNameHashes[i] : 0,
        );
    }

    get fileReferences(): ArchiveFileReference[] {
        const refs = new Array<ArchiveFileReference>(this.fileIds.length);
        for (let i = 0; i < this.fileIds.length; i++) {
            const ref = this.getFileReference(this.fileIds[i]);
            if (ref) {
                refs[i] = ref;
            }
        }
        return refs;
    }
}
