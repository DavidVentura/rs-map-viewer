import { vec3 } from "gl-matrix";

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
import { Camera, CameraView, ProjectionType } from "./Camera";
import { InputManager } from "./InputManager";
import { MapManager } from "./MapManager";
import { MapViewerRenderer } from "./MapViewerRenderer";
import { MapViewerRendererType, createRenderer } from "./MapViewerRenderers";
import { createViewerLoaders } from "./ViewerLoaders";
import { MusicPlayer } from "./audio/MusicPlayer";
import { NpcSpawn } from "./data/npc/NpcSpawn";
import { ObjSpawn } from "./data/obj/ObjSpawn";
import { AnimPreviewParams, SeqRange } from "./game/AnimPreview";
import { Encounter, EncounterId, buildPreviewEncounter, getEncounter } from "./game/Encounter";
import { GameWorld } from "./game/GameWorld";
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

    // State
    needsSearchParamUpdate: boolean = false;
    lastTimeSearchParamsUpdated: number = 0;

    debugText?: string;

    minimapImageUrls: Map<number, string> = new Map();

    cameraSpeed: number = 1;

    readonly musicPlayer: MusicPlayer = new MusicPlayer();

    constructor(
        readonly workerPool: RenderDataWorkerPool,
        readonly cacheList: CacheList,
        readonly objSpawns: ObjSpawn[],
        readonly npcSpawns: NpcSpawn[],
        readonly encounterId: EncounterId,
        rendererType: MapViewerRendererType,
        cache: LoadedCache,
        readonly animPreview?: AnimPreviewParams,
        readonly godMode: boolean = false,
    ) {
        // Starting the camera at this encounter's spawn rather than a fixed literal keeps the
        // camera over the encounter's squares, the only ones its pack holds.
        const { playerSpawn } = getEncounter(encounterId);
        this.camera = new Camera(playerSpawn.x / 128, -26, playerSpawn.y / 128, -245, 1862);
        this.renderer = createRenderer(rendererType, this);
        this.initCache(cache);
    }

    // The pack holds only the previewed range, so a spot anim outside it (see the renderer's
    // jumpToPreviewGfx) needs a new pack: the page reloads on the url of the new range.
    reloadWithSpotAnimPreviewRange(range: SeqRange): void {
        if (this.animPreview?.kind !== "SPOT_ANIMS") {
            throw new Error("Spot anim preview range set outside the spot anim viewer");
        }
        this.reloadWithSearchParams({
            ...this.getSearchParams(),
            gfx: `${range.from}-${range.to}`,
        });
    }

    // A cache other than the loaded one is a different pack, so the page reloads on its url.
    reloadWithCache(cacheName: string): void {
        this.reloadWithSearchParams({ ...this.getSearchParams(), cache: cacheName });
    }

    private reloadWithSearchParams(params: Record<string, string>): void {
        window.location.search = new URLSearchParams(params).toString();
    }

    get encounter(): Encounter {
        const encounter = getEncounter(this.encounterId);
        return this.animPreview ? buildPreviewEncounter(encounter) : encounter;
    }

    getSearchParams(): Record<string, string> {
        const cx = this.camera.getPosX().toFixed(2).toString();
        const cy = (-this.camera.getPosY()).toFixed(2);
        const cz = this.camera.getPosZ().toFixed(2).toString();

        const yaw = this.camera.yaw & 2047;

        const p = (this.camera.pitch | 0).toString();
        const y = yaw.toString();

        const params: Record<string, string> = {
            cx,
            cy,
            cz,
            p,
            y,
        };

        if (this.camera.projectionType === ProjectionType.ORTHO) {
            params["pt"] = "o";
            params["z"] = this.camera.orthoZoom.toString();
        } else {
            params["pt"] = "p";
        }

        if (this.loadedCache.info.name !== this.cacheList.latest.name) {
            params["cache"] = this.loadedCache.info.name;
        }

        if (this.encounterId !== EncounterId.LUMBRIDGE) {
            params["enc"] = this.encounterId;
        }

        if (this.animPreview?.kind === "NPC_SEQS") {
            params["anim"] = this.animPreview.npcTypeId.toString();
            params["seqs"] = `${this.animPreview.seqRange.from}-${this.animPreview.seqRange.to}`;
        } else if (this.animPreview?.kind === "SPOT_ANIMS") {
            params["gfx"] = `${this.animPreview.range.from}-${this.animPreview.range.to}`;
        }

        params["v"] = "1";

        return params;
    }

    applySearchParams(searchParams: URLSearchParams) {
        const cx = searchParams.get("cx");
        const cy = searchParams.get("cy");
        const cz = searchParams.get("cz");

        const pitch = searchParams.get("p");
        const yaw = searchParams.get("y");

        const v = searchParams.get("v");

        if (searchParams.get("pt") === "o") {
            this.camera.projectionType = ProjectionType.ORTHO;
        } else if (searchParams.get("pt") === "p") {
            this.camera.projectionType = ProjectionType.PERSPECTIVE;
        }

        const zoom = searchParams.get("z");
        if (zoom) {
            this.camera.orthoZoom = parseInt(zoom);
        }

        if (cx && cy && cz) {
            const pos = vec3.fromValues(parseFloat(cx), -parseFloat(cy), parseFloat(cz));
            this.camera.pos = pos;
        }
        if (pitch) {
            this.camera.pitch = parseInt(pitch);
            if (!v) {
                this.camera.pitch = -this.camera.pitch;
            }
        }
        if (yaw) {
            this.camera.yaw = parseInt(yaw);
            if (!v) {
                this.camera.yaw = 2048 - this.camera.yaw;
            }
        }
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

        this.initWorld();
        this.renderer.initCache();

        this.updateSearchParams();
    }

    setRenderer(renderer: MapViewerRenderer): void {
        this.renderer = renderer;
        this.initWorld();
        this.renderer.initCache();
    }

    private initWorld(): void {
        this.world = new GameWorld(
            this.renderer.createTerrain(),
            this.seqTypeLoader,
            this.seqFrameLoader,
        );
        this.world.setGodMode(this.godMode);
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

    updateSearchParams(): void {
        this.needsSearchParamUpdate = true;
        this.lastTimeSearchParamsUpdated = performance.now();
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
