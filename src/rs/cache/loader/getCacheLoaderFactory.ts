import { CacheInfo } from "../CacheInfo";
import { CacheSystem } from "../CacheSystem";
import { detectCacheType } from "../CacheType";
import { CacheLoaderFactory } from "./CacheLoaderFactory";
import { Dat2CacheLoaderFactory } from "./Dat2CacheLoaderFactory";
import { DatCacheLoaderFactory } from "./DatCacheLoaderFactory";
import { LegacyCacheLoaderFactory } from "./LegacyCacheLoaderFactory";

// Every format, for the Node scripts over full caches. A LoadedCache is always dat2, so the viewer
// builds a Dat2CacheLoaderFactory itself and never imports the older formats' decoders.
export function getCacheLoaderFactory(
    cacheInfo: CacheInfo,
    cacheSystem: CacheSystem,
): CacheLoaderFactory {
    const cacheType = detectCacheType(cacheInfo);
    switch (cacheType) {
        case "legacy":
            return new LegacyCacheLoaderFactory(cacheInfo, cacheSystem);
        case "dat":
            return new DatCacheLoaderFactory(cacheInfo, cacheType, cacheSystem);
        case "dat2":
            return new Dat2CacheLoaderFactory(cacheInfo, cacheSystem);
    }
    throw new Error("Not implemented");
}
