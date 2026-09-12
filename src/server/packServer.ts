import fs from "fs";
import http from "http";
import path from "path";
import { pipeline } from "stream/promises";

import { CacheInfo } from "../rs/cache/CacheInfo";
import { parseCacheRoots } from "../rs/cache/pack/CacheRoots";
import { parsePackId } from "../rs/cache/pack/PackId";
import { PackResolver, RootsPacker } from "./PackResolver";
import { PackStore } from "./PackStore";

export type PackServerConfig = {
    readonly caches: readonly CacheInfo[];
    // Packs of each cache go in a directory of its name under this one.
    readonly packsDir: string;
    readonly openPacker: (info: CacheInfo) => RootsPacker;
};

type ServedCache = {
    readonly store: PackStore;
    readonly resolver: PackResolver;
};

// Roots name every id an encounter uses, a few thousand at most.
const MAX_RESOLVE_BODY_BYTES = 1024 * 1024;

const PACK_FILE_SUFFIX = ".pack";

type Body = { readonly kind: "BODY"; readonly text: string } | { readonly kind: "TOO_LARGE" };

// An oversized body is still read to its end, since abandoning the request stream would reset the
// connection before the refusal is sent.
async function readBody(request: http.IncomingMessage): Promise<Body> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
        length += chunk.length;
        if (length <= MAX_RESOLVE_BODY_BYTES) {
            chunks.push(chunk);
        }
    }
    if (length > MAX_RESOLVE_BODY_BYTES) {
        return { kind: "TOO_LARGE" };
    }
    return { kind: "BODY", text: Buffer.concat(chunks).toString("utf8") };
}

function parseJson(text: string): { readonly json: unknown } | undefined {
    try {
        return { json: JSON.parse(text) };
    } catch (e) {
        return undefined;
    }
}

function sendText(response: http.ServerResponse, status: number, text: string): void {
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(text);
}

function pathSegments(pathname: string): string[] | undefined {
    try {
        return pathname.split("/").slice(1).map(decodeURIComponent);
    } catch (e) {
        return undefined;
    }
}

async function resolvePack(
    served: ServedCache,
    request: http.IncomingMessage,
    response: http.ServerResponse,
): Promise<void> {
    const body = await readBody(request);
    if (body.kind === "TOO_LARGE") {
        sendText(response, 413, `Cache roots over ${MAX_RESOLVE_BODY_BYTES} bytes`);
        return;
    }
    const parsedJson = parseJson(body.text);
    if (!parsedJson) {
        sendText(response, 400, "Body is not JSON");
        return;
    }
    const parsed = parseCacheRoots(parsedJson.json);
    if (parsed.kind === "INVALID") {
        sendText(response, 400, parsed.reason);
        return;
    }
    const start = performance.now();
    const outcome = await served.resolver.resolve(parsed.roots);
    if (outcome.kind === "UNKNOWN_ROOT") {
        sendText(response, 400, outcome.reason);
        return;
    }
    console.log(`Resolved ${outcome.packId} in ${(performance.now() - start).toFixed(1)} ms`);
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ packId: outcome.packId }));
}

async function sendPack(
    served: ServedCache,
    fileName: string,
    request: http.IncomingMessage,
    response: http.ServerResponse,
): Promise<void> {
    const packId = parsePackId(fileName.slice(0, -PACK_FILE_SUFFIX.length));
    if (!packId) {
        sendText(response, 400, `Not a pack id: ${fileName}`);
        return;
    }
    const packPath = served.store.packPath(packId);
    const stat = await fs.promises.stat(packPath).catch(() => undefined);
    if (!stat) {
        sendText(response, 404, `No pack ${packId}`);
        return;
    }
    // Compression in transit is the reverse proxy's job, not this server's.
    response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": stat.size,
    });
    if (request.method === "HEAD") {
        response.end();
        return;
    }
    await pipeline(fs.createReadStream(packPath), response);
}

// GET  /packs/caches.json               the caches packs can be cut from
// POST /packs/<cacheName>/resolve       roots as JSON, answered with { packId }
// GET  /packs/<cacheName>/<packId>.pack the pack, immutable since it is named by its hash
export async function createPackServer(config: PackServerConfig): Promise<http.Server> {
    const servedCaches = new Map<string, ServedCache>();
    for (const info of config.caches) {
        const store = await PackStore.open(path.join(config.packsDir, info.name));
        const resolver = new PackResolver(store, () => config.openPacker(info));
        servedCaches.set(info.name, { store, resolver });
    }
    const cacheListJson = JSON.stringify(config.caches);

    const route = async (
        request: http.IncomingMessage,
        response: http.ServerResponse,
    ): Promise<void> => {
        const url = new URL(request.url ?? "/", "http://pack-server");
        const segments = pathSegments(url.pathname);
        const method = request.method ?? "GET";
        if (!segments) {
            sendText(response, 400, "Malformed path");
            return;
        }
        if (segments[0] !== "packs") {
            sendText(response, 404, "Not found");
            return;
        }
        if (segments.length === 2 && segments[1] === "caches.json") {
            if (method !== "GET") {
                sendText(response, 405, "Method not allowed");
                return;
            }
            response.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
            });
            response.end(cacheListJson);
            return;
        }
        if (segments.length !== 3) {
            sendText(response, 404, "Not found");
            return;
        }
        const [, cacheName, fileName] = segments;
        const served = servedCaches.get(cacheName);
        if (!served) {
            sendText(response, 404, `No cache ${cacheName}`);
            return;
        }
        if (fileName === "resolve") {
            if (method !== "POST") {
                sendText(response, 405, "Method not allowed");
                return;
            }
            await resolvePack(served, request, response);
            return;
        }
        if (!fileName.endsWith(PACK_FILE_SUFFIX)) {
            sendText(response, 404, "Not found");
            return;
        }
        if (method !== "GET" && method !== "HEAD") {
            sendText(response, 405, "Method not allowed");
            return;
        }
        await sendPack(served, fileName, request, response);
    };

    return http.createServer((request, response) => {
        route(request, response).catch((e) => {
            console.error(`${request.method} ${request.url} failed`, e);
            if (!response.headersSent) {
                sendText(response, 500, "Internal server error");
            } else {
                response.destroy();
            }
        });
    });
}
