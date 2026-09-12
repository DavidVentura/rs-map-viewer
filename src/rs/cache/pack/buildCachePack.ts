import { Archive } from "../Archive";
import { ArchiveFile } from "../ArchiveFile";
import { CacheIndex } from "../CacheIndex";
import { Container } from "../Container";
import { IndexType } from "../IndexType";
import { ArchiveReference } from "../ref/ArchiveReference";
import { ReferenceTable } from "../ref/ReferenceTable";
import { CachePack, CachePackEntry } from "./CachePack";
import { CacheSelection, SelectedArchive } from "./CacheSelection";
import { SourceCache } from "./SourceCache";

type PackedArchive = {
    readonly reference: ArchiveReference;
    readonly data: Int8Array;
};

// Re-encoded uncompressed: the pack is compressed as a whole in transit, and recompressing here
// would only cost build time.
function packFileSubset(
    index: CacheIndex,
    reference: ArchiveReference,
    fileIds: readonly number[],
): PackedArchive {
    const archive = index.getArchive(reference.id);
    const files = fileIds.map((fileId): ArchiveFile => {
        const file = archive.getFile(fileId);
        if (!file) {
            throw new Error(`Index ${index.id} archive ${reference.id} has no file ${fileId}`);
        }
        return file;
    });
    const archiveData = Archive.encode(files);
    const data = Container.encodeUncompressed(archiveData);
    return { reference: reference.withFiles(fileIds, data.length, archiveData.length), data };
}

function packArchive(
    source: SourceCache,
    index: CacheIndex,
    selected: SelectedArchive,
): PackedArchive {
    const reference = index.getArchiveReference(selected.archiveId);
    if (!reference) {
        throw new Error(`Index ${index.id} has no archive ${selected.archiveId}`);
    }
    switch (selected.selection.kind) {
        case "WHOLE":
            return { reference, data: source.store.read(index.id, selected.archiveId) };
        case "FILES":
            return packFileSubset(index, reference, selected.selection.fileIds);
    }
}

// A sparse cache: for every index of the source, a reference table listing only the selected
// archives (and, for partly selected archives, only the selected files), plus those archives.
export function buildCachePack(source: SourceCache, selection: CacheSelection): CachePack {
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
            packArchive(source, index, selected),
        );
        const table = ReferenceTable.encode(
            index.table.format,
            packed.map(({ reference }) => reference),
        );
        entries.push({
            indexId: CacheIndex.META_INDEX_ID,
            archiveId: indexId,
            data: Container.encodeUncompressed(table),
        });
        for (const { reference, data } of packed) {
            entries.push({ indexId, archiveId: reference.id, data });
        }
    }

    const xteas: Record<string, readonly number[]> = {};
    for (const selected of selectedByIndex.get(IndexType.DAT2.maps) ?? []) {
        const key = source.xteas.get(selected.archiveId);
        if (key) {
            xteas[String(selected.archiveId)] = key;
        }
    }

    return {
        header: { cacheInfo: source.info, indexIds: source.indexIds, xteas },
        entries,
    };
}
