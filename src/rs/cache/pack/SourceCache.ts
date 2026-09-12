import { XteaMap } from "../../map/XteaMap";
import { CacheInfo } from "../CacheInfo";
import { CacheSystem } from "../CacheSystem";
import { LoadedCache } from "../LoadedCache";
import { MemoryStore } from "../store/MemoryStore";

// A full dat2 cache that packs are resolved against and cut from: the decoded system for walking
// the reference graph, and the store for copying containers out exactly as stored.
export type SourceCache = LoadedCache & {
    readonly store: MemoryStore;
    readonly indexIds: readonly number[];
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
