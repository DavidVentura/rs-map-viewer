import { CacheInfo, getLatestCache } from "../rs/cache/CacheInfo";
import { CacheRoots } from "../rs/cache/pack/CacheRoots";
import { PackId, parsePackId } from "../rs/cache/pack/PackId";

const PACKS_PATH = "/packs/";

// The Cache Storage the app keeps downloaded packs in, under their URLs. A pack URL names the
// pack's content, so a stored pack never goes stale.
const PACKS_STORAGE_NAME = "packs";

export type CacheList = {
    caches: CacheInfo[];
    latest: CacheInfo;
};

async function fetchOk(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
    }
    return response;
}

export async function fetchCacheList(signal: AbortSignal): Promise<CacheList> {
    const response = await fetchOk(PACKS_PATH + "caches.json", { signal });
    const caches: CacheInfo[] = await response.json();
    const latest = getLatestCache(caches);
    if (!latest) {
        throw new Error("The pack server lists no caches");
    }
    return { caches, latest };
}

function cachePacksPath(cacheName: string): string {
    return `${PACKS_PATH}${encodeURIComponent(cacheName)}/`;
}

function parsePackIdResponse(json: unknown): PackId {
    const value = (json as { packId?: unknown } | null)?.packId;
    const packId = typeof value === "string" ? parsePackId(value) : undefined;
    if (!packId) {
        throw new Error(`The pack server answered a resolve with ${JSON.stringify(json)}`);
    }
    return packId;
}

// The pack of the named cache that holds everything the roots need, as bytes the render workers
// share with the main thread.
export async function loadCachePack(
    cacheName: string,
    roots: CacheRoots,
    signal: AbortSignal,
): Promise<SharedArrayBuffer> {
    const resolved = await fetchOk(cachePacksPath(cacheName) + "resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roots),
        signal,
    });
    const packId = parsePackIdResponse(await resolved.json());
    const packUrl = `${cachePacksPath(cacheName)}${packId}.pack`;

    const storage = await caches.open(PACKS_STORAGE_NAME);
    const stored = await storage.match(packUrl);
    let bytes: ArrayBuffer;
    if (stored) {
        bytes = await stored.arrayBuffer();
    } else {
        const fetched = await fetchOk(packUrl, { signal });
        await storage.put(packUrl, fetched.clone());
        bytes = await fetched.arrayBuffer();
    }
    console.log(
        `[startup] pack ${packId} (${bytes.byteLength} bytes) ready at ${performance
            .now()
            .toFixed(0)}ms, ${stored ? "stored" : "downloaded"}`,
    );

    const shared = new SharedArrayBuffer(bytes.byteLength);
    new Uint8Array(shared).set(new Uint8Array(bytes));
    return shared;
}

// Deletes the Cache Storage the app no longer reads: every cache but the packs, which covers the
// full caches and encounter bundles earlier versions downloaded, and the packs of other caches.
export async function pruneCacheStorage(cacheName: string): Promise<void> {
    for (const name of await caches.keys()) {
        if (name !== PACKS_STORAGE_NAME) {
            await caches.delete(name);
        }
    }
    const storage = await caches.open(PACKS_STORAGE_NAME);
    const keptPath = cachePacksPath(cacheName);
    for (const request of await storage.keys()) {
        if (!new URL(request.url).pathname.startsWith(keptPath)) {
            await storage.delete(request);
        }
    }
}
