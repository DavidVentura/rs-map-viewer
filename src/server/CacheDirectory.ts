import fs from "fs";
import path from "path";

import { CacheFiles } from "../rs/cache/CacheFiles";
import { CacheInfo } from "../rs/cache/CacheInfo";
import { SourceCache, openSourceCache } from "../rs/cache/pack/SourceCache";
import { MemoryStore } from "../rs/cache/store/MemoryStore";
import { XteaMap, xteaMapFromRecord } from "../rs/map/XteaMap";

// The caches directory as npm run download-caches lays it out: caches.json listing the caches,
// and one directory per cache holding its dat2/idx files and keys.json.

export function readCacheInfos(cachesDir: string): CacheInfo[] {
    const listPath = path.join(cachesDir, "caches.json");
    if (!fs.existsSync(listPath)) {
        throw new Error(`${listPath} not found: run npm run download-caches`);
    }
    return JSON.parse(fs.readFileSync(listPath, "utf8"));
}

function cacheDir(cachesDir: string, info: CacheInfo): string {
    const dir = path.join(cachesDir, info.name);
    if (!fs.existsSync(dir)) {
        throw new Error(`${dir} not found: run npm run download-caches`);
    }
    return dir;
}

// Reads straight into an ArrayBuffer of exactly the file's size: readFileSync would hand small
// files out as slices of Node's shared buffer pool, which would then need copying.
function readFileArrayBuffer(filePath: string): ArrayBuffer {
    const bytes = new Uint8Array(fs.statSync(filePath).size);
    const fd = fs.openSync(filePath, "r");
    try {
        let offset = 0;
        while (offset < bytes.length) {
            const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
            if (read === 0) {
                throw new Error(`${filePath} ended after ${offset} of ${bytes.length} bytes`);
            }
            offset += read;
        }
    } finally {
        fs.closeSync(fd);
    }
    return bytes.buffer;
}

export function readCacheFiles(cachesDir: string, info: CacheInfo): CacheFiles {
    const dir = cacheDir(cachesDir, info);
    const files = new Map<string, ArrayBuffer>();
    for (const fileName of fs.readdirSync(dir)) {
        files.set(fileName, readFileArrayBuffer(path.join(dir, fileName)));
    }
    return new CacheFiles(files);
}

export function readXteas(cachesDir: string, info: CacheInfo): XteaMap {
    const keysPath = path.join(cacheDir(cachesDir, info), "keys.json");
    return xteaMapFromRecord(JSON.parse(fs.readFileSync(keysPath, "utf8")));
}

export function readSourceCache(cachesDir: string, info: CacheInfo): SourceCache {
    const store = MemoryStore.fromFiles(readCacheFiles(cachesDir, info));
    return openSourceCache(info, store, readXteas(cachesDir, info));
}
