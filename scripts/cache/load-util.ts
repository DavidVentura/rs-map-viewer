import { CacheList } from "../../src/mapviewer/Caches";
import { CacheFiles } from "../../src/rs/cache/CacheFiles";
import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { XteaMap } from "../../src/rs/map/XteaMap";
import { readCacheFiles, readCacheInfos, readXteas } from "../../src/server/CacheDirectory";

const CACHES_DIR = "./caches";

// A full cache as the scripts read it from disk, in any of the formats the engine decodes.
export type DiskCache = {
    readonly info: CacheInfo;
    readonly type: CacheType;
    readonly files: CacheFiles;
    readonly xteas: XteaMap;
};

export function loadCacheInfos(): CacheInfo[] {
    return readCacheInfos(CACHES_DIR);
}

export function loadCacheList(caches: CacheInfo[]): CacheList {
    const latest = getLatestCache(caches);
    if (!latest) {
        throw new Error("No latest cache");
    }
    return {
        caches,
        latest,
    };
}

export function loadCache(info: CacheInfo): DiskCache {
    return {
        info,
        type: detectCacheType(info),
        files: readCacheFiles(CACHES_DIR, info),
        xteas: readXteas(CACHES_DIR, info),
    };
}
