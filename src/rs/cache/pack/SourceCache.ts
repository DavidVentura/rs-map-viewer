import { XteaMap } from "../../../mapviewer/Caches";
import { CacheInfo } from "../CacheInfo";
import { CacheSystem } from "../CacheSystem";
import { MemoryStore } from "../store/MemoryStore";

// A full dat2 cache that packs are resolved against and cut from: the decoded system for walking
// the reference graph, and the store for copying containers out exactly as stored.
export type SourceCache = {
    readonly info: CacheInfo;
    readonly store: MemoryStore;
    readonly indexIds: readonly number[];
    readonly system: CacheSystem;
    readonly xteas: XteaMap;
};

export function openSourceCache(info: CacheInfo, store: MemoryStore, xteas: XteaMap): SourceCache {
    const indexIds: number[] = [];
    store.indexFiles.forEach((indexFile, indexId) => {
        if (indexFile) {
            indexIds.push(indexId);
        }
    });
    return { info, store, indexIds, system: CacheSystem.fromStore(store, indexIds), xteas };
}
