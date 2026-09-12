import { XteaMap } from "../../map/XteaMap";
import { CacheInfo } from "../CacheInfo";
import { CacheSystem } from "../CacheSystem";
import { LoadedCache } from "../LoadedCache";
import { ArchiveStore } from "../store/ArchiveStore";
import { Dat2ArchiveStore } from "../store/Dat2ArchiveStore";
import { MemoryStore } from "../store/MemoryStore";

// A full dat2 cache that packs are resolved against and cut from: the decoded system for walking
// the reference graph, and the store for copying archives out decompressed and decrypted.
export type SourceCache = LoadedCache & {
    readonly store: ArchiveStore;
    readonly indexIds: readonly number[];
};

export function openSourceCache(
    info: CacheInfo,
    containers: MemoryStore,
    mapKeys: XteaMap,
): SourceCache {
    const store = new Dat2ArchiveStore(containers, mapKeys);
    const indexIds = containers.indexIds();
    return { info, store, indexIds, system: CacheSystem.fromStore(store, indexIds) };
}
