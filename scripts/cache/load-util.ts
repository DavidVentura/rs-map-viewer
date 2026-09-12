import fs from "fs";

import { CacheList, LoadedCache, XteaMap } from "../../src/mapviewer/Caches";
import { CacheFiles } from "../../src/rs/cache/CacheFiles";
import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";

const CACHE_LIST_PATH = "./caches/caches.json";

export function loadCacheInfos(): CacheInfo[] {
    if (!fs.existsSync(CACHE_LIST_PATH)) {
        throw new Error(`${CACHE_LIST_PATH} not found: run npm run download-caches`);
    }
    const json = fs.readFileSync(CACHE_LIST_PATH, "utf8");
    return JSON.parse(json);
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

// Reads straight into an ArrayBuffer of exactly the file's size: readFileSync would hand small
// files out as slices of Node's shared buffer pool, which would then need copying.
function readFileArrayBuffer(path: string): ArrayBuffer {
    const bytes = new Uint8Array(fs.statSync(path).size);
    const fd = fs.openSync(path, "r");
    try {
        let offset = 0;
        while (offset < bytes.length) {
            const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
            if (read === 0) {
                throw new Error(`${path} ended after ${offset} of ${bytes.length} bytes`);
            }
            offset += read;
        }
    } finally {
        fs.closeSync(fd);
    }
    return bytes.buffer;
}

export function loadCacheFiles(cache: CacheInfo): CacheFiles {
    const cachePath = "./caches/" + cache.name + "/";
    if (!fs.existsSync(cachePath)) {
        throw new Error(`${cachePath} not found: run npm run download-caches`);
    }

    const files = new Map<string, ArrayBuffer>();
    for (const fileName of fs.readdirSync(cachePath)) {
        files.set(fileName, readFileArrayBuffer(cachePath + fileName));
    }

    return new CacheFiles(files);
}

export function loadCache(info: CacheInfo): LoadedCache {
    const files = loadCacheFiles(info);
    const xteas = loadXteas(info);
    return {
        info,
        type: detectCacheType(info),
        files,
        xteas,
        source: "full",
    };
}

export function loadXteas(cache: CacheInfo): XteaMap {
    const cachePath = "./caches/" + cache.name + "/";
    const json = fs.readFileSync(cachePath + "keys.json", "utf8");
    const data: Record<string, number[]> = JSON.parse(json);
    return new Map(Object.keys(data).map((key) => [parseInt(key), data[key]]));
}
