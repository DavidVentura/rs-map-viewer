// Shared by bundle-encounter.ts and any verification script that needs to run the real map/actor
// loaders in Node against an arbitrary CacheSystem (full or bundle-backed).
import type { NpcSpawn } from "../../src/mapviewer/data/npc/NpcSpawn";
import type { ObjSpawn } from "../../src/mapviewer/data/obj/ObjSpawn";
import type { WorkerState } from "../../src/mapviewer/worker/RenderDataWorker";
import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../../src/rs/config/loctype/LocModelLoader";
import { NpcModelLoader } from "../../src/rs/config/npctype/NpcModelLoader";
import { ObjModelLoader } from "../../src/rs/config/objtype/ObjModelLoader";
import { VarManager } from "../../src/rs/config/vartype/VarManager";
import { MapImageRenderer } from "../../src/rs/map/MapImageRenderer";
import { SceneBuilder } from "../../src/rs/scene/SceneBuilder";

// Stub the two browser Canvas APIs SdMapDataLoader's minimap-blob step uses. Both are only reached
// after every cache read that step performs (locTypeLoader.load(), already covered by scene
// building), so stubbing them changes nothing about what gets read from the cache.
class StubOffscreenCanvas {
    constructor(
        readonly width: number,
        readonly height: number,
    ) {}
    getContext() {
        return { putImageData() {} };
    }
    convertToBlob(): Promise<Blob> {
        return Promise.resolve(new Blob());
    }
}
class StubImageData {
    readonly data: Uint8ClampedArray;
    constructor(
        readonly width: number,
        readonly height: number,
    ) {
        this.data = new Uint8ClampedArray(width * height * 4);
    }
}
(globalThis as any).OffscreenCanvas ??= StubOffscreenCanvas;
(globalThis as any).ImageData ??= StubImageData;

// Mirrors RenderDataWorker.initWorker's construction (the reference for what a running app reads),
// minus the wasm precompilation and browser Cache Storage handle: Bzip2/Gzip fall back to their
// pure-JS decoders without wasm init, and mapImageCache is never touched by the map/actor loaders.
export function buildWorkerState(
    loadedCache: WorkerState["cache"],
    cacheSystem: CacheSystem,
    objSpawns: ObjSpawn[],
    npcSpawns: NpcSpawn[],
): WorkerState {
    const loaderFactory = getCacheLoaderFactory(loadedCache.info, cacheSystem);

    const underlayTypeLoader = loaderFactory.getUnderlayTypeLoader();
    const overlayTypeLoader = loaderFactory.getOverlayTypeLoader();

    const varBitTypeLoader = loaderFactory.getVarBitTypeLoader();

    const locTypeLoader = loaderFactory.getLocTypeLoader();
    const objTypeLoader = loaderFactory.getObjTypeLoader();
    const npcTypeLoader = loaderFactory.getNpcTypeLoader();

    const basTypeLoader = loaderFactory.getBasTypeLoader();

    const modelLoader = loaderFactory.getModelLoader();
    const textureLoader = loaderFactory.getTextureLoader();

    const seqTypeLoader = loaderFactory.getSeqTypeLoader();
    const seqFrameLoader = loaderFactory.getSeqFrameLoader();
    const skeletalSeqLoader = loaderFactory.getSkeletalSeqLoader();

    const mapFileLoader = loaderFactory.getMapFileLoader();

    const varManager = new VarManager(varBitTypeLoader);
    const questTypeLoader = loaderFactory.getQuestTypeLoader();
    if (questTypeLoader) {
        varManager.setQuestsCompleted(questTypeLoader);
    }

    const locModelLoader = new LocModelLoader(
        locTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
    );

    const objModelLoader = new ObjModelLoader(objTypeLoader, modelLoader, textureLoader);

    const npcModelLoader = new NpcModelLoader(
        npcTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
        varManager,
    );

    const sceneBuilder = new SceneBuilder(
        loadedCache.info,
        mapFileLoader,
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        locModelLoader,
        loadedCache.xteas,
    );

    const mapImageRenderer = new MapImageRenderer(
        textureLoader,
        locTypeLoader,
        loaderFactory.getMapScenes(),
        loaderFactory.getMapFunctions(),
    );

    return {
        cache: loadedCache,
        cacheSystem,
        cacheLoaderFactory: loaderFactory,

        locTypeLoader,
        objTypeLoader,
        npcTypeLoader,

        seqTypeLoader,
        basTypeLoader,

        textureLoader,
        seqFrameLoader,
        skeletalSeqLoader,

        locModelLoader,
        objModelLoader,
        npcModelLoader,

        sceneBuilder,

        varManager,

        mapImageRenderer,
        mapImageCache: {} as Cache,

        objSpawns,
        npcSpawns,
    };
}
