import { Archive } from "../Archive";
import { ArchiveFile } from "../ArchiveFile";
import { CacheIndex } from "../CacheIndex";
import { ArchiveReference } from "../ref/ArchiveReference";
import { ReferenceTable } from "../ref/ReferenceTable";
import { CachePackEntry, SparseCache } from "./CachePack";
import { CacheSelection, SelectedArchive } from "./CacheSelection";
import { SourceCache } from "./SourceCache";

type PackedArchive = {
    readonly reference: ArchiveReference;
    readonly data: Int8Array;
};

// Cuts packs out of one source cache. Built once per source: the archives packs take only some
// files of (config archives, a handful of large ones) stay decoded across builds.
export class CachePackBuilder {
    private readonly decodedArchives = new Map<string, Archive>();

    constructor(private readonly source: SourceCache) {}

    // A sparse cache: for every index of the source, a reference table listing only the selected
    // archives (and, for partly selected archives, only the selected files), plus those archives.
    build(selection: CacheSelection): SparseCache {
        const { source } = this;
        const selectedByIndex = new Map<number, SelectedArchive[]>();
        for (const selected of selection) {
            if (!source.indexIds.includes(selected.indexId)) {
                throw new Error(`Selection names index ${selected.indexId}, which the cache lacks`);
            }
            const archives = selectedByIndex.get(selected.indexId) ?? [];
            archives.push(selected);
            selectedByIndex.set(selected.indexId, archives);
        }

        const entries: CachePackEntry[] = [];
        for (const indexId of source.indexIds) {
            const index = source.system.getIndex(indexId);
            const packed = (selectedByIndex.get(indexId) ?? []).map((selected) =>
                this.packArchive(index, selected),
            );
            const table = ReferenceTable.encode(
                index.table.format,
                packed.map(({ reference }) => reference),
            );
            entries.push({ indexId: CacheIndex.META_INDEX_ID, archiveId: indexId, data: table });
            for (const { reference, data } of packed) {
                entries.push({ indexId, archiveId: reference.id, data });
            }
        }

        return {
            header: { cacheInfo: source.info, indexIds: source.indexIds },
            entries,
        };
    }

    private packArchive(index: CacheIndex, selected: SelectedArchive): PackedArchive {
        const reference = index.getArchiveReference(selected.archiveId);
        if (!reference) {
            throw new Error(`Index ${index.id} has no archive ${selected.archiveId}`);
        }
        switch (selected.selection.kind) {
            case "WHOLE":
                return {
                    reference,
                    data: this.source.store.read(index.id, selected.archiveId),
                };
            case "FILES":
                return this.packFileSubset(index, reference, selected.selection.fileIds);
        }
    }

    // Re-encoded as plain archive data like every other entry: the browser has no decompressor, and
    // the pack is compressed as a whole in transit.
    private packFileSubset(
        index: CacheIndex,
        reference: ArchiveReference,
        fileIds: readonly number[],
    ): PackedArchive {
        const archive = this.decodedArchive(index, reference.id);
        const files = fileIds.map((fileId): ArchiveFile => {
            const file = archive.getFile(fileId);
            if (!file) {
                throw new Error(`Index ${index.id} archive ${reference.id} has no file ${fileId}`);
            }
            return file;
        });
        const data = Archive.encode(files);
        return { reference: reference.withFiles(fileIds, data.length), data };
    }

    private decodedArchive(index: CacheIndex, archiveId: number): Archive {
        const key = `${index.id}:${archiveId}`;
        let archive = this.decodedArchives.get(key);
        if (!archive) {
            archive = index.getArchive(archiveId);
            this.decodedArchives.set(key, archive);
        }
        return archive;
    }
}
