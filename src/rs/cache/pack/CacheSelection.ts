// What a pack carries of one archive: the container as stored, or only some of its files
// re-encoded (config archives, whose compression unit holds thousands of unrelated types).
export type ArchiveSelection =
    | { readonly kind: "WHOLE" }
    | { readonly kind: "FILES"; readonly fileIds: readonly number[] };

export type SelectedArchive = {
    readonly indexId: number;
    readonly archiveId: number;
    readonly selection: ArchiveSelection;
};

// Ordered by index then archive, file ids ascending, so equal selections are equal values.
export type CacheSelection = readonly SelectedArchive[];

const WHOLE: ArchiveSelection = { kind: "WHOLE" };

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
    let value = map.get(key);
    if (value === undefined) {
        value = create();
        map.set(key, value);
    }
    return value;
}

// Accumulates a selection while the resolver walks the cache. A whole archive absorbs any files
// also requested from it.
export class CacheSelectionBuilder {
    private readonly wholeArchives = new Map<number, Set<number>>();
    private readonly archiveFiles = new Map<number, Map<number, Set<number>>>();

    // True the first time the archive is selected.
    addWhole(indexId: number, archiveId: number): boolean {
        const archives = getOrCreate(this.wholeArchives, indexId, () => new Set<number>());
        if (archives.has(archiveId)) {
            return false;
        }
        archives.add(archiveId);
        return true;
    }

    // Selects the archive even if none of its files end up selected, for archives the engine
    // opens unconditionally.
    addArchive(indexId: number, archiveId: number): void {
        const archives = getOrCreate(this.archiveFiles, indexId, () => new Map());
        getOrCreate(archives, archiveId, () => new Set<number>());
    }

    // True the first time the file is selected.
    addFile(indexId: number, archiveId: number, fileId: number): boolean {
        const archives = getOrCreate(this.archiveFiles, indexId, () => new Map());
        const files = getOrCreate(archives, archiveId, () => new Set<number>());
        if (files.has(fileId)) {
            return false;
        }
        files.add(fileId);
        return true;
    }

    build(): CacheSelection {
        const byKey = new Map<string, SelectedArchive>();
        for (const [indexId, archives] of this.archiveFiles) {
            for (const [archiveId, files] of archives) {
                const fileIds = [...files].sort((a, b) => a - b);
                byKey.set(`${indexId}:${archiveId}`, {
                    indexId,
                    archiveId,
                    selection: { kind: "FILES", fileIds },
                });
            }
        }
        for (const [indexId, archives] of this.wholeArchives) {
            for (const archiveId of archives) {
                byKey.set(`${indexId}:${archiveId}`, { indexId, archiveId, selection: WHOLE });
            }
        }
        return [...byKey.values()].sort(
            (a, b) => a.indexId - b.indexId || a.archiveId - b.archiveId,
        );
    }
}
