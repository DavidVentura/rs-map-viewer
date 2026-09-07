import { CacheFiles, ProgressListener } from "../rs/cache/CacheFiles";
import { CacheInfo, getLatestCache } from "../rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../rs/cache/CacheType";
import { decodeCacheBundle } from "../rs/cache/bundle/CacheBundle";
import { EncounterId } from "./game/Encounter";

const CACHE_PATH = "/caches/";
const BUNDLE_PATH = CACHE_PATH + "bundles/";

export async function fetchCacheInfos(): Promise<CacheInfo[]> {
    const resp = await fetch(CACHE_PATH + "caches.json");
    return resp.json();
}

export type CacheList = {
    caches: CacheInfo[];
    latest: CacheInfo;
};

export async function fetchCacheList(): Promise<CacheList | undefined> {
    const caches = await fetchCacheInfos();
    const latest = getLatestCache(caches);
    if (!latest) {
        return undefined;
    }
    return {
        caches,
        latest,
    };
}

// Where a LoadedCache's archive data came from: "full" is the complete, ~200MB+ physical cache;
// "bundle" is a single pre-extracted per-encounter file holding only the archives that encounter
// needs. Exposed on MapViewer.loadedCache so it's observable (e.g. from a debug console).
export type CacheSource = "full" | "bundle";

export type LoadedCache = {
    info: CacheInfo;
    type: CacheType;
    files: CacheFiles;
    xteas: XteaMap;
    source: CacheSource;
};

export async function loadCacheFiles(
    info: CacheInfo,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<LoadedCache> {
    const cachePath = CACHE_PATH + info.name + "/";

    const xteasPromise = fetchXteas(cachePath + "keys.json", signal);

    const cacheType = detectCacheType(info);
    const files = await CacheFiles.fetchFiles(
        cacheType,
        cachePath,
        info.name,
        true,
        signal,
        progressListener,
    );

    const xteas = await xteasPromise;

    return {
        info,
        type: cacheType,
        files,
        xteas,
        source: "full",
    };
}

// Fetches caches/bundles/<encounterId>.json to see if a bundle exists for this encounter, and if
// so loads caches/bundles/<encounterId>.bundle as a LoadedCache instead of the full cache.
// Returns undefined (never throws for a plain 404) so the caller can fall back to the full cache.
export async function loadCacheBundle(
    encounterId: EncounterId,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<LoadedCache | undefined> {
    let manifestResp: Response;
    try {
        manifestResp = await fetch(BUNDLE_PATH + encounterId + ".json", { signal });
    } catch (e) {
        return undefined;
    }
    if (!manifestResp.ok) {
        return undefined;
    }

    const files = await CacheFiles.fetchBundle(
        BUNDLE_PATH,
        encounterId,
        "bundle-" + encounterId,
        signal,
        progressListener,
    );
    const bundleBuffer = files.files.get(CacheFiles.BUNDLE_FILE_NAME);
    if (!bundleBuffer) {
        throw new Error("Bundle fetch did not produce bundle data");
    }
    const { header } = decodeCacheBundle(bundleBuffer);

    return {
        info: header.cacheInfo,
        type: detectCacheType(header.cacheInfo),
        files,
        xteas: xteaMapFromRecord(header.xteas),
        source: "bundle",
    };
}

export type XteaMap = Map<number, number[]>;

export async function fetchXteas(url: RequestInfo, signal?: AbortSignal): Promise<XteaMap> {
    const resp = await fetch(url, {
        signal,
    });
    const data: Record<string, number[]> = await resp.json();
    return xteaMapFromRecord(data);
}

function xteaMapFromRecord(data: Readonly<Record<string, readonly number[]>>): XteaMap {
    return new Map(Object.keys(data).map((key) => [parseInt(key), Array.from(data[key])]));
}
