// Builds caches/bundles/<encounterId>.bundle: a single file holding exactly the cache archives an
// encounter needs (map squares, actor animations, projectiles), instead of the full ~200MB+ cache.
//
// It works by running the real map/actor loaders (the same code the app runs in its workers)
// against a RecordingCacheStore, which observes every (index, archive) read, then extracts just
// those archives into a CacheBundle. See src/rs/cache/bundle/CacheBundle.ts for the format and
// src/rs/cache/store/BundleCacheStore.ts for how the app reads a bundle back at runtime.
import { createHash } from "crypto";
import fs from "fs";

import type { NpcSpawn } from "../../src/mapviewer/data/npc/NpcSpawn";
import type { ObjSpawn } from "../../src/mapviewer/data/obj/ObjSpawn";
import { EncounterId, MapSquareCoord, getEncounter } from "../../src/mapviewer/game/Encounter";
import { ActorRenderDataLoader } from "../../src/mapviewer/webgl/loader/ActorRenderDataLoader";
import { SdMapDataLoader } from "../../src/mapviewer/webgl/loader/SdMapDataLoader";
import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { IndexType } from "../../src/rs/cache/IndexType";
import {
    CacheBundleEntry,
    CacheBundleHeader,
    encodeCacheBundle,
} from "../../src/rs/cache/bundle/CacheBundle";
import { MemoryStore } from "../../src/rs/cache/store/MemoryStore";
import { RecordingCacheStore } from "../../src/rs/cache/store/RecordingCacheStore";
import { Scene } from "../../src/rs/scene/Scene";
import { buildWorkerState } from "./RecordingWorkerState";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const BUNDLES_DIR = "./caches/bundles";

enum BundleCommand {
    BUILD = 0,
    CHECK = 1,
}

function parseArgs(): { command: BundleCommand; encounterIds: EncounterId[] } {
    const args = process.argv.slice(2);
    const validIds = Object.values(EncounterId);
    if (args[0] === "--check") {
        return { command: BundleCommand.CHECK, encounterIds: validIds };
    }
    if (args[0] === "all") {
        return { command: BundleCommand.BUILD, encounterIds: validIds };
    }
    const encounterIds = args.map((arg) => {
        const encounterId = validIds.find((id) => id === arg);
        if (!encounterId) {
            throw new Error(
                `Usage: bundle-encounter.ts <encounterId...> | all | --check. Valid ids: ${validIds.join(
                    ", ",
                )}`,
            );
        }
        return encounterId;
    });
    if (encounterIds.length === 0) {
        throw new Error("Usage: bundle-encounter.ts <encounterId...> | all | --check");
    }
    return { command: BundleCommand.BUILD, encounterIds };
}

const SOURCE_HASH_ROOTS = [
    "src/mapviewer/game",
    "src/mapviewer/player",
    "src/mapviewer/webgl/loader",
    "src/mapviewer/worker",
    "src/rs",
    "scripts/cache/bundle-encounter.ts",
    "scripts/cache/RecordingWorkerState.ts",
];

function listSourceFiles(root: string): string[] {
    if (fs.statSync(root).isFile()) {
        return [root];
    }
    return fs
        .readdirSync(root, { withFileTypes: true })
        .flatMap((entry) => listSourceFiles(`${root}/${entry.name}`))
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

function computeSourceHash(): string {
    const hash = createHash("sha1");
    for (const file of SOURCE_HASH_ROOTS.flatMap(listSourceFiles).sort()) {
        hash.update(file);
        hash.update(fs.readFileSync(file));
    }
    return hash.digest("hex");
}

type BundleManifest = {
    encounterId: EncounterId;
    cacheName: string;
    byteSize: number;
    sourceHash: string;
};

function checkBundles(encounterIds: EncounterId[]): void {
    const sourceHash = computeSourceHash();
    let stale = 0;
    for (const encounterId of encounterIds) {
        const manifestPath = `${BUNDLES_DIR}/${encounterId}.json`;
        if (!fs.existsSync(manifestPath)) {
            console.log(`${encounterId}: missing`);
            stale++;
            continue;
        }
        const manifest = loadJsonFile<BundleManifest>(manifestPath);
        const fresh = manifest.sourceHash === sourceHash;
        console.log(`${encounterId}: ${fresh ? "fresh" : "stale"}`);
        if (!fresh) {
            stale++;
        }
    }
    if (stale > 0) {
        process.exit(1);
    }
}

function loadJsonFile<T>(path: string): T {
    return JSON.parse(fs.readFileSync(path, "utf8"));
}

// The minimap widget always requests map square loads for the 3x3 block around wherever the
// camera currently is (MinimapContainer.tsx), regardless of what an encounter declares. Starting
// on any of an encounter's own squares therefore always loads that square's full 3x3 neighborhood
// too, so the bundle needs every one of those squares actually loaded, not just the declared ones.
function paddedMapSquares(mapSquares: readonly MapSquareCoord[]): MapSquareCoord[] {
    const seen = new Set<number>();
    const padded: MapSquareCoord[] = [];
    for (const { mapX, mapY } of mapSquares) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const x = mapX + dx;
                const y = mapY + dy;
                const key = x * 100000 + y;
                if (!seen.has(key)) {
                    seen.add(key);
                    padded.push({ mapX: x, mapY: y });
                }
            }
        }
    }
    return padded;
}

function buildXteasRecord(
    recordedReads: readonly { indexId: number; archiveId: number }[],
    xteas: Map<number, number[]>,
): Record<string, readonly number[]> {
    const record: Record<string, readonly number[]> = {};
    const mapArchiveIds = recordedReads
        .filter((read) => read.indexId === IndexType.DAT2.maps)
        .map((read) => read.archiveId)
        .sort((a, b) => a - b);
    for (const archiveId of mapArchiveIds) {
        const key = xteas.get(archiveId);
        if (key) {
            record[String(archiveId)] = key;
        }
    }
    return record;
}

async function buildBundle(encounterId: EncounterId, sourceHash: string): Promise<void> {
    const encounter = getEncounter(encounterId);

    const caches = loadCacheInfos();
    const cacheList = loadCacheList(caches);
    const cacheInfo = cacheList.latest;
    const loadedCache = loadCache(cacheInfo);

    const memoryStore = MemoryStore.fromFiles(loadedCache.files);
    const allIndexIds: number[] = [];
    memoryStore.indexFiles.forEach((indexFile, id) => {
        if (indexFile) {
            allIndexIds.push(id);
        }
    });

    const recordingStore = new RecordingCacheStore(memoryStore);
    const cacheSystem = CacheSystem.fromStore(recordingStore, allIndexIds);

    const objSpawns = loadJsonFile<ObjSpawn[]>("./src/mapviewer/data/obj/obj-spawns.json");
    const npcSpawns = loadJsonFile<NpcSpawn[]>("./src/mapviewer/data/npc/npc-spawns-osrs.json");

    const state = buildWorkerState(loadedCache, cacheSystem, objSpawns, npcSpawns);

    const mapLoader = new SdMapDataLoader();
    mapLoader.init();
    for (const { mapX, mapY } of paddedMapSquares(encounter.mapSquares)) {
        console.log(`Loading map square ${mapX},${mapY} for ${encounterId}`);
        await mapLoader.load(state, {
            mapX,
            mapY,
            maxLevel: Scene.MAX_LEVELS - 1,
            loadObjs: true,
            loadNpcs: encounter.ambientNpcs,
            smoothTerrain: false,
            minimizeDrawCalls: false,
            loadedTextureIds: new Set(),
        });
    }

    console.log(`Loading actors for ${encounterId}`);
    const actorLoader = new ActorRenderDataLoader();
    actorLoader.init();
    await actorLoader.load(state, {
        encounterId,
        loadedTextureIds: new Set(),
        preview: undefined,
    });

    // WebGLMapViewerRenderer.initTextureArray() preloads every texture id in the cache into one
    // GPU texture array at startup (unconditionally for oldschool caches - see its
    // maxPreloadTextures), independently of any specific map square or actor. Mirror that so the
    // bundle isn't missing reads the renderer performs before any map/actor load even runs.
    console.log(
        `Loading all ${state.textureLoader.getTextureIds().length} textures for ${encounterId}`,
    );
    for (const textureId of state.textureLoader.getTextureIds()) {
        try {
            state.textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
        } catch (e) {}
    }

    const recordedReads = recordingStore.recordedReads;
    console.log(`Recorded ${recordedReads.length} (index, archive) reads`);

    const entries: CacheBundleEntry[] = recordedReads.map(({ indexId, archiveId }) => ({
        indexId,
        archiveId,
        data: memoryStore.read(indexId, archiveId),
    }));

    const header: CacheBundleHeader = {
        encounterId,
        cacheInfo: loadedCache.info,
        indexIds: allIndexIds,
        xteas: buildXteasRecord(recordedReads, loadedCache.xteas),
    };

    const bundleBytes = encodeCacheBundle({ header, entries });

    fs.mkdirSync(BUNDLES_DIR, { recursive: true });
    const bundlePath = `${BUNDLES_DIR}/${encounterId}.bundle`;
    const manifestPath = `${BUNDLES_DIR}/${encounterId}.json`;

    fs.writeFileSync(
        bundlePath,
        Buffer.from(bundleBytes.buffer, bundleBytes.byteOffset, bundleBytes.byteLength),
    );
    fs.writeFileSync(
        manifestPath,
        JSON.stringify(
            {
                encounterId,
                cacheName: loadedCache.info.name,
                byteSize: bundleBytes.byteLength,
                sourceHash,
            } satisfies BundleManifest,
            null,
            4,
        ),
    );

    console.log(`Wrote ${bundlePath} (${bundleBytes.byteLength} bytes) and ${manifestPath}`);
}

async function main(): Promise<void> {
    const { command, encounterIds } = parseArgs();
    if (command === BundleCommand.CHECK) {
        checkBundles(encounterIds);
        return;
    }
    const sourceHash = computeSourceHash();
    for (const encounterId of encounterIds) {
        await buildBundle(encounterId, sourceHash);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
