import { vec3 } from "gl-matrix";

import { IndexType } from "../rs/cache/IndexType";
import { LoadedCache } from "../rs/cache/LoadedCache";
import { CacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import { LocTypeLoader } from "../rs/config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../rs/config/objtype/ObjTypeLoader";
import { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../rs/config/vartype/VarManager";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { TextureLoader } from "../rs/texture/TextureLoader";
import { isWallpaperEngine } from "../util/DeviceUtil";
import { CacheList } from "./Caches";
import { Camera, CameraView } from "./Camera";
import { InputManager } from "./InputManager";
import { MapManager } from "./MapManager";
import { MapViewerRenderer } from "./MapViewerRenderer";
import { MapViewerRendererType, createRenderer } from "./MapViewerRenderers";
import { createViewerLoaders } from "./ViewerLoaders";
import { actorAssets } from "./assets/ActorAssets";
import { HudAssets, loadHudAssets } from "./assets/HudAssets";
import { declaredSeqIds } from "./assets/cacheRoots";
import { resolveEncounterAnimations } from "./assets/encounterAnimations";
import { AudioFeedback } from "./audio/AudioFeedback";
import { MusicPlayer } from "./audio/MusicPlayer";
import { AnimPreviewParams, SeqRange } from "./game/AnimPreview";
import { Encounter, EncounterId, buildPreviewEncounter, getEncounter } from "./game/Encounter";
import { EncounterAnimations } from "./game/EncounterAnimations";
import { EquipmentChange } from "./game/Equipment";
import { GameWorld } from "./game/GameWorld";
import { SeqCatalog, loadSeqCatalog } from "./game/SeqCatalog";
import { RenderDataWorkerPool } from "./worker/RenderDataWorkerPool";

const DEFAULT_RENDER_DISTANCE = isWallpaperEngine ? 512 : 64;

export class MapViewer {
    inputManager: InputManager = new InputManager();
    camera: Camera;

    pathfinder: Pathfinder = new Pathfinder();

    renderer: MapViewerRenderer;

    world!: GameWorld;

    // Cache
    loadedCache!: LoadedCache;
    loaderFactory!: CacheLoaderFactory;

    textureLoader!: TextureLoader;
    seqTypeLoader!: SeqTypeLoader;
    seqFrameLoader!: SeqFrameLoader;
    seqCatalog!: SeqCatalog;
    encounterAnimations!: EncounterAnimations;
    hudAssets!: HudAssets;

    locTypeLoader!: LocTypeLoader;
    objTypeLoader!: ObjTypeLoader;
    npcTypeLoader!: NpcTypeLoader;

    basTypeLoader!: BasTypeLoader;

    varManager!: VarManager;

    isNewTextureAnim: boolean = false;

    // Settings

    // Tile distance
    renderDistance: number = DEFAULT_RENDER_DISTANCE;
    // Map square distance
    unloadDistance: number = 2;

    debugText?: string;

    minimapImageUrls: Map<number, string> = new Map();

    cameraSpeed: number = 1;

    readonly musicPlayer: MusicPlayer = new MusicPlayer();
    readonly audioFeedback: AudioFeedback;

    constructor(
        readonly workerPool: RenderDataWorkerPool,
        readonly cacheList: CacheList,
        readonly encounterId: EncounterId,
        rendererType: MapViewerRendererType,
        cache: LoadedCache,
        readonly animPreview?: AnimPreviewParams,
        readonly godMode: boolean = false,
        readonly gearOverride: readonly EquipmentChange[] = [],
    ) {
        this.audioFeedback = new AudioFeedback(new AudioContext());
        // Starting the camera at this encounter's spawn rather than a fixed literal keeps the
        // camera over the encounter's squares, the only ones its pack holds.
        const encounter = getEncounter(encounterId);
        const { playerSpawn } = encounter;
        this.camera = new Camera(
            playerSpawn.x / 128,
            -26,
            playerSpawn.y / 128,
            -245,
            encounter.initialCameraYaw,
        );
        this.renderer = createRenderer(rendererType, this);
        this.initCache(cache);
    }

    // The pack holds only the previewed range, so a spot anim outside it (see the renderer's
    // jumpToPreviewGfx) needs a new pack: the page reloads on the url of the new range.
    reloadWithSpotAnimPreviewRange(range: SeqRange): void {
        if (this.animPreview?.kind !== "SPOT_ANIMS") {
            throw new Error("Spot anim preview range set outside the spot anim viewer");
        }
        this.reloadWithSearchParam("gfx", `${range.from}-${range.to}`);
    }

    // A cache other than the loaded one is a different pack, so the page reloads on its url.
    reloadWithCache(cacheName: string): void {
        this.reloadWithSearchParam("cache", cacheName);
    }

    // The url only ever holds what the user typed; a reload keeps all of it and changes one key.
    private reloadWithSearchParam(key: string, value: string): void {
        const params = new URLSearchParams(window.location.search);
        params.set(key, value);
        window.location.search = params.toString();
    }

    get encounter(): Encounter {
        const encounter = getEncounter(this.encounterId);
        return this.animPreview ? buildPreviewEncounter(encounter) : encounter;
    }

    init(): void {
        this.syncMusicTrack();
    }

    // Sets the music player's track to the current encounter's, if it isn't already. Cheap to
    // call every frame since setTrack() no-ops when the file hasn't changed; that is how a future
    // runtime encounter switch would pick up its music without any extra wiring.
    syncMusicTrack(): void {
        this.musicPlayer.setTrack(this.encounter.musicFile);
    }

    dispose(): void {
        this.musicPlayer.dispose();
        void this.audioFeedback.close();
    }

    private initCache(cache: LoadedCache): void {
        this.loadedCache = cache;

        const loaders = createViewerLoaders(cache.info, cache.system);
        this.loaderFactory = loaders.loaderFactory;
        this.textureLoader = loaders.textureLoader;
        this.seqTypeLoader = loaders.seqTypeLoader;
        this.seqFrameLoader = loaders.seqFrameLoader;
        this.locTypeLoader = loaders.locTypeLoader;
        this.objTypeLoader = loaders.objTypeLoader;
        this.npcTypeLoader = loaders.npcTypeLoader;
        this.basTypeLoader = loaders.basTypeLoader;
        this.varManager = loaders.varManager;

        this.isNewTextureAnim = cache.info.game === "runescape" && cache.info.revision >= 681;

        // The pack was declared from the base encounter even in the animation viewer (see
        // packRequest), so its seq roots come from the same assets.
        const assets = actorAssets(getEncounter(this.encounterId), this.animPreview);
        this.seqCatalog = loadSeqCatalog(
            declaredSeqIds(assets),
            loaders.seqTypeLoader,
            loaders.seqFrameLoader,
        );
        this.encounterAnimations = resolveEncounterAnimations(
            this.encounter,
            assets,
            this.seqCatalog,
        );
        this.hudAssets = loadHudAssets(cache.system.getIndex(IndexType.DAT2.sprites));

        this.initWorld();
        this.renderer.initCache();
    }

    setRenderer(renderer: MapViewerRenderer): void {
        this.renderer = renderer;
        this.initWorld();
        this.renderer.initCache();
    }

    private initWorld(): void {
        this.world = new GameWorld(this.renderer.createTerrain(), this.encounterAnimations);
        this.world.setGodMode(this.godMode);
        this.world.setGearOverride(this.gearOverride);
    }

    /**
     * Sets the camera position to a new arbitrary position
     * @param newView Any of the items you want to move: Position, pitch, yaw
     */
    setCamera(newView: Partial<CameraView>): void {
        if (newView.position) {
            vec3.copy(this.camera.pos, newView.position);
        }
        if (newView.pitch !== undefined) {
            this.camera.pitch = newView.pitch;
        }
        if (newView.yaw !== undefined) {
            this.camera.yaw = newView.yaw;
        }
        if (newView.fov !== undefined) {
            this.camera.fov = newView.fov;
        }
        if (newView.orthoZoom !== undefined) {
            this.camera.orthoZoom = newView.orthoZoom;
        }
        this.camera.updated = true;
    }

    updateVars(): void {
        this.workerPool.setVars(this.varManager.values);
    }

    getMinimapImageUrl(mapX: number, mapY: number): string | undefined {
        if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
            return undefined;
        }
        this.renderer.mapManager.loadMap(mapX, mapY);
        return this.minimapImageUrls.get(getMapSquareId(mapX, mapY));
    }

    setMinimapImageUrl(mapX: number, mapY: number, url: string): void {
        const mapId = getMapSquareId(mapX, mapY);
        const old = this.minimapImageUrls.get(mapId);
        if (old) {
            URL.revokeObjectURL(old);
        }
        this.minimapImageUrls.set(mapId, url);
    }
}
