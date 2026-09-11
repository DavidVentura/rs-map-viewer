import Denque from "denque";
import { vec2, vec4 } from "gl-matrix";
import { button, folder, monitor } from "leva";
import { FolderInput, Schema } from "leva/dist/declarations/src/types";
import {
    DrawCall,
    Framebuffer,
    App as PicoApp,
    PicoGL,
    Program,
    Renderbuffer,
    Texture,
    Timer,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { createTextureArray } from "../../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../../rs/MathConstants";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { Scene } from "../../rs/scene/Scene";
import { isWebGL2Supported } from "../../util/DeviceUtil";
import { PlayerCentredResidency, ResidencyPolicyKind } from "../MapManager";
import { MapSquareCoord } from "../MapSquareCoord";
import { MapViewer } from "../MapViewer";
import { MapViewerRenderer } from "../MapViewerRenderer";
import { MapViewerRendererType, WEBGL } from "../MapViewerRenderers";
import { AbilityTargetKind, AimMode, Delivery, WeaponStyle, aimModeFor } from "../game/Ability";
import { AnimPreviewParams, buildPreviewEnemyType, stepSeqId } from "../game/AnimPreview";
import { AnimationPlayback, AnimationState, sequenceDurationSeconds } from "../game/Animation";
import { CombatEventKind } from "../game/CombatEvent";
import { Encounter, EncounterSpawnMode } from "../game/Encounter";
import { Enemy, EnemyState } from "../game/Enemy";
import { EnemyBehaviour } from "../game/EnemyType";
import { EQUIPMENT_PATH_LABELS, equippedVisualItemIds, itemIdForTier } from "../game/Equipment";
import { AbilityInput, AbilitySlotInput, GameWorld, PickupTarget } from "../game/GameWorld";
import { GroundItem } from "../game/GroundItem";
import { Player, PlayerInput } from "../game/Player";
import { Projectile } from "../game/Projectile";
import { Terrain } from "../game/Terrain";
import { VisualEffect } from "../game/VisualEffect";
import { EnemyScreenCandidate, ScreenPoint, ScreenRect, pickEnemyNear } from "../game/enemyPicking";
import { computeRoofHiddenTiles, decodeTileKey } from "../game/roofHiding";
import { summarizeModifiers } from "../game/upgrades";
import {
    AbilitySlotBlockReason,
    AbilitySlotHudInfo,
    BossHudInfo,
    GroundItemHudInfo,
    HudFrame,
    PickupFlashEvent,
    SplatEvent,
    SplatKind,
    UpgradeCardHudInfo,
    WaveStatus,
} from "../hud/HudFrame";
import { HudRegionKind, computeHudLayout, hitTestHud } from "../hud/hudDraw";
import { DataTextureFormat, DataTextureRing, DataTextureSlot } from "./DataTextureRing";
import { DrawRange, NULL_DRAW_RANGE } from "./DrawRange";
import { InteractType } from "./InteractType";
import { MapDrawPass } from "./MapDrawPass";
import { NPC_DATA_TEXTURE_BUFFER_SIZE, WebGLMapSquare } from "./WebGLMapSquare";
import { WebGLTerrain } from "./WebGLTerrain";
import {
    ACTOR_INSTANCE_TEXELS,
    ActorInstance,
    writeActorInstance,
} from "./actor/ActorInstanceData";
import { ActorMesh } from "./actor/ActorMeshBuilder";
import {
    ActorAnimation,
    EnemyTypeAnimationSet,
    PreviewGfxBake,
    getEnemyAnimation,
    getGroundItemAnimation,
    getPlayerBodyAnimation,
    getPlayerItemAnimation,
} from "./actor/ActorRenderData";
import { WebGLActorBuffer } from "./actor/WebGLActorBuffer";
import { screenToGroundPoint, worldToScreen } from "./groundPoint";
import { ActorBufferData } from "./loader/ActorBufferData";
import { ActorLoaderInput } from "./loader/ActorLoaderInput";
import { ActorRenderDataLoader } from "./loader/ActorRenderDataLoader";
import { SdMapData } from "./loader/SdMapData";
import { SdMapDataLoader } from "./loader/SdMapDataLoader";
import { SdMapLoaderInput } from "./loader/SdMapLoaderInput";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createActorProgram,
    createMainProgram,
    createNpcProgram,
} from "./shaders/Shaders";
import { isWithinTickRange, worldToMapSquare } from "./tickRange";

const MAX_TEXTURES = 2048;
const TEXTURE_SIZE = 128;

// When the cursor isn't exactly over an enemy's pixels, pick the nearest enemy whose projected
// screen rect is within this radius, so aiming stays forgiving without becoming auto-aim.
const ENEMY_HOVER_PICK_RADIUS_PX = 20;
const ENEMY_BODY_HEIGHT_SCALE = 3;

// Leva never overwrites an existing input's value when a schema is re-registered, so read-only
// preview labels are polled monitors instead of static values.
const PREVIEW_LABEL_MONITOR = { graph: false, interval: 200 };
// Ids baked either side of a gfx id typed into the viewer, so Prev/Next still have neighbours to
// step through without the bake growing to the whole cache.
const PREVIEW_GFX_REBAKE_WINDOW = 10;

// Generous click target for a ground item: covers its floor label above the point, plus a radius
// around the item's own projected screen point.
const GROUND_ITEM_LABEL_HALF_WIDTH_PX = 90;
const GROUND_ITEM_LABEL_HEIGHT_PX = 44;
const GROUND_ITEM_PICK_RADIUS_PX = 32;

// Projectiles and visual effects share the actor buffer's instance capacity with the player and
// every enemy spawn.
const MAX_PROJECTILES = GameWorld.MAX_PROJECTILES;
const MAX_VISUAL_EFFECTS = GameWorld.MAX_VISUAL_EFFECTS;

const ACTOR_DATA_TEXTURE_BUFFER_SIZE = 5;

// The gfx preview hovers its current spot anim one tile above the ground (TILE_SIZE) so it reads
// clearly in the ortho camera instead of sinking into the terrain.
const PREVIEW_GFX_HOVER_HEIGHT = 128;

function encodeNpcInfo(interactType: InteractType, rotation: number, level: number): number {
    return (interactType << 13) | (rotation << 2) | level;
}

function keyForAbilitySlot(index: number, barLength: number): string | undefined {
    if (index === barLength - 1) {
        return "Digit4";
    }
    switch (index) {
        case 0:
            return "Digit1";
        case 1:
            return "Digit2";
        case 2:
            return "Digit3";
        default:
            return undefined;
    }
}

interface ColorRgb {
    r: number;
    g: number;
    b: number;
}

type ActiveActor =
    | { kind: "playerBody"; player: Player }
    | { kind: "playerItem"; player: Player; itemId: number }
    | { kind: "enemy"; enemy: Enemy; animSet: EnemyTypeAnimationSet }
    | { kind: "projectile"; projectile: Projectile }
    | { kind: "effect"; effect: VisualEffect }
    | { kind: "groundItem"; item: GroundItem }
    | { kind: "previewGfx" };

type ActorPlacement = Omit<ActorInstance, "matrixOffset" | "alphaOffset">;

enum TextureFilterMode {
    DISABLED,
    BILINEAR,
    TRILINEAR,
    ANISOTROPIC_2X,
    ANISOTROPIC_4X,
    ANISOTROPIC_8X,
    ANISOTROPIC_16X,
}

function getMaxAnisotropy(mode: TextureFilterMode): number {
    switch (mode) {
        case TextureFilterMode.ANISOTROPIC_2X:
            return 2;
        case TextureFilterMode.ANISOTROPIC_4X:
            return 4;
        case TextureFilterMode.ANISOTROPIC_8X:
            return 8;
        case TextureFilterMode.ANISOTROPIC_16X:
            return 16;
        default:
            return 1;
    }
}

function optimizeAssumingFlatsHaveSameFirstAndLastData(gl: WebGL2RenderingContext) {
    const epv = gl.getExtension("WEBGL_provoking_vertex");
    if (epv) {
        epv.provokingVertexWEBGL(epv.FIRST_VERTEX_CONVENTION_WEBGL);
    }
}

export class WebGLMapViewerRenderer extends MapViewerRenderer<WebGLMapSquare> {
    type: MapViewerRendererType = WEBGL;

    dataLoader = new SdMapDataLoader();
    actorLoader = new ActorRenderDataLoader();

    app!: PicoApp;
    gl!: WebGL2RenderingContext;

    timer!: Timer;

    hasMultiDraw: boolean = false;

    quadPositions?: VertexBuffer;
    quadArray?: VertexArray;

    // Shaders
    shadersPromise?: Promise<Program[]>;
    mainProgram?: Program;
    mainAlphaProgram?: Program;
    npcProgram?: Program;
    actorProgram?: Program;
    frameProgram?: Program;
    frameFxaaProgram?: Program;

    // Uniforms
    sceneUniformBuffer?: UniformBuffer;

    cameraPosUni: vec2 = vec2.fromValues(0, 0);
    resolutionUni: vec2 = vec2.fromValues(0, 0);

    // Framebuffers
    needsFramebufferUpdate: boolean = false;

    colorTarget?: Renderbuffer;
    depthTarget?: Renderbuffer;
    framebuffer?: Framebuffer;

    textureColorTarget?: Texture;
    textureFramebuffer?: Framebuffer;

    // Textures
    textureFilterMode: TextureFilterMode = TextureFilterMode.DISABLED;

    textureArray?: Texture;
    textureMaterials?: Texture;

    textureIds: number[] = [];
    loadedTextureIds: Set<number> = new Set();

    mapsToLoad: Denque<SdMapData> = new Denque();
    actorBufferToLoad?: ActorBufferData;
    loadingActors: boolean = false;

    frameDrawCall?: DrawCall;
    frameFxaaDrawCall?: DrawCall;

    // Settings
    maxLevel: number = Scene.MAX_LEVELS - 1;

    skyColor: vec4 = vec4.fromValues(0, 0, 0, 1);
    fogDepth: number = 16;

    brightness: number = 1.0;
    colorBanding: number = 255;

    smoothTerrain: boolean = false;

    cullBackFace: boolean = true;

    msaaEnabled: boolean = false;
    fxaaEnabled: boolean = false;

    loadObjs: boolean = true;
    loadNpcs: boolean = true;
    runEnabled = true;
    override fpsLimit = 60;

    // State
    lastClientTick: number = 0;
    lastTick: number = 0;

    highlightedEnemy?: Enemy;
    // Set by a click on a ground item's label/mesh (see buildPickupInput); cleared by a later click
    // elsewhere, by the item being picked up or expiring, or by resolving to nothing on load.
    private pickupTargetItemId?: number;

    npcRenderCount: number = 0;
    npcRenderData: Uint16Array = new Uint16Array(16 * 4);

    npcDataTextures?: DataTextureRing;

    // Actors: player, enemies, projectiles and visual effects, decoupled from any map square.
    actorBuffer?: WebGLActorBuffer;
    // Textures the current actor bake needs that haven't been uploaded yet; set once the actor
    // buffer's own vertex/index data has finished its chunked upload (see uploadPendingActorData).
    private pendingActorTextures?: Map<number, Int32Array>;
    actorInstanceCount: number = 0;
    actorInstanceData: Uint32Array = new Uint32Array(16 * 4 * ACTOR_INSTANCE_TEXELS);
    actorDataTextures?: DataTextureRing;
    activeActorMeshes: ActorMesh[] = [];

    // The gfx preview's currently shown spot anim id and playback mode (see AnimPreview.ts's
    // SPOT_ANIMS mode): unlike the npc seq preview, there's no Enemy to own this state on, since a
    // gfx preview never spawns one.
    private previewGfxId?: number;
    // An id typed into the viewer that lies outside the baked range: honoured once the re-bake
    // around it has landed (see initPreviewGfxIfNeeded), re-queued if a later jump moved the
    // range again while a bake was already in flight.
    private requestedPreviewGfxId?: number;
    private previewGfxPlayback: AnimationPlayback = AnimationPlayback.LOOP;
    private readonly previewGfxAnimation = new AnimationState(-1);

    encounter: Encounter;
    encounterSpawned: boolean = false;
    // Flips true the first time pinCameraToPlayer() actually repositions the camera after a spawn,
    // i.e. once the camera has settled on its real third-person framing instead of the raw spawn
    // coordinates. Used to gate the startup loading screen so the reveal never shows that jump.
    private hasPinnedCameraSinceSpawn: boolean = false;
    private encounterCleared: boolean = false;
    private bossPhaseLabel?: string;

    readonly terrain: WebGLTerrain;

    hideAbovePlane: number = Scene.MAX_LEVELS - 1;
    private lastRoofTileX?: number;
    private lastRoofTileY?: number;
    private lastRoofLevel?: number;
    private lastHiddenTiles: ReadonlySet<string> = new Set();
    private roofMaskedSquares: Set<WebGLMapSquare> = new Set();

    constructor(public mapViewer: MapViewer) {
        super(mapViewer, ResidencyPolicyKind.PLAYER_CENTRED);
        this.terrain = new WebGLTerrain(this.mapManager);
        this.encounter = mapViewer.encounter;
    }

    createTerrain(): Terrain {
        return this.terrain;
    }

    static isSupported(): boolean {
        return isWebGL2Supported;
    }

    async init(): Promise<void> {
        await super.init();

        this.app = PicoGL.createApp(this.canvas);
        this.gl = this.app.gl as WebGL2RenderingContext;

        // https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#use_webgl_provoking_vertex_when_its_available
        optimizeAssumingFlatsHaveSameFirstAndLastData(this.gl);

        this.timer = this.app.createTimer();

        this.npcDataTextures = new DataTextureRing(
            this.app,
            NPC_DATA_TEXTURE_BUFFER_SIZE,
            DataTextureFormat.RGBA16UI,
        );
        this.actorDataTextures = new DataTextureRing(
            this.app,
            ACTOR_DATA_TEXTURE_BUFFER_SIZE,
            DataTextureFormat.RGBA32UI,
        );

        // hack to get the right multi draw extension for picogl
        const state: any = this.app.state;
        const ext = this.gl.getExtension("WEBGL_multi_draw");
        PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED = ext;
        state.extensions.multiDrawInstanced = ext;

        this.hasMultiDraw = !!PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED;

        this.mapViewer.workerPool.initLoader(this.dataLoader);
        this.mapViewer.workerPool.initLoader(this.actorLoader);

        this.gl.getExtension("EXT_float_blend");

        this.app.enable(PicoGL.CULL_FACE);
        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.depthFunc(PicoGL.LEQUAL);
        this.app.enable(PicoGL.BLEND);
        this.app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);
        this.app.clearColor(0.0, 0.0, 0.0, 1.0);

        this.quadPositions = this.app.createVertexBuffer(
            PicoGL.FLOAT,
            2,
            new Float32Array([-1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1]),
        );
        this.quadArray = this.app.createVertexArray().vertexAttributeBuffer(0, this.quadPositions);

        this.shadersPromise = this.initShaders();

        this.sceneUniformBuffer = this.app.createUniformBuffer([
            PicoGL.FLOAT_MAT4, // mat4 u_viewProjMatrix;
            PicoGL.FLOAT_MAT4, // mat4 u_viewMatrix;
            PicoGL.FLOAT_MAT4, // mat4 u_projectionMatrix;
            PicoGL.FLOAT_VEC4, // vec4 u_skyColor;
            PicoGL.FLOAT_VEC2, // vec2 u_cameraPos;
            PicoGL.FLOAT, // float u_renderDistance;
            PicoGL.FLOAT, // float u_fogDepth;
            PicoGL.FLOAT, // float u_currentTime;
            PicoGL.FLOAT, // float u_brightness;
            PicoGL.FLOAT, // float u_colorBanding;
            PicoGL.FLOAT, // float u_isNewTextureAnim;
        ]);

        this.initFramebuffers();

        this.initTextures();

        console.log("Renderer init");
    }

    async initShaders(): Promise<Program[]> {
        const hasMultiDraw = this.hasMultiDraw;

        const programs = await this.app.createPrograms(
            createMainProgram(hasMultiDraw, false),
            createMainProgram(hasMultiDraw, true),
            createNpcProgram(hasMultiDraw, true),
            createActorProgram(hasMultiDraw, true),
            FRAME_PROGRAM,
            FRAME_FXAA_PROGRAM,
        );

        const [
            mainProgram,
            mainAlphaProgram,
            npcProgram,
            actorProgram,
            frameProgram,
            frameFxaaProgram,
        ] = programs;
        this.mainProgram = mainProgram;
        this.mainAlphaProgram = mainAlphaProgram;
        this.npcProgram = npcProgram;
        this.actorProgram = actorProgram;
        this.frameProgram = frameProgram;
        this.frameFxaaProgram = frameFxaaProgram;

        this.frameDrawCall = this.app.createDrawCall(frameProgram, this.quadArray);
        this.frameFxaaDrawCall = this.app.createDrawCall(frameFxaaProgram, this.quadArray);

        return programs;
    }

    initFramebuffers(): void {
        this.initFramebuffer();

        this.textureColorTarget = this.app.createTexture2D(this.app.width, this.app.height, {
            minFilter: PicoGL.LINEAR,
            magFilter: PicoGL.LINEAR,
        });
        this.textureFramebuffer = this.app
            .createFramebuffer()
            .colorTarget(0, this.textureColorTarget);
    }

    initFramebuffer(): void {
        this.framebuffer?.delete();
        this.colorTarget?.delete();
        this.depthTarget?.delete();

        let samples = 0;
        if (this.msaaEnabled) {
            samples = this.gl.getParameter(PicoGL.MAX_SAMPLES);
        }

        this.colorTarget = this.app.createRenderbuffer(
            this.app.width,
            this.app.height,
            PicoGL.RGBA8,
            samples,
        );
        this.depthTarget = this.app.createRenderbuffer(
            this.app.width,
            this.app.height,
            PicoGL.DEPTH_COMPONENT24,
            samples,
        );
        this.framebuffer = this.app
            .createFramebuffer()
            .colorTarget(0, this.colorTarget)
            .depthTarget(this.depthTarget);

        this.needsFramebufferUpdate = false;
    }

    override initCache(): void {
        this.encounter = this.mapViewer.encounter;
        super.initCache();

        this.queueLoadActors();

        if (this.app) {
            this.initTextures();
        }
        console.log("Renderer initCache", this.app);
    }

    initTextures(): void {
        const textureLoader = this.mapViewer.textureLoader;

        const allTextureIds = textureLoader.getTextureIds();

        this.textureIds = allTextureIds
            .filter((id) => textureLoader.isSd(id))
            .slice(0, MAX_TEXTURES - 1);

        this.initTextureArray();
        this.initMaterialsTexture();

        console.log("init textures", this.textureIds, allTextureIds.length);
    }

    initTextureArray() {
        if (this.textureArray) {
            this.textureArray.delete();
            this.textureArray = undefined;
        }
        this.loadedTextureIds.clear();

        console.time("load textures");

        const pixelCount = TEXTURE_SIZE * TEXTURE_SIZE;

        const textureCount = this.textureIds.length;
        const pixels = new Int32Array((textureCount + 1) * pixelCount);

        // White texture
        pixels.fill(0xffffffff, 0, pixelCount);

        const cacheInfo = this.mapViewer.loadedCache.info;

        let maxPreloadTextures = textureCount;
        // we should check if the texture loader is procedural instead
        if (cacheInfo.game === "runescape" && cacheInfo.revision >= 508) {
            maxPreloadTextures = 64;
        }

        for (let i = 0; i < Math.min(textureCount, maxPreloadTextures); i++) {
            const textureId = this.textureIds[i];
            try {
                const texturePixels = this.mapViewer.textureLoader.getPixelsArgb(
                    textureId,
                    TEXTURE_SIZE,
                    true,
                    1.0,
                );
                pixels.set(texturePixels, (i + 1) * pixelCount);
            } catch (e) {
                console.error("Failed loading texture", textureId, e);
            }
            this.loadedTextureIds.add(textureId);
        }

        this.textureArray = createTextureArray(
            this.app,
            new Uint8Array(pixels.buffer),
            TEXTURE_SIZE,
            TEXTURE_SIZE,
            textureCount + 1,
            {},
        );

        this.updateTextureFiltering();

        console.timeEnd("load textures");
    }

    updateTextureFiltering(): void {
        if (!this.textureArray) {
            throw new Error("Texture array is not initialized");
        }

        this.textureArray.bind(0);

        if (this.textureFilterMode === TextureFilterMode.DISABLED) {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.NEAREST,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.NEAREST,
            );
        } else if (this.textureFilterMode === TextureFilterMode.BILINEAR) {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_NEAREST,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.LINEAR,
            );
        } else {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_LINEAR,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.LINEAR,
            );
        }

        const maxAnisotropy = Math.min(
            getMaxAnisotropy(this.textureFilterMode),
            PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY,
        );

        this.gl.texParameteri(
            PicoGL.TEXTURE_2D_ARRAY,
            PicoGL.TEXTURE_MAX_ANISOTROPY_EXT,
            maxAnisotropy,
        );
    }

    updateTextureArray(textures: Map<number, Int32Array>): void {
        if (!this.textureArray) {
            throw new Error("Texture array is not initialized");
        }
        let updatedCount = 0;
        for (const [id, pixels] of textures) {
            if (this.loadedTextureIds.has(id)) {
                continue;
            }
            const index = this.textureIds.indexOf(id) + 1;

            this.textureArray.bind(0);
            this.gl.texSubImage3D(
                PicoGL.TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                index,
                TEXTURE_SIZE,
                TEXTURE_SIZE,
                1,
                PicoGL.RGBA,
                PicoGL.UNSIGNED_BYTE,
                new Uint8Array(pixels.buffer),
            );
            this.loadedTextureIds.add(id);
            updatedCount++;
        }
        if (updatedCount > 0) {
            this.gl.generateMipmap(PicoGL.TEXTURE_2D_ARRAY);
        }
    }

    initMaterialsTexture(): void {
        if (this.textureMaterials) {
            this.textureMaterials.delete();
            this.textureMaterials = undefined;
        }

        const textureCount = this.textureIds.length + 1;

        const data = new Int8Array(textureCount * 4);
        for (let i = 0; i < this.textureIds.length; i++) {
            const id = this.textureIds[i];
            try {
                const material = this.mapViewer.textureLoader.getMaterial(id);

                const index = (i + 1) * 4;
                data[index] = material.animU;
                data[index + 1] = material.animV;
                data[index + 2] = material.alphaCutOff * 255;
            } catch (e) {
                console.error("Failed loading texture", id, e);
            }
        }

        this.textureMaterials = this.app.createTexture2D(data, textureCount, 1, {
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            internalFormat: PicoGL.RGBA8I,
        });
    }

    getControls(): Schema {
        const schema: Schema = {
            "Max Level": {
                value: this.maxLevel,
                min: 0,
                max: 3,
                step: 1,
                onChange: (v: number) => {
                    this.setMaxLevel(v);
                },
            },
            Sky: {
                r: this.skyColor[0] * 255,
                g: this.skyColor[1] * 255,
                b: this.skyColor[2] * 255,
                onChange: (v: ColorRgb) => {
                    this.setSkyColor(v.r, v.g, v.b);
                },
            },
            "Fog Depth": {
                value: this.fogDepth,
                min: 0,
                max: 256,
                step: 8,
                onChange: (v: number) => {
                    this.fogDepth = v;
                },
            },
            Brightness: {
                value: 1,
                min: 0,
                max: 4,
                step: 1,
                onChange: (v: number) => {
                    this.brightness = 1.0 - v * 0.1;
                },
            },
            "Color Banding": {
                value: 50,
                min: 0,
                max: 100,
                step: 1,
                onChange: (v: number) => {
                    this.colorBanding = 255 - v * 2;
                },
            },
            "Texture Filtering": {
                value: this.textureFilterMode,
                options: {
                    Disabled: TextureFilterMode.DISABLED,
                    Bilinear: TextureFilterMode.BILINEAR,
                    Trilinear: TextureFilterMode.TRILINEAR,
                    "Anisotropic 2x": TextureFilterMode.ANISOTROPIC_2X,
                    "Anisotropic 4x": TextureFilterMode.ANISOTROPIC_4X,
                    "Anisotropic 8x": TextureFilterMode.ANISOTROPIC_8X,
                    "Anisotropic 16x": TextureFilterMode.ANISOTROPIC_16X,
                },
                onChange: (v: TextureFilterMode) => {
                    if (v === this.textureFilterMode) {
                        return;
                    }
                    this.textureFilterMode = v;
                    this.updateTextureFiltering();
                },
            },
            "Smooth Terrain": {
                value: this.smoothTerrain,
                onChange: (v: boolean) => {
                    this.setSmoothTerrain(v);
                },
            },
            "Cull Back-faces": {
                value: this.cullBackFace,
                onChange: (v: boolean) => {
                    this.cullBackFace = v;
                },
            },
            "Anti-Aliasing": folder(
                {
                    MSAA: {
                        value: this.msaaEnabled,
                        onChange: (v: boolean) => {
                            this.setMsaa(v);
                        },
                    },
                    FXAA: {
                        value: this.fxaaEnabled,
                        onChange: (v: boolean) => {
                            this.setFxaa(v);
                        },
                    },
                },
                { collapsed: true },
            ),
            Entity: folder(
                {
                    Items: {
                        value: this.loadObjs,
                        onChange: (v: boolean) => {
                            this.setLoadObjs(v);
                        },
                    },
                    Npcs: {
                        value: this.loadNpcs,
                        onChange: (v: boolean) => {
                            this.setLoadNpcs(v);
                        },
                    },
                },
                { collapsed: true },
            ),
        };
        return schema;
    }

    override getToolControls(): Schema {
        const gameControls: Schema = {
            Game: folder({
                "God mode": {
                    value: this.mapViewer.world.godMode,
                    onChange: (v: boolean) => {
                        this.mapViewer.world.setGodMode(v);
                    },
                },
            }),
        };
        const preview = this.mapViewer.animPreview;
        if (!preview) {
            return gameControls;
        }
        return {
            ...gameControls,
            Animation:
                preview.kind === "NPC_SEQS"
                    ? this.buildAnimationControls(preview)
                    : this.buildGfxPreviewControls(preview),
        };
    }

    private currentPreviewSeqId(preview: Extract<AnimPreviewParams, { kind: "NPC_SEQS" }>): number {
        const enemy: Enemy | undefined = this.mapViewer.world.enemies[0];
        return enemy?.previewSeqId ?? preview.seqRange.from;
    }

    private buildAnimationControls(
        preview: Extract<AnimPreviewParams, { kind: "NPC_SEQS" }>,
    ): FolderInput<unknown> {
        const enemy: Enemy | undefined = this.mapViewer.world.enemies[0];
        const playback = enemy?.previewPlayback ?? AnimationPlayback.LOOP;
        const playbackName = playback === AnimationPlayback.LOOP ? "Loop" : "Once";
        return folder(
            {
                "Seq Id": monitor(
                    () =>
                        `${this.currentPreviewSeqId(preview)} (${preview.seqRange.from}-${
                            preview.seqRange.to
                        })`,
                    PREVIEW_LABEL_MONITOR,
                ),
                Prev: button(() => this.stepPreviewSeq(-1)),
                Next: button(() => this.stepPreviewSeq(1)),
                [`Playback: ${playbackName}`]: button(() => this.togglePreviewPlayback()),
                Restart: button(() => this.restartPreviewAnimation()),
                Info: monitor(
                    () => this.previewSeqInfo(this.currentPreviewSeqId(preview)),
                    PREVIEW_LABEL_MONITOR,
                ),
            },
            { collapsed: false },
        );
    }

    private togglePreviewPlayback(): void {
        const enemy: Enemy | undefined = this.mapViewer.world.enemies[0];
        if (!enemy) {
            return;
        }
        enemy.previewPlayback =
            enemy.previewPlayback === AnimationPlayback.LOOP
                ? AnimationPlayback.ONCE
                : AnimationPlayback.LOOP;
        this.restartPreviewAnimation();
        this.notifyControlsChanged?.();
    }

    private stepPreviewSeq(direction: -1 | 1): void {
        const preview = this.mapViewer.animPreview;
        const enemy: Enemy | undefined = this.mapViewer.world.enemies[0];
        if (!preview || preview.kind !== "NPC_SEQS" || !enemy || enemy.previewSeqId === undefined) {
            return;
        }
        enemy.previewSeqId = stepSeqId(enemy.previewSeqId, preview.seqRange, direction);
        this.restartPreviewAnimation();
        this.notifyControlsChanged?.();
    }

    private restartPreviewAnimation(): void {
        const enemy: Enemy | undefined = this.mapViewer.world.enemies[0];
        if (!enemy || enemy.previewSeqId === undefined) {
            return;
        }
        enemy.animation.restart(enemy.previewSeqId);
    }

    private previewSeqInfo(seqId: number): string {
        const seqTypeLoader = this.mapViewer.seqTypeLoader;
        const seqFrameLoader = this.mapViewer.seqFrameLoader;
        const frameCount = seqTypeLoader.load(seqId).frameIds?.length ?? 0;
        const durationMs = Math.round(
            sequenceDurationSeconds(seqId, seqTypeLoader, seqFrameLoader) * 1000,
        );
        return `${frameCount} frames, ${durationMs} ms`;
    }

    private buildGfxPreviewControls(
        preview: Extract<AnimPreviewParams, { kind: "SPOT_ANIMS" }>,
    ): FolderInput<unknown> {
        const playbackName = this.previewGfxPlayback === AnimationPlayback.LOOP ? "Loop" : "Once";
        return folder(
            {
                // A command box, not the state: leva keeps an input's own value across panel
                // rebuilds (so it would not follow Prev/Next) and re-fires onChange with that stale
                // value on rebuild, hence the fromPanel gate and the separate Current read-out.
                "Go to": {
                    value: preview.range.from,
                    step: 1,
                    onChange: (
                        value: number,
                        _path: string,
                        context: { initial: boolean; fromPanel: boolean },
                    ) => {
                        if (context.fromPanel && !context.initial) {
                            this.jumpToPreviewGfx(value);
                        }
                    },
                },
                Current: monitor(
                    () =>
                        `${this.previewGfxId ?? preview.range.from} (loaded ${preview.range.from}-${
                            preview.range.to
                        })`,
                    PREVIEW_LABEL_MONITOR,
                ),
                Prev: button(() => this.stepPreviewGfx(-1)),
                Next: button(() => this.stepPreviewGfx(1)),
                [`Playback: ${playbackName}`]: button(() => this.togglePreviewGfxPlayback()),
                Restart: button(() => this.restartPreviewGfxAnimation()),
                Info: monitor(
                    () => this.previewGfxInfo(this.previewGfxId ?? preview.range.from),
                    PREVIEW_LABEL_MONITOR,
                ),
            },
            { collapsed: false },
        );
    }

    private togglePreviewGfxPlayback(): void {
        this.previewGfxPlayback =
            this.previewGfxPlayback === AnimationPlayback.LOOP
                ? AnimationPlayback.ONCE
                : AnimationPlayback.LOOP;
        this.restartPreviewGfxAnimation();
        this.notifyControlsChanged?.();
    }

    // Typing an id inside the baked range just switches to it; outside it, the range is re-centred
    // on the id and the actor buffer re-baked, since the bake only ever holds the url's range.
    private jumpToPreviewGfx(value: number): void {
        const preview = this.mapViewer.animPreview;
        if (!preview || preview.kind !== "SPOT_ANIMS" || !Number.isFinite(value)) {
            return;
        }
        const gfxId = Math.max(0, Math.round(value));
        if (gfxId === this.previewGfxId) {
            return;
        }
        if (gfxId >= preview.range.from && gfxId <= preview.range.to) {
            this.previewGfxId = gfxId;
            this.restartPreviewGfxAnimation();
            this.notifyControlsChanged?.();
            return;
        }
        this.requestedPreviewGfxId = gfxId;
        this.mapViewer.setSpotAnimPreviewRange({
            from: Math.max(0, gfxId - PREVIEW_GFX_REBAKE_WINDOW),
            to: gfxId + PREVIEW_GFX_REBAKE_WINDOW,
        });
        this.queueLoadActors();
    }

    private stepPreviewGfx(direction: -1 | 1): void {
        const preview = this.mapViewer.animPreview;
        if (!preview || preview.kind !== "SPOT_ANIMS" || this.previewGfxId === undefined) {
            return;
        }
        this.previewGfxId = stepSeqId(this.previewGfxId, preview.range, direction);
        this.restartPreviewGfxAnimation();
        this.notifyControlsChanged?.();
    }

    private restartPreviewGfxAnimation(): void {
        this.previewGfxAnimation.restart(this.currentPreviewGfxBake()?.seqId ?? -1);
    }

    private currentPreviewGfxBake(): PreviewGfxBake | undefined {
        if (this.previewGfxId === undefined) {
            return undefined;
        }
        return this.actorBuffer?.actorData.previewGfx?.bakesByGfxId.get(this.previewGfxId);
    }

    // Computed straight from the spot anim/seq type loaders rather than from the (possibly not yet
    // loaded) actor bake, so the Info line is accurate the instant the gfx id is selected.
    private previewGfxInfo(gfxId: number): string {
        const spotAnimTypeLoader = this.mapViewer.loaderFactory.getSpotAnimTypeLoader();
        if (!spotAnimTypeLoader) {
            return "spot anims unavailable in this cache";
        }
        const spotAnim = spotAnimTypeLoader.load(gfxId);
        if (typeof spotAnim.modelId !== "number") {
            return "no model";
        }
        if (spotAnim.sequenceId === -1) {
            return `model ${spotAnim.modelId}, no seq (static), 1 frame, 0 ms`;
        }
        const seqTypeLoader = this.mapViewer.seqTypeLoader;
        const seqFrameLoader = this.mapViewer.seqFrameLoader;
        const frameCount = seqTypeLoader.load(spotAnim.sequenceId).frameIds?.length ?? 0;
        const durationMs = Math.round(
            sequenceDurationSeconds(spotAnim.sequenceId, seqTypeLoader, seqFrameLoader) * 1000,
        );
        return `model ${spotAnim.modelId}, seq ${spotAnim.sequenceId}, ${frameCount} frames, ${durationMs} ms`;
    }

    // Ticks the gfx preview's own animation state each frame (see advance()'s call site): unlike
    // the npc seq preview, there's no Enemy/GameWorld tick to ride along with.
    private advancePreviewGfx(deltaTimeSeconds: number): void {
        const preview = this.mapViewer.animPreview;
        if (!preview || preview.kind !== "SPOT_ANIMS") {
            return;
        }
        this.previewGfxAnimation.advance(
            deltaTimeSeconds,
            this.mapViewer.seqTypeLoader,
            this.mapViewer.seqFrameLoader,
            this.previewGfxPlayback,
        );
    }

    override async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const mapData = await this.mapViewer.workerPool.queueLoad<
            SdMapLoaderInput,
            SdMapData | undefined,
            SdMapDataLoader
        >(this.dataLoader, {
            mapX,
            mapY,
            maxLevel: this.maxLevel,
            loadObjs: this.loadObjs,
            loadNpcs: this.shouldLoadNpcs(),
            smoothTerrain: this.smoothTerrain,
            minimizeDrawCalls: !this.hasMultiDraw,
            loadedTextureIds: this.loadedTextureIds,
        });

        if (mapData) {
            if (this.isValidMapData(mapData)) {
                this.mapsToLoad.push(mapData);
            }
        } else {
            this.mapManager.addInvalidMap(mapX, mapY);
        }
    }

    loadMap(
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        time: number,
    ): void {
        const { mapX, mapY } = mapData;

        this.mapViewer.setMapImageUrl(
            mapX,
            mapY,
            URL.createObjectURL(mapData.minimapBlob),
            true,
            false,
        );

        const frameCount = this.stats.frameCount;
        const mapSquare = WebGLMapSquare.load(
            this.mapViewer.seqTypeLoader,
            this.mapViewer.npcTypeLoader,
            this.mapViewer.basTypeLoader,
            this.app,
            mainProgram,
            mainAlphaProgram,
            npcProgram,
            textureArray,
            textureMaterials,
            sceneUniformBuffer,
            mapData,
            time,
            frameCount,
        );
        mapSquare.setHideAbovePlane(this.hideAbovePlane);
        if (mapSquare.updateRoofMask(this.lastHiddenTiles)) {
            this.roofMaskedSquares.add(mapSquare);
        }
        this.mapManager.addMap(mapX, mapY, mapSquare);

        this.updateTextureArray(mapData.loadedTextures);
    }

    private shouldLoadNpcs(): boolean {
        return this.loadNpcs && this.encounter.ambientNpcs;
    }

    isValidMapData(mapData: SdMapData): boolean {
        return (
            mapData.cacheName === this.mapViewer.loadedCache.info.name &&
            mapData.maxLevel === this.maxLevel &&
            mapData.loadObjs === this.loadObjs &&
            mapData.loadNpcs === this.shouldLoadNpcs() &&
            mapData.smoothTerrain === this.smoothTerrain
        );
    }

    async queueLoadActors(): Promise<void> {
        if (this.loadingActors) {
            return;
        }
        this.loadingActors = true;
        try {
            const data = await this.mapViewer.workerPool.queueLoad<
                ActorLoaderInput,
                ActorBufferData,
                ActorRenderDataLoader
            >(this.actorLoader, {
                encounterId: this.encounter.id,
                loadedTextureIds: this.loadedTextureIds,
                preview: this.mapViewer.animPreview,
            });
            if (this.isValidActorBufferData(data)) {
                this.actorBufferToLoad = data;
            }
        } catch (e) {
            console.error("Failed loading actor render data", e);
        } finally {
            this.loadingActors = false;
        }
    }

    // Only allocates the actor buffer and starts its chunked upload (see uploadPendingActorData,
    // driven from render()); the world/encounter reset happens immediately so a stale encounter
    // can't spawn while the new one is still uploading.
    loadActors(data: ActorBufferData, time: number): void {
        console.log(`[startup] actor bake received at ${performance.now().toFixed(0)}ms`);
        this.actorBuffer?.delete();

        const capacity =
            1 + this.encounter.enemySpawns.length + MAX_PROJECTILES + MAX_VISUAL_EFFECTS;

        this.actorBuffer = WebGLActorBuffer.create(
            this.app,
            this.actorProgram!,
            this.textureArray!,
            this.textureMaterials!,
            this.sceneUniformBuffer!,
            data,
            capacity,
            time,
        );
        this.pendingActorTextures = data.loadedTextures;

        const world = this.mapViewer.world;
        world.player = undefined;
        world.enemies = [];
        world.projectiles = [];
        world.visualEffects = [];
        this.encounterSpawned = false;
        this.encounterCleared = false;
        this.bossPhaseLabel = undefined;
        this.hasPinnedCameraSinceSpawn = false;
        this.previewGfxId = undefined;
    }

    // Uploads one chunk of the pending actor buffer's vertex/index data (bufferSubData, a few MB
    // at a time), then the bake's textures once the buffer itself is fully uploaded. Called once
    // per frame from render() so a multi-megabyte actor bake never blocks the main thread in one go.
    private uploadPendingActorData(): void {
        if (!this.actorBuffer) {
            return;
        }
        if (!this.actorBuffer.isFullyUploaded) {
            this.actorBuffer.uploadNextChunk(WebGLActorBuffer.UPLOAD_CHUNK_BYTES);
            return;
        }
        if (this.pendingActorTextures) {
            this.updateTextureArray(this.pendingActorTextures);
            this.pendingActorTextures = undefined;
        }
    }

    isValidActorBufferData(data: ActorBufferData): boolean {
        return (
            data.cacheName === this.mapViewer.loadedCache.info.name &&
            data.encounterId === this.encounter.id
        );
    }

    override get isEncounterMapLoaded(): boolean {
        return this.encounter.mapSquares.every(
            ({ mapX, mapY }) => this.mapManager.getMapSquare(mapX, mapY) !== undefined,
        );
    }

    override residencyPolicy(): PlayerCentredResidency {
        const focus = this.mapViewer.world.player ?? this.encounter.playerSpawn;
        return {
            kind: ResidencyPolicyKind.PLAYER_CENTRED,
            encounterSquares: this.encounter.mapSquares,
            focusTile: { tileX: focus.x >> 7, tileY: focus.y >> 7 },
        };
    }

    // True once the encounter has spawned and the camera has settled onto its real third-person
    // framing: the earliest point at which a frame is safe to show the user (see MapViewerContainer,
    // which keeps the loading screen up until this flips true).
    override get isReadyToReveal(): boolean {
        return this.encounterSpawned && this.hasPinnedCameraSinceSpawn;
    }

    trySpawnEncounter(): void {
        if (
            this.encounterSpawned ||
            !this.actorBuffer ||
            !this.actorBuffer.isFullyUploaded ||
            this.pendingActorTextures
        ) {
            return;
        }

        const world = this.mapViewer.world;
        const { playerSpawn } = this.encounter;
        if (!this.isEncounterMapLoaded) {
            return;
        }

        world.startEncounter(
            this.encounter,
            playerSpawn.x,
            playerSpawn.y,
            playerSpawn.level,
            this.actorBuffer.actorData.player.stanceSeqIds,
        );
        this.spawnPreviewEnemyIfNeeded();
        this.initPreviewGfxIfNeeded();
        this.encounterSpawned = true;
        console.log(`[startup] encounter spawned at ${performance.now().toFixed(0)}ms`);
    }

    // The animation viewer's one preview enemy: spawned directly (not via the wave/static roster)
    // at enemySpawns[0], with previewSeqId pinned to the start of the requested range.
    private spawnPreviewEnemyIfNeeded(): void {
        const preview = this.mapViewer.animPreview;
        if (
            !preview ||
            preview.kind !== "NPC_SEQS" ||
            this.encounter.spawnMode !== EncounterSpawnMode.PREVIEW
        ) {
            return;
        }
        const npcType = this.mapViewer.npcTypeLoader.load(preview.npcTypeId);
        const enemyType = buildPreviewEnemyType({
            npcTypeId: preview.npcTypeId,
            idleSeqId: npcType.idleSeqId,
            walkSeqId: npcType.walkSeqId,
            size: npcType.size,
        });
        const spawnPoint = this.encounter.enemySpawns[0];
        const enemyId = this.mapViewer.world.spawnEnemy(
            spawnPoint.x,
            spawnPoint.y,
            spawnPoint.level,
            enemyType,
        );
        const enemy = this.mapViewer.world.findEnemy(enemyId);
        if (enemy) {
            enemy.previewSeqId = preview.seqRange.from;
        }
    }

    // The gfx preview's counterpart to spawnPreviewEnemyIfNeeded: no enemy to spawn, just pins the
    // shown spot anim id to the start of the requested range.
    private initPreviewGfxIfNeeded(): void {
        const preview = this.mapViewer.animPreview;
        if (
            !preview ||
            preview.kind !== "SPOT_ANIMS" ||
            this.encounter.spawnMode !== EncounterSpawnMode.PREVIEW
        ) {
            return;
        }
        const requested = this.requestedPreviewGfxId;
        const requestedLoaded =
            requested !== undefined &&
            requested >= preview.range.from &&
            requested <= preview.range.to;
        if (requested !== undefined && !requestedLoaded) {
            this.queueLoadActors();
        }
        this.previewGfxId = requestedLoaded ? requested : preview.range.from;
        if (requestedLoaded) {
            this.requestedPreviewGfxId = undefined;
        }
        this.restartPreviewGfxAnimation();
        this.notifyControlsChanged?.();
    }

    private resolveEnemyNpcType(enemy: Enemy): NpcType {
        return this.mapViewer.npcTypeLoader.load(enemy.type.npcTypeId);
    }

    clearMaps(): void {
        this.mapManager.cleanUp();
        this.mapsToLoad.clear();
    }

    setMaxLevel(maxLevel: number): void {
        const updated = this.maxLevel !== maxLevel;
        this.maxLevel = maxLevel;
        if (updated) {
            this.clearMaps();
        }
    }

    setSkyColor(r: number, g: number, b: number) {
        this.skyColor[0] = r / 255;
        this.skyColor[1] = g / 255;
        this.skyColor[2] = b / 255;
    }

    setSmoothTerrain(enabled: boolean): void {
        const updated = this.smoothTerrain !== enabled;
        this.smoothTerrain = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    setMsaa(enabled: boolean): void {
        const updated = this.msaaEnabled !== enabled;
        this.msaaEnabled = enabled;
        if (updated) {
            this.needsFramebufferUpdate = true;
        }
    }

    setFxaa(enabled: boolean): void {
        this.fxaaEnabled = enabled;
    }

    setLoadObjs(enabled: boolean): void {
        const updated = this.loadObjs !== enabled;
        this.loadObjs = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    setLoadNpcs(enabled: boolean): void {
        const updated = this.loadNpcs !== enabled;
        this.loadNpcs = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    override onResize(width: number, height: number): void {
        this.app.resize(width, height);
    }

    override handleKeyInput(deltaTime: number): void {
        if (!this.mapViewer.world.player) {
            super.handleKeyInput(deltaTime);
        }
    }

    override handleMouseInput(): void {
        if (!this.mapViewer.world.player) {
            super.handleMouseInput();
        }
    }

    override render(time: number, deltaTime: number, resized: boolean): void {
        const showDebugTimer = this.mapViewer.inputManager.isKeyDown("KeyY");

        if (showDebugTimer) {
            this.timer.start();
        }

        const frameCount = this.stats.frameCount;

        const timeSec = time / 1000;

        const tick = Math.floor(timeSec / 0.6);
        const ticksElapsed = Math.min(tick - this.lastTick, 1);
        if (ticksElapsed > 0) {
            this.lastTick = tick;
        }

        const clientTick = Math.floor(timeSec / 0.02);
        const clientTicksElapsed = Math.min(clientTick - this.lastClientTick, 50);
        if (clientTicksElapsed > 0) {
            this.lastClientTick = clientTick;
        }

        if (this.needsFramebufferUpdate) {
            this.initFramebuffer();
        }

        if (
            !this.mainProgram ||
            !this.mainAlphaProgram ||
            !this.npcProgram ||
            !this.actorProgram ||
            !this.sceneUniformBuffer ||
            !this.framebuffer ||
            !this.textureFramebuffer ||
            !this.frameDrawCall ||
            !this.textureArray ||
            !this.textureMaterials
        ) {
            return;
        }

        if (resized) {
            this.framebuffer.resize();
            this.textureFramebuffer.resize();

            this.resolutionUni[0] = this.app.width;
            this.resolutionUni[1] = this.app.height;
        }

        const camera = this.mapViewer.camera;

        this.handleInput(deltaTime);
        this.mapViewer.world.advance(deltaTime / 1000, {
            movement: this.buildMovementInput(),
            abilities: this.buildAbilityInput(),
            styleSwitch: this.buildKeyStyleSwitchInput() ?? this.buildStyleSwitchInput(),
            chooseUpgrade: this.buildUpgradeChoiceInput(),
            pickupTarget: this.buildPickupInput(),
        });
        this.advancePreviewGfx(deltaTime / 1000);
        this.updateRoofHiding();
        this.pinCameraToPlayer();

        camera.update(this.app.width, this.app.height);

        const renderDistance = this.mapViewer.renderDistance;

        const mapManagerStart = performance.now();
        this.mapManager.update(camera, frameCount, this.residencyPolicy());
        const mapManagerTime = performance.now() - mapManagerStart;

        this.trySpawnEncounter();

        this.cameraPosUni[0] = camera.getPosX();
        this.cameraPosUni[1] = camera.getPosZ();

        this.sceneUniformBuffer
            .set(0, camera.viewProjMatrix as Float32Array)
            .set(1, camera.viewMatrix as Float32Array)
            .set(2, camera.projectionMatrix as Float32Array)
            .set(3, this.skyColor as Float32Array)
            .set(4, this.cameraPosUni as Float32Array)
            .set(5, renderDistance as any)
            .set(6, this.fogDepth as any)
            .set(7, timeSec as any)
            .set(8, this.brightness as any)
            .set(9, this.colorBanding as any)
            .set(10, this.mapViewer.isNewTextureAnim as any)
            .update();

        this.highlightedEnemy = this.getHoveredEnemy();
        this.hudFrame = this.buildHudFrame();

        if (this.cullBackFace) {
            this.app.enable(PicoGL.CULL_FACE);
        } else {
            this.app.disable(PicoGL.CULL_FACE);
        }

        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.depthMask(true);

        this.app.drawFramebuffer(this.framebuffer);

        this.app.clearColor(0.0, 0.0, 0.0, 1.0);
        this.app.clear();
        this.gl.clearBufferfv(PicoGL.COLOR, 0, this.skyColor);

        const tickStart = performance.now();
        this.tickPass(timeSec, ticksElapsed, clientTicksElapsed);
        const tickTime = performance.now() - tickStart;

        const { index: npcDataTextureIndex, texture: npcDataTexture } = this.updateNpcDataTexture();

        this.buildActorInstanceData();
        const actorDataTexture = this.updateActorDataTexture().texture;

        this.app.disable(PicoGL.BLEND);
        const opaquePassStart = performance.now();
        this.renderOpaquePass();
        const opaquePassTime = performance.now() - opaquePassStart;
        const opaqueNpcPassStart = performance.now();
        this.renderOpaqueNpcPass(npcDataTextureIndex, npcDataTexture);
        this.renderOpaqueActorPass(actorDataTexture);
        const opaqueNpcPassTime = performance.now() - opaqueNpcPassStart;

        this.app.enable(PicoGL.BLEND);
        const transparentPassStart = performance.now();
        this.renderTransparentPass();
        const transparentPassTime = performance.now() - transparentPassStart;
        const transparentNpcPassStart = performance.now();
        this.renderTransparentNpcPass(npcDataTextureIndex, npcDataTexture);
        this.renderTransparentActorPass(actorDataTexture);
        const transparentNpcPassTime = performance.now() - transparentNpcPassStart;

        // Can't sample from renderbuffer so blit to a texture for sampling.
        this.app.readFramebuffer(this.framebuffer);

        this.app.drawFramebuffer(this.textureFramebuffer);
        this.gl.readBuffer(PicoGL.COLOR_ATTACHMENT0);
        this.app.blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);

        this.app.disable(PicoGL.DEPTH_TEST);
        this.app.depthMask(false);

        this.app.disable(PicoGL.BLEND);

        this.app.clearMask(PicoGL.COLOR_BUFFER_BIT | PicoGL.DEPTH_BUFFER_BIT);
        this.app.clearColor(0.0, 0.0, 0.0, 1.0);
        this.app.defaultDrawFramebuffer().clear();

        if (this.frameFxaaDrawCall && this.fxaaEnabled) {
            this.frameFxaaDrawCall.uniform("u_resolution", this.resolutionUni);
            this.frameFxaaDrawCall.texture("u_frame", this.textureFramebuffer.colorAttachments[0]);
            this.frameFxaaDrawCall.draw();
        } else {
            this.frameDrawCall.texture("u_frame", this.textureFramebuffer.colorAttachments[0]);
            this.frameDrawCall.draw();
        }

        // Load new map squares
        const mapData = this.mapsToLoad.shift();
        if (mapData && this.isValidMapData(mapData)) {
            this.loadMap(
                this.mainProgram,
                this.mainAlphaProgram,
                this.npcProgram,
                this.textureArray,
                this.textureMaterials,
                this.sceneUniformBuffer,
                mapData,
                timeSec,
            );
        }

        if (this.actorBufferToLoad) {
            const actorBufferData = this.actorBufferToLoad;
            this.actorBufferToLoad = undefined;
            if (this.isValidActorBufferData(actorBufferData)) {
                this.loadActors(actorBufferData, timeSec);
            }
        }
        this.uploadPendingActorData();

        if (showDebugTimer) {
            this.timer.end();
        }

        if (this.mapViewer.inputManager.isKeyDown("KeyH")) {
            this.mapViewer.debugText = `MapManager: ${mapManagerTime.toFixed(2)}ms`;
        }
        if (this.mapViewer.inputManager.isKeyDown("KeyK")) {
            this.mapViewer.debugText = `Tick: ${tickTime.toFixed(2)}ms`;
        }
        if (this.mapViewer.inputManager.isKeyDown("KeyL")) {
            this.mapViewer.debugText = `Opaque Pass: ${opaquePassTime.toFixed(2)}ms`;
        }
        if (this.mapViewer.inputManager.isKeyDown("KeyB")) {
            this.mapViewer.debugText = `Opaque Npc Pass: ${opaqueNpcPassTime.toFixed(2)}ms`;
        }
        if (this.mapViewer.inputManager.isKeyDown("KeyN")) {
            this.mapViewer.debugText = `Transparent Pass: ${transparentPassTime.toFixed(2)}ms`;
        }
        if (this.mapViewer.inputManager.isKeyDown("KeyM")) {
            this.mapViewer.debugText = `Transparent Npc Pass: ${transparentNpcPassTime.toFixed(
                2,
            )}ms`;
        }

        if (showDebugTimer && this.timer.ready()) {
            this.mapViewer.debugText = `Frame Time GL: ${this.timer.gpuTime.toFixed(
                2,
            )}ms\n JS: ${this.timer.cpuTime.toFixed(2)}ms`;
        }
    }

    private isPointerOverHud(): boolean {
        const frame = this.hudFrame;
        const inputManager = this.mapViewer.inputManager;
        if (!frame || inputManager.mouseX === -1 || inputManager.mouseY === -1) {
            return false;
        }
        const layout = computeHudLayout(
            frame.screenSize.width,
            frame.screenSize.height,
            frame.abilities.length,
            frame.upgradeOffer?.cards.length ?? 0,
        );
        return hitTestHud(layout, inputManager.mouseX, inputManager.mouseY) !== undefined;
    }

    private buildStyleSwitchInput(): WeaponStyle | undefined {
        const frame = this.hudFrame;
        const inputManager = this.mapViewer.inputManager;
        if (!frame || !inputManager.isPressEvent()) {
            return undefined;
        }
        const layout = computeHudLayout(
            frame.screenSize.width,
            frame.screenSize.height,
            frame.abilities.length,
            frame.upgradeOffer?.cards.length ?? 0,
        );
        const region = hitTestHud(layout, inputManager.pressEventX, inputManager.pressEventY);
        return region?.kind === HudRegionKind.STYLE ? region.style : undefined;
    }

    private buildUpgradeChoiceInput(): number | undefined {
        const frame = this.hudFrame;
        const cardCount = frame?.upgradeOffer?.cards.length ?? 0;
        if (!frame || cardCount === 0) {
            return undefined;
        }
        const inputManager = this.mapViewer.inputManager;
        for (let i = 0; i < cardCount; i++) {
            if (inputManager.isKeyDownEvent(`Digit${i + 1}`)) {
                return i;
            }
        }
        if (!inputManager.isPressEvent()) {
            return undefined;
        }
        const layout = computeHudLayout(
            frame.screenSize.width,
            frame.screenSize.height,
            frame.abilities.length,
            cardCount,
        );
        const region = hitTestHud(layout, inputManager.pressEventX, inputManager.pressEventY);
        return region?.kind === HudRegionKind.UPGRADE_CARD ? region.index : undefined;
    }

    private buildMovementInput(): PlayerInput {
        const player = this.mapViewer.world.player;
        const inputManager = this.mapViewer.inputManager;
        if (inputManager.isKeyDownEvent("ShiftLeft") || inputManager.isKeyDownEvent("ShiftRight")) {
            this.runEnabled = !this.runEnabled;
        }
        const running = this.runEnabled;
        const stationary: PlayerInput = { x: 0, y: 0, running };

        if (
            !player ||
            this.isPointerOverHud() ||
            !inputManager.isDragging() ||
            this.getHoveredEnemy()
        ) {
            return stationary;
        }

        const groundPoint = this.screenToGround(player, inputManager.mouseX, inputManager.mouseY);
        if (!groundPoint) {
            return stationary;
        }

        const deltaX = groundPoint.x - player.x;
        const deltaY = groundPoint.y - player.y;
        const length = Math.hypot(deltaX, deltaY);
        if (length === 0) {
            return stationary;
        }

        return { x: deltaX / length, y: deltaY / length, running };
    }

    private buildKeyStyleSwitchInput(): WeaponStyle | undefined {
        const inputManager = this.mapViewer.inputManager;
        if (inputManager.isKeyDownEvent("KeyQ")) {
            return WeaponStyle.MELEE;
        }
        if (inputManager.isKeyDownEvent("KeyW")) {
            return WeaponStyle.RANGED;
        }
        if (inputManager.isKeyDownEvent("KeyE")) {
            return WeaponStyle.MAGIC;
        }
        return undefined;
    }

    private buildAbilityInput(): AbilityInput {
        const player = this.mapViewer.world.player;
        if (!player || this.hudFrame?.upgradeOffer) {
            return [];
        }

        const inputManager = this.mapViewer.inputManager;
        const pointerOverHud = this.isPointerOverHud();
        const hoveredEnemy = pointerOverHud ? undefined : this.getHoveredEnemy();
        const isDragging = !pointerOverHud && inputManager.isDragging();

        const keySlot = (
            key: string | undefined,
            extraHeld: boolean,
            delivery: Delivery,
        ): AbilitySlotInput => {
            if (!extraHeld && (!key || !inputManager.isKeyDown(key))) {
                return { held: false };
            }
            if (hoveredEnemy && aimModeFor(delivery) === AimMode.COMBATANT_OR_POINT) {
                return {
                    held: true,
                    target: { kind: AbilityTargetKind.COMBATANT, combatant: hoveredEnemy },
                };
            }
            if (pointerOverHud) {
                return { held: true, target: undefined };
            }
            const groundPoint = this.screenToGround(
                player,
                inputManager.mouseX,
                inputManager.mouseY,
            );
            return groundPoint
                ? { held: true, target: { kind: AbilityTargetKind.POINT, ...groundPoint } }
                : { held: false };
        };

        const barLength = player.abilityBar.length;
        return player.abilityBar.map((definition, index) => {
            const key = keyForAbilitySlot(index, barLength);
            const isBasicAttackSlot = index === 0;
            const mouseHeld = isBasicAttackSlot && isDragging && hoveredEnemy !== undefined;
            return keySlot(key, mouseHeld, definition.effect.delivery);
        });
    }

    private screenToGround(
        player: Player,
        screenX: number,
        screenY: number,
    ): { x: number; y: number } | undefined {
        const rect = this.canvas.getBoundingClientRect();
        const groundHeight = this.terrain.getHeight(player.level, player.x, player.y);
        return screenToGroundPoint(
            this.mapViewer.camera.viewProjMatrix,
            screenX,
            screenY,
            rect.width,
            rect.height,
            groundHeight,
        );
    }

    private getHoveredEnemy(): Enemy | undefined {
        const inputManager = this.mapViewer.inputManager;
        if (inputManager.mouseX === -1 || inputManager.mouseY === -1) {
            return undefined;
        }
        const pickedId = pickEnemyNear(
            { x: inputManager.mouseX, y: inputManager.mouseY },
            this.buildEnemyScreenCandidates(),
            ENEMY_HOVER_PICK_RADIUS_PX,
        );
        return pickedId !== undefined ? this.mapViewer.world.findEnemy(pickedId) : undefined;
    }

    private buildEnemyScreenCandidates(): EnemyScreenCandidate[] {
        const candidates: EnemyScreenCandidate[] = [];
        for (const enemy of this.mapViewer.world.enemies) {
            if (enemy.state === EnemyState.DEAD) {
                continue;
            }
            const rect = this.projectEnemyScreenRect(enemy);
            if (rect) {
                candidates.push({ id: enemy.id, rect });
            }
        }
        return candidates;
    }

    // A rough body rect above the enemy's feet, scaled from its hit radius, used as a generous
    // click/hover target instead of the exact model silhouette.
    private projectEnemyScreenRect(enemy: Enemy): ScreenRect | undefined {
        const viewProjMatrix = this.mapViewer.camera.viewProjMatrix;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const groundHeight = this.terrain.getHeight(enemy.level, enemy.x, enemy.y);
        const bodyHeight = enemy.hitRadius * ENEMY_BODY_HEIGHT_SCALE;
        const corners = [
            [enemy.x - enemy.hitRadius, enemy.y - enemy.hitRadius],
            [enemy.x + enemy.hitRadius, enemy.y - enemy.hitRadius],
            [enemy.x - enemy.hitRadius, enemy.y + enemy.hitRadius],
            [enemy.x + enemy.hitRadius, enemy.y + enemy.hitRadius],
        ];
        const points: ScreenPoint[] = [];
        for (const [x, y] of corners) {
            const foot = worldToScreen(viewProjMatrix, x, y, groundHeight, width, height);
            const head = worldToScreen(
                viewProjMatrix,
                x,
                y,
                groundHeight + bodyHeight,
                width,
                height,
            );
            if (!foot || !head) {
                return undefined;
            }
            points.push(foot, head);
        }
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        return {
            left: Math.min(...xs),
            right: Math.max(...xs),
            top: Math.min(...ys),
            bottom: Math.max(...ys),
        };
    }

    // A click on a fresh press event either targets a ground item (label or a generous radius
    // around its projected point, reusing the enemy picker's approach) or clears any pending
    // pickup, the same way clicking an enemy or plain ground overrides a melee chase. The target
    // also clears itself once the item is gone (picked up or expired).
    private buildPickupInput(): PickupTarget | undefined {
        const inputManager = this.mapViewer.inputManager;
        if (!this.isPointerOverHud() && inputManager.isPressEvent()) {
            this.pickupTargetItemId = pickEnemyNear(
                { x: inputManager.pressEventX, y: inputManager.pressEventY },
                this.buildGroundItemScreenCandidates(),
                0,
            );
        }
        if (this.pickupTargetItemId === undefined) {
            return undefined;
        }
        if (!this.mapViewer.world.findGroundItem(this.pickupTargetItemId)) {
            this.pickupTargetItemId = undefined;
            return undefined;
        }
        return { groundItemId: this.pickupTargetItemId };
    }

    private buildGroundItemScreenCandidates(): EnemyScreenCandidate[] {
        const candidates: EnemyScreenCandidate[] = [];
        for (const item of this.mapViewer.world.groundItems) {
            const rect = this.projectGroundItemScreenRect(item);
            if (rect) {
                candidates.push({ id: item.id, rect });
            }
        }
        return candidates;
    }

    // Covers both the label (drawn above the item) and a generous radius around the item's own
    // projected point, so clicking either the floor label or near the item mesh picks it up.
    private projectGroundItemScreenRect(item: GroundItem): ScreenRect | undefined {
        const groundHeight = this.terrain.getHeight(item.level, item.x, item.y);
        const screen = worldToScreen(
            this.mapViewer.camera.viewProjMatrix,
            item.x,
            item.y,
            groundHeight,
            this.canvas.clientWidth,
            this.canvas.clientHeight,
        );
        if (!screen) {
            return undefined;
        }
        return {
            left: screen.x - GROUND_ITEM_LABEL_HALF_WIDTH_PX,
            right: screen.x + GROUND_ITEM_LABEL_HALF_WIDTH_PX,
            top: screen.y - GROUND_ITEM_LABEL_HEIGHT_PX - GROUND_ITEM_PICK_RADIUS_PX,
            bottom: screen.y + GROUND_ITEM_PICK_RADIUS_PX,
        };
    }

    private buildAbilitySlots(player: Player): AbilitySlotHudInfo[] {
        const timeSeconds = this.mapViewer.world.timeSeconds;
        const bar = player.abilityBar;
        return bar.map((definition, index) => {
            const readiness = player.getSlotReadiness(index, timeSeconds);
            let blocked = AbilitySlotBlockReason.NONE;
            if (readiness.manaBlocked) {
                blocked = AbilitySlotBlockReason.MANA;
            } else if (readiness.cooldownFraction > 0) {
                blocked = AbilitySlotBlockReason.COOLDOWN;
            }

            const isBasicAttack = index === 0;
            const isPotion = index === bar.length - 1;
            const keyLabel = isBasicAttack ? "1 / LMB" : isPotion ? "4" : `${index + 1}`;

            return {
                name: definition.name,
                keyLabel,
                cooldownFraction: readiness.cooldownFraction,
                charges:
                    readiness.maxCharges > 1
                        ? { current: readiness.charges, max: readiness.maxCharges }
                        : undefined,
                blocked,
            };
        });
    }

    private buildHudFrame(): HudFrame {
        const world = this.mapViewer.world;
        const camera = this.mapViewer.camera;

        const player = world.player;

        const splatEvents: SplatEvent[] = [];
        const pickupFlashEvents: PickupFlashEvent[] = [];
        for (const event of world.drainEvents()) {
            if (event.kind === CombatEventKind.ENCOUNTER_CLEARED) {
                this.encounterCleared = true;
                continue;
            }
            if (event.kind === CombatEventKind.BOSS_PHASE) {
                this.bossPhaseLabel = event.phaseLabel;
                continue;
            }
            if (event.kind === CombatEventKind.ITEM_DROPPED) {
                // world.groundItems already carries the dropped item; the HUD's floor label is
                // rebuilt from that persistent state below, not from this one-off event.
                continue;
            }
            if (event.kind === CombatEventKind.ITEM_PICKED_UP) {
                const itemId = itemIdForTier(event.path, event.tierIndex);
                const name = this.mapViewer.objTypeLoader.load(itemId).name;
                pickupFlashEvents.push({ text: `Equipped: ${name}` });
                continue;
            }
            const groundHeight = this.terrain.getHeight(
                event.target.level,
                event.target.x,
                event.target.y,
            );
            switch (event.kind) {
                case CombatEventKind.DAMAGE:
                    splatEvents.push({
                        kind: SplatKind.DAMAGE,
                        amount: event.amount,
                        factionHit: event.target.faction,
                        worldX: event.target.x,
                        worldY: event.target.y,
                        groundHeight,
                    });
                    break;
                case CombatEventKind.HEAL:
                    splatEvents.push({
                        kind: SplatKind.HEAL,
                        amount: event.amount,
                        worldX: event.target.x,
                        worldY: event.target.y,
                        groundHeight,
                    });
                    break;
            }
        }

        const groundItems: GroundItemHudInfo[] = [];
        for (const item of world.groundItems) {
            const groundHeight = this.terrain.getHeight(item.level, item.x, item.y);
            const screen = worldToScreen(
                camera.viewProjMatrix,
                item.x,
                item.y,
                groundHeight,
                this.canvas.clientWidth,
                this.canvas.clientHeight,
            );
            if (!screen) {
                continue;
            }
            const itemId = itemIdForTier(item.path, item.tierIndex);
            groundItems.push({
                groundItemId: item.id,
                screenX: screen.x,
                screenY: screen.y,
                name: this.mapViewer.objTypeLoader.load(itemId).name,
                pathLabel: EQUIPMENT_PATH_LABELS[item.path],
            });
        }

        const waveProgress = world.getWaveProgress();

        const targetEnemy = this.highlightedEnemy;
        const targetNpcType = targetEnemy && this.resolveEnemyNpcType(targetEnemy);

        const bossEnemy = world.enemies.find(
            (enemy) =>
                enemy.type.behaviour === EnemyBehaviour.BOSS && enemy.state !== EnemyState.DEAD,
        );
        const bossNpcType = bossEnemy && this.resolveEnemyNpcType(bossEnemy);
        const boss: BossHudInfo | undefined = bossEnemy &&
            bossNpcType && {
                name: bossNpcType.name,
                health: bossEnemy.health,
                maxHealth: bossEnemy.maxHealth,
                phaseLabel: this.bossPhaseLabel,
            };

        return {
            viewProjMatrix: camera.viewProjMatrix,
            screenSize: { width: this.canvas.clientWidth, height: this.canvas.clientHeight },
            player: player && {
                health: player.health,
                maxHealth: player.maxHealth,
                mana: player.mana,
                maxMana: player.maxMana,
            },
            target: targetEnemy &&
                targetNpcType && {
                    name: targetNpcType.name,
                    combatLevel: targetNpcType.combatLevel,
                    health: targetEnemy.health,
                    maxHealth: targetEnemy.maxHealth,
                },
            abilities: player ? this.buildAbilitySlots(player) : [],
            activeStyle: player?.style,
            godMode: world.godMode,
            splatEvents,
            groundItems,
            pickupFlashEvents,
            wave: waveProgress && {
                index: waveProgress.index,
                total: waveProgress.total,
                aliveEnemies: world.enemies.filter((enemy) => enemy.state !== EnemyState.DEAD)
                    .length,
                status: this.encounterCleared
                    ? WaveStatus.CLEARED
                    : waveProgress.awaitingUpgrade
                    ? WaveStatus.AWAITING_UPGRADE
                    : WaveStatus.ACTIVE,
                modifiersSummary: player && summarizeModifiers(player.getModifiers()),
            },
            upgradeOffer: world.pendingUpgradeOffer && {
                cards: world.pendingUpgradeOffer.map(
                    (upgrade, index): UpgradeCardHudInfo => ({
                        name: upgrade.name,
                        description: upgrade.description,
                        keyLabel: `${index + 1}`,
                    }),
                ),
            },
            previewSeqId: this.mapViewer.animPreview ? world.enemies[0]?.previewSeqId : undefined,
            boss,
        };
    }

    private pinCameraToPlayer(): void {
        const player = this.mapViewer.world.player;
        if (!player) {
            return;
        }

        const camera = this.mapViewer.camera;
        const playerX = player.x / 128;
        const playerZ = player.y / 128;
        const playerY = -this.terrain.getHeight(player.level, player.x, player.y) / 128;
        const pitch = camera.pitch * RS_TO_RADIANS;
        const yaw = (camera.yaw - 1024) * RS_TO_RADIANS;
        const distance = (playerY - camera.pos[1]) / Math.sin(pitch);
        camera.pos[0] = playerX - distance * Math.sin(yaw) * Math.cos(pitch);
        camera.pos[2] = playerZ - distance * Math.cos(yaw) * Math.cos(pitch);
        camera.updated = true;
        camera.updatedPosition = true;
        if (!this.hasPinnedCameraSinceSpawn) {
            console.log(`[startup] camera pinned at ${performance.now().toFixed(0)}ms`);
        }
        this.hasPinnedCameraSinceSpawn = true;
    }

    private getTileFlagsForRoof(level: number, tileX: number, tileY: number): number | undefined {
        const mapX = Math.floor(tileX / Scene.MAP_SQUARE_SIZE);
        const mapY = Math.floor(tileY / Scene.MAP_SQUARE_SIZE);
        const mapSquare = this.mapManager.getMapSquare(mapX, mapY);
        if (!mapSquare) {
            return undefined;
        }
        return mapSquare.getTileRenderFlag(
            level,
            tileX - mapX * Scene.MAP_SQUARE_SIZE,
            tileY - mapY * Scene.MAP_SQUARE_SIZE,
        );
    }

    private setHideAbovePlane(plane: number): void {
        if (this.hideAbovePlane === plane) {
            return;
        }
        this.hideAbovePlane = plane;
        for (const mapSquare of this.mapManager.mapSquares.values()) {
            mapSquare.setHideAbovePlane(plane);
        }
    }

    private updateRoofHiding(): void {
        const player = this.mapViewer.world.player;
        const tileX = player !== undefined ? player.x >> 7 : undefined;
        const tileY = player !== undefined ? player.y >> 7 : undefined;
        const level = player?.level;

        if (
            tileX === this.lastRoofTileX &&
            tileY === this.lastRoofTileY &&
            level === this.lastRoofLevel
        ) {
            return;
        }
        this.lastRoofTileX = tileX;
        this.lastRoofTileY = tileY;
        this.lastRoofLevel = level;

        const hiddenTiles =
            tileX !== undefined && tileY !== undefined && level !== undefined
                ? computeRoofHiddenTiles(
                      (lvl, tx, ty) => this.getTileFlagsForRoof(lvl, tx, ty),
                      level,
                      tileX,
                      tileY,
                  )
                : new Set<string>();

        this.lastHiddenTiles = hiddenTiles;
        this.setHideAbovePlane(hiddenTiles.size > 0 ? level! : Scene.MAX_LEVELS - 1);

        const touchedSquares = new Set<WebGLMapSquare>();
        for (const mapSquare of this.roofMaskedSquares) {
            if (this.mapManager.getMapSquare(mapSquare.mapX, mapSquare.mapY) === mapSquare) {
                touchedSquares.add(mapSquare);
            }
        }
        for (const key of hiddenTiles) {
            const [absTileX, absTileY] = decodeTileKey(key);
            const mapSquare = this.mapManager.getMapSquare(
                Math.floor(absTileX / Scene.MAP_SQUARE_SIZE),
                Math.floor(absTileY / Scene.MAP_SQUARE_SIZE),
            );
            if (mapSquare) {
                touchedSquares.add(mapSquare);
            }
        }

        this.roofMaskedSquares.clear();
        for (const mapSquare of touchedSquares) {
            if (mapSquare.updateRoofMask(hiddenTiles)) {
                this.roofMaskedSquares.add(mapSquare);
            }
        }
    }

    tickPass(time: number, ticksElapsed: number, clientTicksElapsed: number): void {
        const cycle = time / 0.02;

        const seqFrameLoader = this.mapViewer.seqFrameLoader;
        const seqTypeLoader = this.mapViewer.seqTypeLoader;

        const pathfinder = this.mapViewer.pathfinder;

        const focus = this.ambientTickFocus();
        const frameCount = this.stats.frameCount;

        this.npcRenderCount = 0;
        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];

            if (!isWithinTickRange(focus, map.mapX, map.mapY)) {
                map.npcDataTextureOffsets[frameCount % map.npcDataTextureOffsets.length] = -1;
                continue;
            }

            for (const loc of map.locsAnimated) {
                loc.update(seqFrameLoader, cycle);
            }

            for (let t = 0; t < ticksElapsed; t++) {
                for (const npc of map.npcs) {
                    npc.updateServerMovement(pathfinder, map.borderSize, map.collisionMaps);
                }
            }

            for (let t = 0; t < clientTicksElapsed; t++) {
                for (const npc of map.npcs) {
                    npc.updateMovement(seqTypeLoader, seqFrameLoader);
                }
            }

            this.addNpcRenderData(map);
        }
    }

    // The square whose neighbourhood gets ambient simulation: the player's, or the encounter's
    // spawn square while the player hasn't been spawned yet.
    private ambientTickFocus(): MapSquareCoord {
        const player = this.mapViewer.world.player;
        if (player) {
            return worldToMapSquare(player.x, player.y);
        }
        const { playerSpawn } = this.encounter;
        return worldToMapSquare(playerSpawn.x, playerSpawn.y);
    }

    addNpcRenderData(map: WebGLMapSquare) {
        const npcs = map.npcs;

        if (npcs.length === 0) {
            return;
        }

        const frameCount = this.stats.frameCount;

        map.npcDataTextureOffsets[frameCount % map.npcDataTextureOffsets.length] =
            this.npcRenderCount;

        const newCount = this.npcRenderCount + npcs.length;

        if (this.npcRenderData.length / 4 < newCount) {
            const newData = new Uint16Array(Math.ceil((newCount * 2) / 16) * 16 * 4);
            newData.set(this.npcRenderData);
            this.npcRenderData = newData;
        }

        for (const npc of npcs) {
            let offset = this.npcRenderCount * 4;

            const tileX = npc.x >> 7;
            const tileY = npc.y >> 7;

            let renderPlane = npc.level;
            if (renderPlane < 3 && (map.getTileRenderFlag(1, tileX, tileY) & 0x2) === 2) {
                renderPlane++;
            }

            this.npcRenderData[offset++] = npc.x;
            this.npcRenderData[offset++] = npc.y;
            this.npcRenderData[offset++] = encodeNpcInfo(
                InteractType.NPC,
                npc.rotation,
                renderPlane,
            );
            this.npcRenderData[offset++] = npc.npcType.id;

            this.npcRenderCount++;
        }
    }

    updateNpcDataTexture(): DataTextureSlot {
        if (!this.npcDataTextures) {
            throw new Error("NPC data texture ring used before init()");
        }
        return this.npcDataTextures.upload(
            this.stats.frameCount,
            this.npcRenderData,
            this.npcRenderCount,
        );
    }

    private tryGetHeight(level: number, x: number, y: number): number | undefined {
        try {
            return this.terrain.getHeight(level, x, y);
        } catch (e) {
            return undefined;
        }
    }

    buildActorInstanceData(): void {
        this.activeActorMeshes.length = 0;
        this.actorInstanceCount = 0;

        const actorBuffer = this.actorBuffer;
        if (!actorBuffer) {
            return;
        }

        const world = this.mapViewer.world;
        const actorData = actorBuffer.actorData;

        // A player is drawn as several instances: the body plus one per currently equipped visible
        // item (weapon + secondary offhand + amulet, or just the maul-smash override item) - see
        // Equipment.equippedVisualItemIds. 4 is the most any of those combinations ever produces.
        const PLAYER_MAX_INSTANCES = 4;

        const maxCount =
            (world.player !== undefined ? PLAYER_MAX_INSTANCES : 0) +
            world.enemies.length +
            world.projectiles.length +
            world.visualEffects.length +
            world.groundItems.length +
            (this.previewGfxId !== undefined ? 1 : 0);

        if (this.actorInstanceData.length / (4 * ACTOR_INSTANCE_TEXELS) < maxCount) {
            const newData = new Uint32Array(
                Math.ceil((maxCount * 2 * ACTOR_INSTANCE_TEXELS) / 16) * 16 * 4,
            );
            newData.set(this.actorInstanceData);
            this.actorInstanceData = newData;
        }

        if (actorBuffer.capacity < maxCount) {
            actorBuffer.growCapacity(Math.ceil((maxCount * 2) / 16) * 16);
        }

        const push = (actor: ActiveActor, instance: ActorPlacement): void => {
            if (this.actorInstanceCount >= actorBuffer.capacity) {
                return;
            }
            const pose = this.getActorPose(actor);
            if (!pose) {
                return;
            }
            const frame = pose.animation.frames[pose.frameIndex];
            if (!frame) {
                throw new Error(`Actor animation is missing frame ${pose.frameIndex}`);
            }
            writeActorInstance(this.actorInstanceData, this.actorInstanceCount, {
                ...instance,
                matrixOffset: frame.matrixOffset,
                alphaOffset: frame.alphaOffset,
            });
            this.actorInstanceCount++;
            this.activeActorMeshes.push(pose.animation.mesh);
        };

        const player = world.player;
        if (player) {
            const groundHeight = this.tryGetHeight(player.level, player.x, player.y);
            if (groundHeight !== undefined) {
                const instance: ActorPlacement = {
                    worldX: player.x,
                    worldY: player.y,
                    groundHeight,
                    rotation: player.rotation,
                    level: this.terrain.getRenderLevel(player.level, player.x, player.y),
                    interactType: InteractType.NONE,
                    interactId: 0,
                    pitch: 0,
                };
                push({ kind: "playerBody", player }, instance);
                for (const itemId of equippedVisualItemIds(
                    player.style,
                    player.equipment,
                    player.animation.seqId,
                )) {
                    push({ kind: "playerItem", player, itemId }, instance);
                }
            }
        }

        for (const enemy of world.enemies) {
            const animSet = actorData.enemyTypes[enemy.type.id];
            if (!animSet) {
                continue;
            }
            const groundHeight = this.tryGetHeight(enemy.level, enemy.x, enemy.y);
            if (groundHeight === undefined) {
                continue;
            }
            push(
                { kind: "enemy", enemy, animSet },
                {
                    worldX: enemy.x,
                    worldY: enemy.y,
                    groundHeight,
                    rotation: enemy.rotation,
                    level: this.terrain.getRenderLevel(enemy.level, enemy.x, enemy.y),
                    interactType: InteractType.ENEMY,
                    interactId: enemy.id,
                    pitch: 0,
                },
            );
        }

        for (const projectile of world.projectiles) {
            if (!this.terrain.isLoaded(projectile.level, projectile.x, projectile.y)) {
                continue;
            }
            push(
                { kind: "projectile", projectile },
                {
                    worldX: projectile.x,
                    worldY: projectile.y,
                    groundHeight: projectile.height,
                    rotation: projectile.rotation,
                    level: this.terrain.getRenderLevel(
                        projectile.level,
                        projectile.x,
                        projectile.y,
                    ),
                    interactType: InteractType.NONE,
                    interactId: 0,
                    pitch: projectile.pitch,
                },
            );
        }

        for (const effect of world.visualEffects) {
            const groundHeight = this.tryGetHeight(effect.level, effect.x, effect.y);
            if (groundHeight === undefined) {
                continue;
            }
            push(
                { kind: "effect", effect },
                {
                    worldX: effect.x,
                    worldY: effect.y,
                    groundHeight: groundHeight + effect.height,
                    rotation: 0,
                    level: this.terrain.getRenderLevel(effect.level, effect.x, effect.y),
                    interactType: InteractType.NONE,
                    interactId: 0,
                    pitch: 0,
                },
            );
        }

        if (this.previewGfxId !== undefined) {
            const spawnPoint = this.encounter.enemySpawns[0];
            const groundHeight = this.tryGetHeight(spawnPoint.level, spawnPoint.x, spawnPoint.y);
            if (groundHeight !== undefined) {
                push(
                    { kind: "previewGfx" },
                    {
                        worldX: spawnPoint.x,
                        worldY: spawnPoint.y,
                        groundHeight: groundHeight + PREVIEW_GFX_HOVER_HEIGHT,
                        rotation: 0,
                        level: this.terrain.getRenderLevel(
                            spawnPoint.level,
                            spawnPoint.x,
                            spawnPoint.y,
                        ),
                        interactType: InteractType.NONE,
                        interactId: 0,
                        pitch: 0,
                    },
                );
            }
        }

        for (const item of world.groundItems) {
            const groundHeight = this.tryGetHeight(item.level, item.x, item.y);
            if (groundHeight === undefined) {
                continue;
            }
            push(
                { kind: "groundItem", item },
                {
                    worldX: item.x,
                    worldY: item.y,
                    groundHeight,
                    rotation: 0,
                    level: this.terrain.getRenderLevel(item.level, item.x, item.y),
                    interactType: InteractType.NONE,
                    interactId: 0,
                    pitch: 0,
                },
            );
        }
    }

    updateActorDataTexture(): DataTextureSlot {
        if (!this.actorDataTextures) {
            throw new Error("Actor data texture ring used before init()");
        }
        return this.actorDataTextures.upload(
            this.stats.frameCount,
            this.actorInstanceData,
            this.actorInstanceCount * ACTOR_INSTANCE_TEXELS,
        );
    }

    draw(drawCall: DrawCall, drawRanges: number[][]) {
        if (this.hasMultiDraw) {
            drawCall.draw();
            return;
        }
        const call = drawCall as any;
        let bound = false;
        for (let i = 0; i < drawRanges.length; i++) {
            const range = drawRanges[i];
            if (range[1] === 0) {
                continue;
            }
            if (!bound) {
                drawCall.uniform("u_drawId", i);
                drawCall.drawRanges(range);
                drawCall.draw();
                bound = true;
                continue;
            }
            call.currentProgram.uniform("u_drawId", i);
            this.gl.drawElementsInstanced(
                call.drawPrimitive,
                range[1],
                call.currentVertexArray.indexType,
                range[0],
                range[2],
            );
        }
    }

    renderOpaquePass(): void {
        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];

            const { drawCall, drawRanges } = map.getDrawCall(MapDrawPass.OPAQUE);

            for (const loc of map.locsAnimated) {
                const frameId = loc.frame;
                const frame = loc.anim.frames[frameId | 0];

                const index = loc.getDrawRangeIndex(MapDrawPass.OPAQUE);
                if (index !== -1) {
                    drawCall.offsets[index] = frame[0];
                    (drawCall as any).numElements[index] = frame[1];

                    drawRanges[index] = frame;
                }
            }

            this.draw(drawCall, drawRanges);
        }
    }

    renderOpaqueNpcPass(npcDataTextureIndex: number, npcDataTexture: Texture): void {
        if (!this.loadNpcs) {
            return;
        }

        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];
            const npcs = map.npcs;

            if (npcs.length === 0) {
                continue;
            }

            const dataOffset = map.npcDataTextureOffsets[npcDataTextureIndex];
            if (dataOffset === -1) {
                continue;
            }

            const { drawCall, drawRanges } = map.drawCallNpc;

            drawCall.uniform("u_npcDataOffset", dataOffset);
            drawCall.texture("u_npcDataTexture", npcDataTexture);
            drawCall.uniform("u_verticalOffset", 0);
            drawCall.uniform("u_highlightId", 0);

            for (let i = 0; i < npcs.length; i++) {
                const npc = npcs[i];
                const anim = npc.getAnimationFrames();

                const frameId = npc.movementFrame;
                const frame = anim.frames[frameId];

                (drawCall as any).offsets[i] = frame[0];
                (drawCall as any).numElements[i] = frame[1];

                drawRanges[i] = frame;
            }

            this.draw(drawCall, drawRanges);
        }
    }

    private getActorPose(
        actor: ActiveActor,
    ): { readonly animation: ActorAnimation; readonly frameIndex: number } | undefined {
        if (!this.actorBuffer) {
            return undefined;
        }
        const actorData = this.actorBuffer.actorData;
        switch (actor.kind) {
            case "playerBody": {
                const { player } = actor;
                return {
                    animation: getPlayerBodyAnimation(actorData.player, player.animation.seqId),
                    frameIndex: player.animation.frame,
                };
            }
            case "playerItem": {
                const { player, itemId } = actor;
                return {
                    animation: getPlayerItemAnimation(
                        actorData.player,
                        itemId,
                        player.animation.seqId,
                    ),
                    frameIndex: player.animation.frame,
                };
            }
            case "enemy": {
                const { enemy, animSet } = actor;
                return {
                    animation: getEnemyAnimation(animSet, enemy.animation.seqId),
                    frameIndex: enemy.animation.frame,
                };
            }
            case "projectile": {
                const { projectile } = actor;
                return {
                    animation: actorData.projectiles.projectileMeshes[projectile.spec.kind],
                    frameIndex: projectile.animation.frame,
                };
            }
            case "effect": {
                const { effect } = actor;
                return {
                    animation: actorData.projectiles.effectAnimations[effect.kind],
                    frameIndex: effect.animation.frame,
                };
            }
            case "groundItem": {
                const { item } = actor;
                const itemId = itemIdForTier(item.path, item.tierIndex);
                const animation = getGroundItemAnimation(actorData.groundItems, itemId);
                return animation ? { animation, frameIndex: 0 } : undefined;
            }
            case "previewGfx": {
                const animation = this.currentPreviewGfxBake()?.anim;
                return animation
                    ? { animation, frameIndex: this.previewGfxAnimation.frame }
                    : undefined;
            }
        }
    }

    private drawActorPass(actorDataTexture: Texture, alpha: boolean): void {
        const actorBuffer = this.actorBuffer;
        if (!actorBuffer || this.activeActorMeshes.length === 0) {
            return;
        }

        const { drawCall, drawRanges } = actorBuffer.drawCall;

        drawCall.texture("u_actorDataTexture", actorDataTexture);
        drawCall.uniform("u_highlightId", this.highlightedEnemy?.id ?? 0);

        for (let i = 0; i < this.activeActorMeshes.length; i++) {
            const mesh = this.activeActorMeshes[i];
            const frame = alpha ? mesh.transparent : mesh.opaque;
            (drawCall as any).offsets[i] = frame[0];
            (drawCall as any).numElements[i] = frame[1];
            drawRanges[i] = frame;
        }
        for (let i = this.activeActorMeshes.length; i < drawRanges.length; i++) {
            (drawCall as any).offsets[i] = NULL_DRAW_RANGE[0];
            (drawCall as any).numElements[i] = NULL_DRAW_RANGE[1];
            drawRanges[i] = NULL_DRAW_RANGE;
        }

        this.draw(drawCall, drawRanges);
    }

    renderOpaqueActorPass(actorDataTexture: Texture): void {
        this.drawActorPass(actorDataTexture, false);
    }

    renderTransparentActorPass(actorDataTexture: Texture): void {
        this.drawActorPass(actorDataTexture, true);
    }

    renderTransparentPass(): void {
        for (let i = this.mapManager.visibleMapCount - 1; i >= 0; i--) {
            const map = this.mapManager.visibleMaps[i];

            const { drawCall, drawRanges } = map.getDrawCall(MapDrawPass.ALPHA);

            for (const loc of map.locsAnimated) {
                if (loc.anim.framesAlpha) {
                    const frameId = loc.frame;
                    const frame = loc.anim.framesAlpha[frameId | 0];

                    const index = loc.getDrawRangeIndex(MapDrawPass.ALPHA);
                    if (index !== -1) {
                        drawCall.offsets[index] = frame[0];
                        (drawCall as any).numElements[index] = frame[1];

                        drawRanges[index] = frame;
                    }
                }
            }

            this.draw(drawCall, drawRanges);
        }
    }

    renderTransparentNpcPass(npcDataTextureIndex: number, npcDataTexture: Texture): void {
        if (!this.loadNpcs) {
            return;
        }

        for (let i = this.mapManager.visibleMapCount - 1; i >= 0; i--) {
            const map = this.mapManager.visibleMaps[i];
            const npcs = map.npcs;

            if (npcs.length === 0) {
                continue;
            }

            const dataOffset = map.npcDataTextureOffsets[npcDataTextureIndex];
            if (dataOffset === -1) {
                continue;
            }

            const { drawCall, drawRanges } = map.drawCallNpc;

            drawCall.uniform("u_npcDataOffset", dataOffset);
            drawCall.texture("u_npcDataTexture", npcDataTexture);
            drawCall.uniform("u_verticalOffset", 0);
            drawCall.uniform("u_highlightId", 0);

            for (let i = 0; i < npcs.length; i++) {
                const npc = npcs[i];
                const anim = npc.getAnimationFrames();

                const frameId = npc.movementFrame;
                let frame: DrawRange = NULL_DRAW_RANGE;
                if (anim.framesAlpha) {
                    frame = anim.framesAlpha[frameId];
                }

                (drawCall as any).offsets[i] = frame[0];
                (drawCall as any).numElements[i] = frame[1];

                drawRanges[i] = frame;
            }

            this.draw(drawCall, drawRanges);
        }
    }

    override async cleanUp(): Promise<void> {
        super.cleanUp();
        this.mapViewer.workerPool.resetLoader(this.dataLoader);
        this.mapViewer.workerPool.resetLoader(this.actorLoader);

        this.quadArray?.delete();
        this.quadArray = undefined;

        this.quadPositions?.delete();
        this.quadPositions = undefined;

        // Uniforms
        this.sceneUniformBuffer?.delete();
        this.sceneUniformBuffer = undefined;

        // Framebuffers
        this.framebuffer?.delete();
        this.framebuffer = undefined;

        this.colorTarget?.delete();
        this.colorTarget = undefined;

        this.depthTarget?.delete();
        this.depthTarget = undefined;

        this.textureFramebuffer?.delete();
        this.textureFramebuffer = undefined;

        this.textureColorTarget?.delete();
        this.textureColorTarget = undefined;

        // Textures
        this.textureArray?.delete();
        this.textureArray = undefined;

        this.textureMaterials?.delete();
        this.textureMaterials = undefined;

        this.npcDataTextures?.delete();
        this.npcDataTextures = undefined;

        this.actorDataTextures?.delete();
        this.actorDataTextures = undefined;

        this.actorBuffer?.delete();
        this.actorBuffer = undefined;

        this.clearMaps();

        if (this.shadersPromise) {
            for (const shader of await this.shadersPromise) {
                shader.delete();
            }
            this.shadersPromise = undefined;
        }
        console.log("Renderer cleaned up");
    }
}
