// Checks cache packs against the full cache they are cut from, and the pack server against the
// packer; slow, so run it when the resolver, the pack format or a loader changes:
//   npm run packs:verify
import fs from "fs";
import { AddressInfo } from "net";
import os from "os";
import path from "path";

import { ViewerLoaders, createViewerLoaders } from "../../src/mapviewer/ViewerLoaders";
import { packRequest } from "../../src/mapviewer/assets/cacheRoots";
import { AnimPreviewParams } from "../../src/mapviewer/game/AnimPreview";
import { loadSeqTiming } from "../../src/mapviewer/game/Animation";
import {
    Encounter,
    EncounterId,
    buildPreviewEncounter,
    getEncounter,
} from "../../src/mapviewer/game/Encounter";
import { groundDecorationsInMapSquare } from "../../src/mapviewer/game/LocTransform";
import { ActorRenderDataLoader } from "../../src/mapviewer/webgl/loader/ActorRenderDataLoader";
import { SdMapData } from "../../src/mapviewer/webgl/loader/SdMapData";
import { SdMapDataLoader } from "../../src/mapviewer/webgl/loader/SdMapDataLoader";
import { createHeadlessWorkerState } from "../../src/mapviewer/worker/HeadlessWorkerState";
import { WorkerState, clearWorkerStateCaches } from "../../src/mapviewer/worker/WorkerState";
import { Archive } from "../../src/rs/cache/Archive";
import { ArchiveFile } from "../../src/rs/cache/ArchiveFile";
import { CacheIndex } from "../../src/rs/cache/CacheIndex";
import { IndexType } from "../../src/rs/cache/IndexType";
import { LoadedCache } from "../../src/rs/cache/LoadedCache";
import { CachePacker, PackContents } from "../../src/rs/cache/pack/CachePacker";
import { CacheRoots } from "../../src/rs/cache/pack/CacheRoots";
import { SourceCache } from "../../src/rs/cache/pack/SourceCache";
import { openCachePack } from "../../src/rs/cache/pack/openCachePack";
import { ReferenceTable } from "../../src/rs/cache/ref/ReferenceTable";
import { Bzip2 } from "../../src/rs/compression/Bzip2";
import { ByteBuffer } from "../../src/rs/io/ByteBuffer";
import { MapSpawns } from "../../src/rs/map/MapSpawns";
import { MapSquareCoord } from "../../src/rs/map/MapSquareCoord";
import { Scene } from "../../src/rs/scene/Scene";
import { readSourceCache } from "../../src/server/CacheDirectory";
import { packIdOf } from "../../src/server/PackStore";
import { readWorldSpawns } from "../../src/server/WorldSpawns";
import { packContents } from "../../src/server/packContents";
import { createPackServer } from "../../src/server/packServer";
import { loadCacheInfos, loadCacheList } from "./load-util";

type EquivalenceCase = {
    readonly name: string;
    readonly encounterId: EncounterId;
    readonly preview?: AnimPreviewParams;
};

const TZTOK_JAD_NPC_TYPE_ID = 3127;

const CASES: readonly EquivalenceCase[] = [
    ...Object.values(EncounterId).map((encounterId) => ({ name: encounterId, encounterId })),
    {
        name: "npc seqs preview",
        encounterId: EncounterId.LUMBRIDGE,
        preview: {
            kind: "NPC_SEQS",
            npcTypeId: TZTOK_JAD_NPC_TYPE_ID,
            seqRange: { from: 2650, to: 2656 },
        },
    },
    {
        name: "spot anims preview",
        encounterId: EncounterId.LUMBRIDGE,
        preview: { kind: "SPOT_ANIMS", range: { from: 445, to: 452 } },
    },
];

const CACHES_DIR = "./caches";

class CheckFailure extends Error {}

function fail(message: string): never {
    throw new CheckFailure(message);
}

function bytesEqual(a: Uint8Array | Int8Array, b: Uint8Array | Int8Array): boolean {
    return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
        Buffer.from(b.buffer, b.byteOffset, b.byteLength),
    );
}

function packedBytes(packer: CachePacker, contents: PackContents): Uint8Array {
    const packed = packer.pack(contents);
    if (packed.kind === "UNKNOWN_ROOT") {
        return fail(packed.reason);
    }
    return packed.bytes;
}

// The first path at which the two values differ, or undefined when they are equal byte for byte.
function firstDifference(
    a: unknown,
    b: unknown,
    at: string,
    seen = new Set<unknown>(),
): string | undefined {
    if (Object.is(a, b)) {
        return undefined;
    }
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
        if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) {
            return `${at}: only one side is a typed array`;
        }
        if (a.constructor.name !== b.constructor.name) {
            return `${at}: ${a.constructor.name} vs ${b.constructor.name}`;
        }
        const bytesA = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
        const bytesB = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
        return bytesA.equals(bytesB) ? undefined : `${at}: bytes differ`;
    }
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
        return `${at}: ${String(a)} vs ${String(b)}`;
    }
    if (seen.has(a)) {
        return undefined;
    }
    seen.add(a);
    if (a.constructor !== b.constructor) {
        return `${at}: ${a.constructor.name} vs ${b.constructor.name}`;
    }
    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size) {
            return `${at}: map sizes ${a.size} vs ${b.size}`;
        }
        for (const [key, value] of a) {
            if (!b.has(key)) {
                return `${at}: key ${String(key)} missing`;
            }
            const difference = firstDifference(value, b.get(key), `${at}[${String(key)}]`, seen);
            if (difference) {
                return difference;
            }
        }
        return undefined;
    }
    if (a instanceof Set && b instanceof Set) {
        return firstDifference([...a].sort(), [...b].sort(), at, seen);
    }
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.join() !== keysB.join()) {
        return `${at}: keys ${keysA.join()} vs ${keysB.join()}`;
    }
    for (const key of keysA) {
        const difference = firstDifference(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key],
            `${at}.${key}`,
            seen,
        );
        if (difference) {
            return difference;
        }
    }
    return undefined;
}

function expectSame(expected: unknown, actual: unknown, at: string): void {
    const difference = firstDifference(expected, actual, at);
    if (difference) {
        fail(difference);
    }
}

// One render worker plus the main thread's loaders, all over one cache. Map loads run as the
// worker runs them, clearing the model caches after each.
class HeadlessViewer {
    private readonly viewer: ViewerLoaders;
    private readonly state: WorkerState;
    private readonly mapLoader = new SdMapDataLoader();
    private readonly actorLoader = new ActorRenderDataLoader();

    constructor(cache: LoadedCache, spawns: MapSpawns) {
        this.viewer = createViewerLoaders(cache.info, cache.system);
        this.state = createHeadlessWorkerState(cache, spawns);
    }

    async loadMap(square: MapSquareCoord, encounter: Encounter) {
        const { data } = await this.mapLoader.load(this.state, {
            mapX: square.mapX,
            mapY: square.mapY,
            maxLevel: Scene.MAX_LEVELS - 1,
            loadObjs: true,
            loadNpcs: encounter.ambientNpcs,
            smoothTerrain: false,
            minimizeDrawCalls: false,
            loadedTextureIds: new Set(),
            transformableGroundDecorations: groundDecorationsInMapSquare(
                encounter.transformableGroundDecorations,
                square,
            ),
        });
        clearWorkerStateCaches(this.state);
        return data;
    }

    async loadActors(encounterId: EncounterId, preview: AnimPreviewParams | undefined) {
        const { data } = await this.actorLoader.load(this.state, {
            encounterId,
            loadedTextureIds: new Set(),
            preview,
        });
        clearWorkerStateCaches(this.state);
        return data;
    }

    // What the game itself reads on the main thread by root id: type names and seq timings.
    loadMainThreadRoots(roots: CacheRoots) {
        const { npcTypeLoader, objTypeLoader } = this.viewer;
        return {
            npcTypes: roots.npcTypeIds.map((id) => npcTypeLoader.load(id)),
            objTypes: roots.objTypeIds.map((id) => objTypeLoader.load(id)),
            seqTimings: roots.seqIds.map((id) => loadSeqTiming(id, this.viewer)),
        };
    }
}

type Context = {
    readonly source: SourceCache;
    readonly packer: CachePacker;
    readonly worldSpawns: MapSpawns;
    // Places the spawns of the whole world, of which the map loader keeps those of each square.
    readonly fullCache: HeadlessViewer;
    // Several encounters share squares; the full cache builds each the same way every time.
    readonly fullCacheMaps: Map<string, Promise<SdMapData | undefined>>;
};

function checkReferenceTables({ source }: Context): void {
    for (const indexId of source.indexIds) {
        const stored = source.store.read(CacheIndex.META_INDEX_ID, indexId);
        const table = ReferenceTable.decode(new ByteBuffer(stored));
        const encoded = ReferenceTable.encode(table.format, table.archiveReferences);
        if (!bytesEqual(encoded, stored)) {
            fail(`index ${indexId}'s reference table re-encodes differently`);
        }
    }
}

function checkArchiveRoundTrips({ source }: Context): void {
    const targets = [
        ...Array.from(source.system.getIndex(IndexType.DAT2.configs).getArchiveIds()).map(
            (archiveId) => ({ indexId: IndexType.DAT2.configs, archiveId }),
        ),
        ...Array.from(source.system.getIndex(IndexType.DAT2.maps).getArchiveIds())
            .slice(0, 20)
            .map((archiveId) => ({ indexId: IndexType.DAT2.maps, archiveId })),
    ];
    for (const { indexId, archiveId } of targets) {
        const index = source.system.getIndex(indexId);
        const reference = index.getArchiveReference(archiveId)!;
        const archive = index.getArchive(archiveId);
        const files = Array.from(reference.fileIds, (fileId) => archive.getFile(fileId)!);
        const decoded = Archive.decode(
            archiveId,
            reference.lastFileId,
            reference.fileCount,
            reference.fileIds,
            reference.fileNameHashes,
            new ByteBuffer(Archive.encode(files)),
        );
        const differs = files.find(
            (file: ArchiveFile) => !bytesEqual(decoded.getFile(file.id)!.data, file.data),
        );
        if (differs) {
            fail(
                `index ${indexId} archive ${archiveId} file ${differs.id} round-trips differently`,
            );
        }
    }
}

// A packer that has cut other packs must cut the same bytes as a fresh one: everything it keeps
// across packs has to be independent of the roots.
function checkDeterminism(context: Context): void {
    const { source, packer, worldSpawns } = context;
    for (const { name, encounterId, preview } of CASES) {
        const contents = packContents(worldSpawns, packRequest(getEncounter(encounterId), preview));
        const warm = packedBytes(packer, contents);
        if (!bytesEqual(warm, packedBytes(new CachePacker(source), contents))) {
            fail(`${name}: a warm packer cuts different bytes than a fresh one`);
        }
    }
    const fightCaves = packContents(
        worldSpawns,
        packRequest(getEncounter(EncounterId.FIGHT_CAVES), undefined),
    );
    const reopened = new CachePacker(readSourceCache(CACHES_DIR, source.info));
    if (!bytesEqual(packedBytes(packer, fightCaves), packedBytes(reopened, fightCaves))) {
        fail("fight caves: a reopened cache cuts different bytes");
    }
}

function loadFullCacheMap(context: Context, square: MapSquareCoord, encounter: Encounter) {
    const key = `${square.mapX},${square.mapY},${encounter.id},${encounter.ambientNpcs}`;
    let map = context.fullCacheMaps.get(key);
    if (!map) {
        map = context.fullCache.loadMap(square, encounter);
        context.fullCacheMaps.set(key, map);
    }
    return map;
}

async function checkEquivalence(context: Context, testCase: EquivalenceCase): Promise<void> {
    const { encounterId, preview } = testCase;
    const { packer, worldSpawns, fullCache, source } = context;
    const baseEncounter = getEncounter(encounterId);
    // The renderer maps the preview encounter but bakes actors for the base encounter's id.
    const mapEncounter = preview ? buildPreviewEncounter(baseEncounter) : baseEncounter;
    const contents = packContents(worldSpawns, packRequest(baseEncounter, preview));
    const pack = openCachePack(packedBytes(packer, contents).buffer);
    expectSame(source.info, pack.cache.info, "cache info");
    expectSame(contents.spawns, pack.spawns, "spawns");
    const fromPack = new HeadlessViewer(pack.cache, pack.spawns);

    for (const square of mapEncounter.mapSquares) {
        const expected = await loadFullCacheMap(context, square, mapEncounter);
        if (!expected) {
            fail(`map ${square.mapX},${square.mapY} does not load from the full cache`);
        }
        const actual = await fromPack.loadMap(square, mapEncounter);
        expectSame(expected, actual, `map ${square.mapX},${square.mapY}`);
    }
    expectSame(
        await fullCache.loadActors(encounterId, preview),
        await fromPack.loadActors(encounterId, preview),
        "actors",
    );
    expectSame(
        fullCache.loadMainThreadRoots(contents.roots),
        fromPack.loadMainThreadRoots(contents.roots),
        "main thread",
    );
}

function expectStatus(response: Response, status: number, what: string): void {
    if (response.status !== status) {
        fail(`${what} answered ${response.status}, expected ${status}`);
    }
}

// Concurrent resolves of the same request share one pack, and the served pack is the packer's.
async function checkServer(context: Context): Promise<void> {
    const { source, worldSpawns } = context;
    const packsDir = fs.mkdtempSync(path.join(os.tmpdir(), "packs-verify-"));
    const packer = new CachePacker(source);
    let builds = 0;
    const server = await createPackServer({
        caches: [source.info],
        packsDir,
        openPacker: () => ({
            pack: (contents) => {
                builds++;
                return packer.pack(contents);
            },
        }),
        worldSpawns,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/packs`;
    try {
        const cacheList = await fetch(`${base}/caches.json`);
        expectStatus(cacheList, 200, "the cache list");
        expectSame([source.info], await cacheList.json(), "cache list");

        const request = packRequest(getEncounter(EncounterId.LUMBRIDGE), undefined);
        const resolveUrl = `${base}/${encodeURIComponent(source.info.name)}/resolve`;
        const responses = await Promise.all(
            Array.from({ length: 8 }, () =>
                fetch(resolveUrl, { method: "POST", body: JSON.stringify(request) }),
            ),
        );
        responses.forEach((response) => expectStatus(response, 200, "a resolve"));
        const packIds = new Set(
            await Promise.all(responses.map(async (response) => (await response.json()).packId)),
        );
        if (builds !== 1 || packIds.size !== 1) {
            fail(`8 concurrent resolves built ${builds} packs with ${packIds.size} pack ids`);
        }
        const [packId] = packIds;

        const expected = packedBytes(packer, packContents(worldSpawns, request));
        if (packId !== packIdOf(expected)) {
            fail(`the pack id ${packId} is not the hash of the packer's bytes`);
        }
        const pack = await fetch(`${base}/${encodeURIComponent(source.info.name)}/${packId}.pack`);
        expectStatus(pack, 200, "the pack");
        if (!pack.headers.get("cache-control")?.includes("immutable")) {
            fail(`the pack is served with Cache-Control ${pack.headers.get("cache-control")}`);
        }
        if (!bytesEqual(new Uint8Array(await pack.arrayBuffer()), expected)) {
            fail("the served pack differs from the packer's bytes");
        }

        const missing = await fetch(`${base}/${source.info.name}/${"0".repeat(64)}.pack`);
        expectStatus(missing, 404, "a missing pack");
        const malformed = await fetch(resolveUrl, {
            method: "POST",
            body: JSON.stringify({ ...request, roots: { ...request.roots, seqIds: [-1] } }),
        });
        expectStatus(malformed, 400, "malformed roots");
        const straySpawnSquare = await fetch(resolveUrl, {
            method: "POST",
            body: JSON.stringify({ ...request, objSpawnSquares: [{ mapX: 1, mapY: 1 }] }),
        });
        expectStatus(straySpawnSquare, 400, "spawns of a square outside the roots");
        const unknown = await fetch(resolveUrl, {
            method: "POST",
            body: JSON.stringify({
                ...request,
                roots: { ...request.roots, npcTypeIds: [1 << 30] },
            }),
        });
        expectStatus(unknown, 400, "an unknown npc type");
        const unknownCache = await fetch(`${base}/no-such-cache/resolve`, {
            method: "POST",
            body: JSON.stringify(request),
        });
        expectStatus(unknownCache, 404, "an unknown cache");
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(packsDir, { recursive: true, force: true });
    }
}

async function main(): Promise<void> {
    // The pack server decodes bzip2 with wasm too, and the JS fallback would dominate the run.
    await Bzip2.initWasm();
    const log = console.log;
    const source = readSourceCache(CACHES_DIR, loadCacheList(loadCacheInfos()).latest);
    const worldSpawns = readWorldSpawns();
    const context: Context = {
        source,
        packer: new CachePacker(source),
        worldSpawns,
        fullCache: new HeadlessViewer(source, worldSpawns),
        fullCacheMaps: new Map(),
    };

    const checks: [string, () => void | Promise<void>][] = [
        ["reference tables re-encode byte for byte", () => checkReferenceTables(context)],
        ["config and map archives round-trip", () => checkArchiveRoundTrips(context)],
        ["packs are deterministic", () => checkDeterminism(context)],
        ...CASES.map((testCase): [string, () => Promise<void>] => [
            `${testCase.name} loads from its pack as from the full cache`,
            () => checkEquivalence(context, testCase),
        ]),
        ["the pack server packs concurrent resolves once", () => checkServer(context)],
    ];

    // The loaders narrate every load; errors still show.
    console.log = () => {};
    console.time = () => {};
    console.timeEnd = () => {};

    let failures = 0;
    for (const [name, check] of checks) {
        const start = performance.now();
        try {
            await check();
            log(`ok   ${name} (${((performance.now() - start) / 1000).toFixed(1)} s)`);
        } catch (e) {
            failures++;
            log(`FAIL ${name}: ${e instanceof CheckFailure ? e.message : e}`);
            if (!(e instanceof CheckFailure)) {
                console.error(e);
            }
        }
    }
    log(failures === 0 ? "all checks passed" : `${failures} checks failed`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
