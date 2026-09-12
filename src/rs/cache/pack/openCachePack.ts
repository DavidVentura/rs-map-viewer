import { MapSpawns } from "../../map/MapSpawns";
import { CacheSystem } from "../CacheSystem";
import { LoadedCache } from "../LoadedCache";
import { decodeCachePack } from "./CachePack";
import { PackCacheStore } from "./PackCacheStore";

export type OpenedCachePack = {
    readonly cache: LoadedCache;
    readonly spawns: MapSpawns;
};

// The main thread and every render worker open the same pack bytes, each into its own cache.
export function openCachePack(buffer: ArrayBufferLike): OpenedCachePack {
    const pack = decodeCachePack(buffer);
    return {
        cache: {
            info: pack.header.cacheInfo,
            system: CacheSystem.fromStore(new PackCacheStore(pack), pack.header.indexIds),
        },
        spawns: pack.spawns,
    };
}
