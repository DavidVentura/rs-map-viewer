import { xteaMapFromRecord } from "../../map/XteaMap";
import { CacheSystem } from "../CacheSystem";
import { LoadedCache } from "../LoadedCache";
import { decodeCachePack } from "./CachePack";
import { PackCacheStore } from "./PackCacheStore";

// The main thread and every render worker open the same pack bytes, each into its own cache.
export function openCachePack(buffer: ArrayBufferLike): LoadedCache {
    const pack = decodeCachePack(buffer);
    return {
        info: pack.header.cacheInfo,
        system: CacheSystem.fromStore(new PackCacheStore(pack), pack.header.indexIds),
        xteas: xteaMapFromRecord(pack.header.xteas),
    };
}
