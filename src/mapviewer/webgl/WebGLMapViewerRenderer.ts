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
import { MapSquareCoord } from "../../rs/map/MapSquareCoord";
import { Scene } from "../../rs/scene/Scene";
import { isWebGL2Supported } from "../../util/DeviceUtil";
import { ResidencyPolicyKind, WholeWorldResidency } from "../MapManager";
import { MapViewer } from "../MapViewer";
import { MapViewerRenderer } from "../MapViewerRenderer";
import { MapViewerRendererType, WEBGL } from "../MapViewerRenderers";
import { WORLD_OBJECT_BAKES } from "../assets/ActorAssets";
import { AbilityTargetKind, AimMode, Delivery, WeaponStyle, aimModeFor } from "../game/Ability";
import { AnimPreviewParams, buildPreviewEnemyType, stepSeqId } from "../game/AnimPreview";
import {
    AnimationPlayback,
    AnimationState,
    SeqTiming,
    loadSeqTiming,
    sequenceDurationSeconds,
} from "../game/Animation";
import { CombatEventKind } from "../game/CombatEvent";
import { Encounter, EncounterSpawnMode } from "../game/Encounter";
import { Enemy, EnemyState } from "../game/Enemy";
import { EnemyBehaviour, resolveEnemyType } from "../game/EnemyType";
import { equippedVisualItemIds, itemIdForTier } from "../game/Equipment";
import {
    AbilitySlotInput,
    CombatInput,
    GameWorld,
    InteractionIntent,
    PickupTarget,
} from "../game/GameWorld";
import { GroundItem } from "../game/GroundItem";
import {
    Interaction,
    InteractionId,
    WorldObject,
    WorldObjectId,
    WorldObjectVariant,
    WorldObjectVisual,
    worldObjectRotationUnits,
} from "../game/Interaction";
import { Player, PlayerInput } from "../game/Player";
import { createCharacterLevel, experienceForLevel } from "../game/Progression";
import { Projectile } from "../game/Projectile";
import { loadSeqCatalog } from "../game/SeqCatalog";
import { TILE_SIZE, Terrain } from "../game/Terrain";
import { VisualEffect } from "../game/VisualEffect";
import { CAST_ITEM_OVERRIDES_BY_SEQ_ID } from "../game/abilities";
import {
    EnemyScreenCandidate,
    ScreenPoint,
    ScreenRect,
    distanceToRect,
    pickEnemyNear,
} from "../game/enemyPicking";
import { computeRoofHiddenTiles, decodeTileKey } from "../game/roofHiding";
import { summarizeModifiers } from "../game/upgrades";
import {
    ClickCrossKind,
    ClickCrossPlaybackState,
    IDLE_CLICK_CROSS_STATE,
    advanceClickCross,
    classifyPressCross,
    currentClickCrossFrame,
    requestClickCross,
} from "../hud/ClickCross";
import {
    CLOSED_MENU_STATE,
    MenuAction,
    MenuActionKind,
    MenuState,
    MenuStateKind,
    MenuTarget,
    MenuTargetKind,
    OpenMenuState,
    Point,
    buildMenuEntries,
    clickMenuAt,
    computeMenuLayout,
    openMenuAt,
    updateMenuHover,
} from "../hud/contextMenu";
import {
    AbilitySlotBlockReason,
    AbilitySlotHudInfo,
    BossHudInfo,
    ClickCrossHudInfo,
    ContextMenuTooltipHudInfo,
    HudFrame,
    PhaseStatus,
    PickupFlashEvent,
    SplatEvent,
    SplatKind,
    UpgradeCardHudInfo,
} from "../hud/HudFrame";
import { HudRegionKind, computeHudLayout, createMenuTextMeasurer, hitTestHud } from "../hud/hudDraw";
import { DataTextureFormat, DataTextureRing, DataTextureSlot } from "./DataTextureRing";
import { NULL_DRAW_RANGE } from "./DrawRange";
import { InteractType } from "./InteractType";
import { MapDrawPass } from "./MapDrawPass";
import { MAP_DATA_TEXTURE_RING_SIZE, MapPrograms, WebGLMapSquare } from "./WebGLMapSquare";
import { WebGLTerrain } from "./WebGLTerrain";
import {
    ACTOR_INSTANCE_TEXELS,
    ActorInstance,
    writeActorInstance,
} from "./actor/ActorInstanceData";
import {
    EnemyTypeAnimationSet,
    PreviewGfxBake,
    getEnemyAnimation,
    getGroundItemAnimation,
    getPlayerBodyAnimation,
    getPlayerItemAnimation,
    getWorldObjectAnimation,
} from "./actor/ActorRenderData";
import { WebGLActorBuffer } from "./actor/WebGLActorBuffer";
import { screenToGroundPoint, worldToScreen } from "./groundPoint";
import { ActorBufferData } from "./loader/ActorBufferData";
import { ActorLoaderInput } from "./loader/ActorLoaderInput";
import { ActorRenderDataLoader } from "./loader/ActorRenderDataLoader";
import { SdMapData } from "./loader/SdMapData";
import { SdMapDataLoader } from "./loader/SdMapDataLoader";
import { SdMapLoaderInput } from "./loader/SdMapLoaderInput";
import { LOC_INSTANCE_TEXELS, writeLocInstance } from "./loc/LocInstanceData";
import { NPC_INSTANCE_TEXELS, writeNpcInstance } from "./npc/NpcInstanceData";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createActorProgram,
    createMainProgram,
    createNpcProgram,
    createSkinnedLocProgram,
} from "./shaders/Shaders";
import { SkinAnimation } from "./skin/SkinAnimation";
import { SkinnedMesh } from "./skin/SkinnedMeshBuilder";
import { isWithinTickRange, worldToMapSquare } from "./tickRange";

const MAX_TEXTURES = 2048;
const TEXTURE_SIZE = 128;

// When the cursor isn't exactly over an enemy's pixels, pick the nearest enemy whose projected
// screen rect is within this radius, so aiming stays forgiving without becoming auto-aim.
const ENEMY_HOVER_PICK_RADIUS_PX = 20;
const ENEMY_BODY_HEIGHT_SCALE = 3;

// A world object's (lever/chest) click/hover target: a box roughly one tile wide and about as
// tall as a player, centred on its own tile - the object itself is the hover target, not a
// screen-space point near some pose.
const WORLD_OBJECT_HALF_WIDTH_UNITS = 48;
const WORLD_OBJECT_HEIGHT_UNITS = 110;
const WORLD_OBJECT_HOVER_PICK_RADIUS_PX = 12;

// Leva never overwrites an existing input's value when a schema is re-registered, so read-only
// preview labels are polled monitors instead of static values.
const PREVIEW_LABEL_MONITOR = { graph: false, interval: 200 };
// Ids baked from a gfx id typed into the viewer, so Prev/Next still have neighbours to step
// through without the pack and bake growing to the whole cache.
const PREVIEW_GFX_RELOAD_RANGE_SIZE = 21;

// A ground item's click/hover target: a small box around the item itself, the same
// projected-footprint approach as a world object's (see projectWorldObjectScreenRect), just sized
// for a loot drop rather than a lever/chest.
const GROUND_ITEM_HALF_WIDTH_UNITS = 32;
const GROUND_ITEM_HEIGHT_UNITS = 40;
const GROUND_ITEM_HOVER_PICK_RADIUS_PX = 16;

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

function keyForSkillSlot(skillSlot: number): string | undefined {
    const digit = skillSlot + 1;
    return digit <= 9 ? `Digit${digit}` : undefined;
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
    | { kind: "groundItem"; item: GroundItem; itemId: number }
    | { kind: "worldObject"; visual: WorldObjectVisual }
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
    mapPrograms?: MapPrograms;
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
    highlightedWorldObject?: WorldObjectVisual;
    highlightedGroundItem?: GroundItem;
    // Set by a click on a ground item's mesh (see buildPickupInput); cleared by a later click
    // elsewhere, by the item being picked up or expiring, or by resolving to nothing on load.
    private pickupTargetItemId?: number;
    private selectedInteractionId?: InteractionId;

    // The right-click "Choose Option" menu (see hud/contextMenu.ts). menuState is the pure state
    // machine; pendingMenuAction is the one-shot action an entry selection queues, consumed by the
    // matching input builder (buildInteractionInput/buildPickupInput/buildCombatInput) on the next
    // frame - the same route a left-click already uses, just triggered a frame later than a real
    // click since inputCapturedByMenu suppresses every mouse-driven builder for the whole frame the
    // menu was open at the start of.
    private menuState: MenuState = CLOSED_MENU_STATE;
    private pendingMenuAction?: MenuAction;
    // Where to show the click cross once pendingMenuAction reaches the sim (see updateClickCross) -
    // the anchor of the menu that queued it, i.e. where the user originally right-clicked, not
    // where the entry itself sits.
    private pendingMenuActionAnchor?: Point;
    private inputCapturedByMenu = false;
    private readonly menuTextMeasurer = createMenuTextMeasurer();

    // The click cross's playback state (see hud/ClickCross.ts) - rate-limited so a click while one
    // is already playing queues rather than restarting it.
    private clickCrossState: ClickCrossPlaybackState = IDLE_CLICK_CROSS_STATE;

    npcRenderCount: number = 0;
    npcRenderData: Uint32Array = new Uint32Array(16 * 4 * NPC_INSTANCE_TEXELS);

    npcDataTextures?: DataTextureRing;

    locRenderCount: number = 0;
    locRenderData: Uint32Array = new Uint32Array(16 * 4 * LOC_INSTANCE_TEXELS);
    locDataTextures?: DataTextureRing;

    // Actors: player, enemies, projectiles and visual effects, decoupled from any map square.
    actorBuffer?: WebGLActorBuffer;
    actorInstanceCount: number = 0;
    actorInstanceData: Uint32Array = new Uint32Array(16 * 4 * ACTOR_INSTANCE_TEXELS);
    actorDataTextures?: DataTextureRing;
    activeActorMeshes: SkinnedMesh[] = [];

    // The gfx preview's currently shown spot anim id and playback mode (see AnimPreview.ts's
    // SPOT_ANIMS mode): unlike the npc seq preview, there's no Enemy to own this state on, since a
    // gfx preview never spawns one.
    private previewGfxId?: number;
    private previewGfxPlayback: AnimationPlayback = AnimationPlayback.LOOP;
    // Undefined while no animated spot anim is previewed (a static one stays on its one frame).
    private previewGfxAnimation?: AnimationState;

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
        super(mapViewer, ResidencyPolicyKind.WHOLE_WORLD);
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

        this.locDataTextures = new DataTextureRing(
            this.app,
            MAP_DATA_TEXTURE_RING_SIZE,
            DataTextureFormat.RGBA32UI,
        );
        this.npcDataTextures = new DataTextureRing(
            this.app,
            MAP_DATA_TEXTURE_RING_SIZE,
            DataTextureFormat.RGBA32UI,
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
            createSkinnedLocProgram(hasMultiDraw, false),
            createSkinnedLocProgram(hasMultiDraw, true),
            createNpcProgram(hasMultiDraw, true),
            createActorProgram(hasMultiDraw, true),
            FRAME_PROGRAM,
            FRAME_FXAA_PROGRAM,
        );

        const [
            mainProgram,
            mainAlphaProgram,
            skinnedLocProgram,
            skinnedLocAlphaProgram,
            npcProgram,
            actorProgram,
            frameProgram,
            frameFxaaProgram,
        ] = programs;
        this.mapPrograms = {
            main: mainProgram,
            mainAlpha: mainAlphaProgram,
            skinnedLoc: skinnedLocProgram,
            skinnedLocAlpha: skinnedLocAlphaProgram,
            npc: npcProgram,
        };
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

    // Sized for every texture definition, but only layer 0 (white) is filled here: the pack holds
    // the sprites of just the textures its models and floors use, and the workers return those
    // textures' pixels with the map squares and actors that use them (see updateTextureArray).
    initTextureArray() {
        if (this.textureArray) {
            this.textureArray.delete();
            this.textureArray = undefined;
        }
        this.loadedTextureIds.clear();

        const pixelCount = TEXTURE_SIZE * TEXTURE_SIZE;

        const textureCount = this.textureIds.length;
        const pixels = new Int32Array((textureCount + 1) * pixelCount);

        // White texture
        pixels.fill(0xffffffff, 0, pixelCount);

        this.textureArray = createTextureArray(
            this.app,
            new Uint8Array(pixels.buffer),
            TEXTURE_SIZE,
            TEXTURE_SIZE,
            textureCount + 1,
            {},
        );

        this.updateTextureFiltering();
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
        return enemy?.previewSeq?.seqId ?? preview.seqRange.from;
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
        if (!preview || preview.kind !== "NPC_SEQS" || !enemy || enemy.previewSeq === undefined) {
            return;
        }
        enemy.previewSeq = this.loadPreviewSeq(
            stepSeqId(enemy.previewSeq.seqId, preview.seqRange, direction),
        );
        this.restartPreviewAnimation();
        this.notifyControlsChanged?.();
    }

    private restartPreviewAnimation(): void {
        const enemy: Enemy | undefined = this.mapViewer.world.enemies[0];
        if (!enemy || enemy.previewSeq === undefined) {
            return;
        }
        enemy.animation.restart(enemy.previewSeq);
    }

    // The animation viewer steps through arbitrary seq ids of its range, so it reads their timings
    // from the pack directly instead of through the game's catalog.
    private loadPreviewSeq(seqId: number): SeqTiming {
        return loadSeqTiming(seqId, this.mapViewer.seqTypeLoader, this.mapViewer.seqFrameLoader);
    }

    private previewSeqInfo(seqId: number): string {
        const seq = this.loadPreviewSeq(seqId);
        const durationMs = Math.round(sequenceDurationSeconds(seq) * 1000);
        return `${seq.frameTicks.length} frames, ${durationMs} ms`;
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

    // Typing an id inside the baked range just switches to it; outside it, the page reloads on a
    // range starting at the id, since the pack and the bake only ever hold the url's range.
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
        this.mapViewer.reloadWithSpotAnimPreviewRange({
            from: gfxId,
            to: gfxId + PREVIEW_GFX_RELOAD_RANGE_SIZE - 1,
        });
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
        const seqId = this.currentPreviewGfxBake()?.seqId;
        this.previewGfxAnimation =
            seqId === undefined || seqId === -1
                ? undefined
                : new AnimationState(this.loadPreviewSeq(seqId));
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
        const seq = this.loadPreviewSeq(spotAnim.sequenceId);
        const durationMs = Math.round(sequenceDurationSeconds(seq) * 1000);
        return `model ${spotAnim.modelId}, seq ${spotAnim.sequenceId}, ${seq.frameTicks.length} frames, ${durationMs} ms`;
    }

    // Ticks the gfx preview's own animation state each frame (see advance()'s call site): unlike
    // the npc seq preview, there's no Enemy/GameWorld tick to ride along with.
    private advancePreviewGfx(deltaTimeSeconds: number): void {
        const preview = this.mapViewer.animPreview;
        if (!preview || preview.kind !== "SPOT_ANIMS") {
            return;
        }
        this.previewGfxAnimation?.advance(deltaTimeSeconds, this.previewGfxPlayback);
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
        programs: MapPrograms,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        time: number,
    ): void {
        const { mapX, mapY } = mapData;

        this.mapViewer.setMinimapImageUrl(mapX, mapY, URL.createObjectURL(mapData.minimapBlob));

        const frameCount = this.stats.frameCount;
        const mapSquare = WebGLMapSquare.load(
            this.mapViewer.seqTypeLoader,
            this.mapViewer.npcTypeLoader,
            this.mapViewer.basTypeLoader,
            this.app,
            programs,
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
        this.updateTextureArray(data.loadedTextures);

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

    override residencyPolicy(): WholeWorldResidency {
        return { kind: ResidencyPolicyKind.WHOLE_WORLD };
    }

    // True once the encounter has spawned and the camera has settled onto its real third-person
    // framing: the earliest point at which a frame is safe to show the user (see MapViewerContainer,
    // which keeps the loading screen up until this flips true).
    override get isReadyToReveal(): boolean {
        return this.encounterSpawned && this.hasPinnedCameraSinceSpawn;
    }

    trySpawnEncounter(): void {
        if (this.encounterSpawned || !this.actorBuffer) {
            return;
        }

        const world = this.mapViewer.world;
        const { playerSpawn } = this.encounter;
        if (!this.isEncounterMapLoaded) {
            return;
        }

        world.startEncounter(this.encounter, playerSpawn.x, playerSpawn.y, playerSpawn.level);
        this.spawnPreviewEnemyIfNeeded();
        this.initPreviewGfxIfNeeded();
        this.encounterSpawned = true;
        console.log(`[startup] encounter spawned at ${performance.now().toFixed(0)}ms`);
    }

    // The animation viewer's one preview enemy: spawned directly (not via the wave/static roster)
    // at enemySpawns[0], with previewSeq pinned to the start of the requested range.
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
        const enemyType = resolveEnemyType(
            buildPreviewEnemyType({
                npcTypeId: preview.npcTypeId,
                idleSeqId: npcType.idleSeqId,
                walkSeqId: npcType.walkSeqId,
                size: npcType.size,
            }),
            loadSeqCatalog(
                [npcType.idleSeqId, npcType.walkSeqId],
                this.mapViewer.seqTypeLoader,
                this.mapViewer.seqFrameLoader,
            ),
        );
        const spawnPoint = this.encounter.enemySpawns[0];
        const enemyId = this.mapViewer.world.spawnEnemy(
            spawnPoint.x,
            spawnPoint.y,
            spawnPoint.level,
            enemyType,
        );
        const enemy = this.mapViewer.world.findEnemy(enemyId);
        if (enemy) {
            enemy.previewSeq = this.loadPreviewSeq(preview.seqRange.from);
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
        this.previewGfxId = preview.range.from;
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
            !this.mapPrograms ||
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
        this.updateContextMenu();
        const menuActionWasPending = this.pendingMenuAction !== undefined;
        const movement = this.buildMovementInput();
        const combat = this.buildCombatInput();
        const styleSwitch = this.buildKeyStyleSwitchInput() ?? this.buildStyleSwitchInput();
        const chooseUpgrade = this.buildUpgradeChoiceInput();
        const pickupTarget = this.buildPickupInput();
        const interaction = this.buildInteractionInput();
        this.updateClickCross(menuActionWasPending, movement, combat, pickupTarget, interaction);
        this.mapViewer.world.advance(deltaTime / 1000, {
            movement,
            combat,
            styleSwitch,
            chooseUpgrade,
            pickupTarget,
            interaction,
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
        this.highlightedWorldObject = this.getHoveredWorldObject();
        this.highlightedGroundItem = this.getHoveredGroundItem();
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
        this.buildLocInstanceData();
        const { index: locDataTextureIndex, texture: locDataTexture } = this.updateLocDataTexture();

        this.buildActorInstanceData();
        const actorDataTexture = this.updateActorDataTexture().texture;

        this.app.disable(PicoGL.BLEND);
        const opaquePassStart = performance.now();
        this.renderOpaquePass(locDataTextureIndex, locDataTexture);
        const opaquePassTime = performance.now() - opaquePassStart;
        const opaqueNpcPassStart = performance.now();
        this.renderOpaqueNpcPass(npcDataTextureIndex, npcDataTexture);
        this.renderOpaqueActorPass(actorDataTexture);
        const opaqueNpcPassTime = performance.now() - opaqueNpcPassStart;

        this.app.enable(PicoGL.BLEND);
        const transparentPassStart = performance.now();
        this.renderTransparentPass(locDataTextureIndex, locDataTexture);
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
                this.mapPrograms,
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
        if (this.inputCapturedByMenu || !frame || !inputManager.isPressEvent()) {
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

    private buildMovementInput(): PlayerInput {
        const player = this.mapViewer.world.player;
        const inputManager = this.mapViewer.inputManager;
        if (inputManager.isKeyDownEvent("ShiftLeft") || inputManager.isKeyDownEvent("ShiftRight")) {
            this.runEnabled = !this.runEnabled;
        }
        const running = this.runEnabled;
        const stationary: PlayerInput = { x: 0, y: 0, running };

        if (
            this.inputCapturedByMenu ||
            !player ||
            this.selectedInteractionId !== undefined ||
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

    private buildUpgradeChoiceInput(): number | undefined {
        const frame = this.hudFrame;
        const cardCount = frame?.upgradeOffer?.cards.length ?? 0;
        if (!frame || cardCount === 0) {
            return undefined;
        }
        const input = this.mapViewer.inputManager;
        for (let index = 0; index < cardCount; index++) {
            if (input.isKeyDownEvent(`Digit${index + 1}`)) {
                return index;
            }
        }
        if (this.inputCapturedByMenu || !input.isPressEvent()) {
            return undefined;
        }
        const layout = computeHudLayout(
            frame.screenSize.width,
            frame.screenSize.height,
            frame.abilities.length,
            cardCount,
        );
        const region = hitTestHud(layout, input.pressEventX, input.pressEventY);
        return region?.kind === HudRegionKind.UPGRADE_CARD ? region.index : undefined;
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

    private buildCombatInput(): CombatInput {
        const player = this.mapViewer.world.player;
        if (!player) {
            return { basicAttack: { held: false }, skills: [] };
        }
        if (this.inputCapturedByMenu) {
            return { basicAttack: { held: false }, skills: player.skills.map(() => ({ held: false })) };
        }

        const inputManager = this.mapViewer.inputManager;
        const pointerOverHud = this.isPointerOverHud();

        // A menu-selected "Attack" behaves like a single left-click on that enemy: force the
        // hover/drag state for this one frame rather than opening a second route into the sim.
        let menuAttackTarget: Enemy | undefined;
        const pendingAction = this.pendingMenuAction;
        if (pendingAction?.kind === MenuActionKind.ATTACK_ENEMY) {
            this.pendingMenuAction = undefined;
            menuAttackTarget = this.mapViewer.world.findEnemy(pendingAction.enemyId);
        }

        const hoveredEnemy = menuAttackTarget ?? (pointerOverHud ? undefined : this.getHoveredEnemy());
        const isDragging =
            menuAttackTarget !== undefined || (!pointerOverHud && inputManager.isDragging());

        const inputFor = (held: boolean, delivery: Delivery): AbilitySlotInput => {
            if (!held) {
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

        return {
            basicAttack: inputFor(
                isDragging && hoveredEnemy !== undefined,
                player.basicAttack.effect.delivery,
            ),
            skills: player.skills.map((skill, skillSlot) => {
                const key = keyForSkillSlot(skillSlot);
                return inputFor(
                    key !== undefined && inputManager.isKeyDown(key),
                    skill.effect.delivery,
                );
            }),
        };
    }

    // The active interaction (if any) that operates a given world object - at most one, since a
    // lever/chest only ever has one live interaction (start XOR reward) at a time.
    private activeInteractionForObject(objectId: WorldObjectId): Interaction | undefined {
        return this.mapViewer.world.activeInteractions.find(
            (interaction) => interaction.objectId === objectId,
        );
    }

    private buildWorldObjectScreenCandidates(): EnemyScreenCandidate[] {
        const candidates: EnemyScreenCandidate[] = [];
        for (const visual of this.mapViewer.world.worldObjectVisuals) {
            if (!visual.visible || !this.activeInteractionForObject(visual.object.id)) {
                continue;
            }
            const rect = this.projectWorldObjectScreenRect(visual.object);
            if (rect) {
                candidates.push({ id: visual.object.id, rect });
            }
        }
        return candidates;
    }

    private projectWorldObjectScreenRect(object: WorldObject): ScreenRect | undefined {
        const viewProjMatrix = this.mapViewer.camera.viewProjMatrix;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const { x, y, level } = object.position;
        const groundHeight = this.terrain.getHeight(level, x, y);
        const corners = [
            [x - WORLD_OBJECT_HALF_WIDTH_UNITS, y - WORLD_OBJECT_HALF_WIDTH_UNITS],
            [x + WORLD_OBJECT_HALF_WIDTH_UNITS, y - WORLD_OBJECT_HALF_WIDTH_UNITS],
            [x - WORLD_OBJECT_HALF_WIDTH_UNITS, y + WORLD_OBJECT_HALF_WIDTH_UNITS],
            [x + WORLD_OBJECT_HALF_WIDTH_UNITS, y + WORLD_OBJECT_HALF_WIDTH_UNITS],
        ];
        const points: ScreenPoint[] = [];
        for (const [cx, cy] of corners) {
            const foot = worldToScreen(viewProjMatrix, cx, cy, groundHeight, width, height);
            const head = worldToScreen(
                viewProjMatrix,
                cx,
                cy,
                groundHeight + WORLD_OBJECT_HEIGHT_UNITS,
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

    private getHoveredWorldObject(): WorldObjectVisual | undefined {
        const inputManager = this.mapViewer.inputManager;
        if (inputManager.mouseX === -1 || inputManager.mouseY === -1 || this.isPointerOverHud()) {
            return undefined;
        }
        const pickedId = pickEnemyNear(
            { x: inputManager.mouseX, y: inputManager.mouseY },
            this.buildWorldObjectScreenCandidates(),
            WORLD_OBJECT_HOVER_PICK_RADIUS_PX,
        );
        if (pickedId === undefined) {
            return undefined;
        }
        return this.mapViewer.world.worldObjectVisuals.find(
            (visual) => visual.object.id === pickedId,
        );
    }

    private getHoveredGroundItem(): GroundItem | undefined {
        const inputManager = this.mapViewer.inputManager;
        if (inputManager.mouseX === -1 || inputManager.mouseY === -1 || this.isPointerOverHud()) {
            return undefined;
        }
        const pickedId = pickEnemyNear(
            { x: inputManager.mouseX, y: inputManager.mouseY },
            this.buildGroundItemScreenCandidates(),
            GROUND_ITEM_HOVER_PICK_RADIUS_PX,
        );
        return pickedId !== undefined ? this.mapViewer.world.findGroundItem(pickedId) : undefined;
    }

    // Everything under a screen point that the right-click menu (or its hover tooltip) can act on,
    // nearest first: at most one of each kind, since each picker already resolves the nearest
    // candidate of its own kind (see getHoveredEnemy/getHoveredWorldObject/buildPickupInput).
    private buildMenuTargetsUnderCursor(x: number, y: number): MenuTarget[] {
        const cursor = { x, y };
        const candidates: { target: MenuTarget; distance: number }[] = [];

        const enemyId = pickEnemyNear(
            cursor,
            this.buildEnemyScreenCandidates(),
            ENEMY_HOVER_PICK_RADIUS_PX,
        );
        const enemy = enemyId !== undefined ? this.mapViewer.world.findEnemy(enemyId) : undefined;
        if (enemy) {
            const npcType = this.resolveEnemyNpcType(enemy);
            const rect = this.projectEnemyScreenRect(enemy);
            candidates.push({
                target: {
                    kind: MenuTargetKind.ENEMY,
                    enemyId: enemy.id,
                    name: npcType.name,
                    combatLevel: npcType.combatLevel,
                },
                distance: rect ? distanceToRect(cursor, rect) : 0,
            });
        }

        const objectId = pickEnemyNear(
            cursor,
            this.buildWorldObjectScreenCandidates(),
            WORLD_OBJECT_HOVER_PICK_RADIUS_PX,
        );
        const worldObjectVisual =
            objectId !== undefined
                ? this.mapViewer.world.worldObjectVisuals.find(
                      (visual) => visual.object.id === objectId,
                  )
                : undefined;
        const interaction =
            worldObjectVisual && this.activeInteractionForObject(worldObjectVisual.object.id);
        if (worldObjectVisual && interaction) {
            const bake = WORLD_OBJECT_BAKES[worldObjectVisual.object.kind];
            const locId =
                worldObjectVisual.variant === WorldObjectVariant.ACTIVATED
                    ? bake.activatedLocId
                    : bake.restLocId;
            const locType = this.mapViewer.locTypeLoader.load(locId);
            const verb = locType.actions.find((action) => !!action) ?? "";
            const rect = this.projectWorldObjectScreenRect(worldObjectVisual.object);
            candidates.push({
                target: {
                    kind: MenuTargetKind.WORLD_OBJECT,
                    objectId: worldObjectVisual.object.id,
                    interactionId: interaction.id,
                    verb,
                    name: locType.name,
                },
                distance: rect ? distanceToRect(cursor, rect) : 0,
            });
        }

        const groundItemId = pickEnemyNear(
            cursor,
            this.buildGroundItemScreenCandidates(),
            GROUND_ITEM_HOVER_PICK_RADIUS_PX,
        );
        const groundItem =
            groundItemId !== undefined
                ? this.mapViewer.world.findGroundItem(groundItemId)
                : undefined;
        if (groundItem) {
            const itemId = itemIdForTier(groundItem.path, groundItem.tierIndex);
            const rect = this.projectGroundItemScreenRect(groundItem);
            candidates.push({
                target: {
                    kind: MenuTargetKind.GROUND_ITEM,
                    groundItemId: groundItem.id,
                    name: this.mapViewer.objTypeLoader.load(itemId).name,
                },
                distance: rect ? distanceToRect(cursor, rect) : 0,
            });
        }

        return candidates.sort((a, b) => a.distance - b.distance).map((candidate) => candidate.target);
    }

    private currentViewportSize() {
        return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    }

    private computeMenuLayoutFor(state: OpenMenuState) {
        return computeMenuLayout(
            state.entries,
            state.anchor,
            this.currentViewportSize(),
            this.menuTextMeasurer,
        );
    }

    // Drives menuState/pendingMenuAction from real input events, once per frame before the game's
    // own input builders run. inputCapturedByMenu reflects whether the menu was open at the start
    // of this call - the whole frame a click selects/cancels an entry is suppressed for every other
    // mouse-driven builder, so the frame after is when a queued pendingMenuAction actually reaches
    // the sim.
    private updateContextMenu(): void {
        const inputManager = this.mapViewer.inputManager;
        this.inputCapturedByMenu = this.menuState.kind === MenuStateKind.OPEN;

        if (this.menuState.kind === MenuStateKind.OPEN) {
            const layout = this.computeMenuLayoutFor(this.menuState);
            this.menuState = updateMenuHover(this.menuState, layout, {
                x: inputManager.mouseX,
                y: inputManager.mouseY,
            });
        }

        if (this.menuState.kind === MenuStateKind.OPEN && inputManager.isPressEvent()) {
            const layout = this.computeMenuLayoutFor(this.menuState);
            const anchor = this.menuState.anchor;
            const { state, action } = clickMenuAt(
                this.menuState,
                layout,
                inputManager.pressEventX,
                inputManager.pressEventY,
            );
            this.menuState = state;
            if (action !== undefined && action.kind !== MenuActionKind.CANCEL) {
                this.pendingMenuAction = action;
                this.pendingMenuActionAnchor = anchor;
            }
        } else if (
            this.menuState.kind === MenuStateKind.CLOSED &&
            inputManager.isPickEvent() &&
            !this.isPointerOverHud()
        ) {
            const anchor = { x: inputManager.pickX, y: inputManager.pickY };
            this.menuState = openMenuAt(anchor, this.buildMenuTargetsUnderCursor(anchor.x, anchor.y));
        }
    }

    // Spawns the click cross from the same results this tick's input builders already computed -
    // no second hit test (see hud/ClickCross.classifyPressCross). Must run after those builders,
    // since it needs to see whether one of them just consumed pendingMenuAction.
    private updateClickCross(
        menuActionWasPending: boolean,
        movement: PlayerInput,
        combat: CombatInput,
        pickupTarget: PickupTarget | undefined,
        interaction: InteractionIntent | undefined,
    ): void {
        const menuActionConsumed = menuActionWasPending && this.pendingMenuAction === undefined;
        if (menuActionConsumed) {
            const anchor = this.pendingMenuActionAnchor;
            this.pendingMenuActionAnchor = undefined;
            if (anchor) {
                this.spawnClickCross(ClickCrossKind.ACTION, anchor.x, anchor.y);
            }
            return;
        }

        const inputManager = this.mapViewer.inputManager;
        if (!inputManager.isPressEvent()) {
            return;
        }
        const kind = classifyPressCross({
            capturedByMenu: this.inputCapturedByMenu,
            interactionStarted: interaction?.kind === "START",
            attackingEnemy: combat.basicAttack.held,
            pickingUpItem: pickupTarget !== undefined,
            moving: movement.x !== 0 || movement.y !== 0,
        });
        if (!kind) {
            return;
        }
        this.spawnClickCross(kind, inputManager.pressEventX, inputManager.pressEventY);
    }

    // Both call sites feed the same single transition (see hud/ClickCross.requestClickCross) - a
    // click while one is already playing is remembered as the one pending cross rather than
    // restarting the animation in place.
    private spawnClickCross(kind: ClickCrossKind, screenX: number, screenY: number): void {
        this.clickCrossState = requestClickCross(
            this.clickCrossState,
            { kind, screenX, screenY },
            this.mapViewer.world.timeSeconds,
        );
    }

    // The hover tooltip shown while the menu is closed (see hud/contextMenu.tooltipTextRuns) -
    // undefined whenever there's nothing under the cursor to act on.
    private buildContextMenuTooltipInfo(): ContextMenuTooltipHudInfo | undefined {
        const inputManager = this.mapViewer.inputManager;
        if (!inputManager.isFocused() || this.isPointerOverHud()) {
            return undefined;
        }
        const targets = this.buildMenuTargetsUnderCursor(inputManager.mouseX, inputManager.mouseY);
        if (targets.length === 0) {
            return undefined;
        }
        return {
            anchor: { x: inputManager.mouseX, y: inputManager.mouseY },
            entries: buildMenuEntries(targets),
        };
    }

    private buildInteractionInput() {
        const input = this.mapViewer.inputManager;
        const activeIds = new Set(this.mapViewer.world.activeInteractions.map(({ id }) => id));
        if (this.selectedInteractionId && !activeIds.has(this.selectedInteractionId)) {
            this.selectedInteractionId = undefined;
        }

        if (this.inputCapturedByMenu) {
            return undefined;
        }

        const pendingAction = this.pendingMenuAction;
        if (pendingAction?.kind === MenuActionKind.START_INTERACTION) {
            this.pendingMenuAction = undefined;
            this.selectedInteractionId = pendingAction.interactionId;
            this.pickupTargetItemId = undefined;
            return { kind: "START" as const, interactionId: pendingAction.interactionId };
        }

        if (!input.isPressEvent()) {
            return undefined;
        }
        const hoveredObjectId = this.getHoveredWorldObject()?.object.id;
        const interaction =
            hoveredObjectId !== undefined
                ? this.activeInteractionForObject(hoveredObjectId)
                : undefined;
        if (interaction) {
            this.selectedInteractionId = interaction.id;
            this.pickupTargetItemId = undefined;
            return { kind: "START" as const, interactionId: interaction.id };
        }
        if (this.mapViewer.world.interactionState.kind !== "IDLE") {
            this.selectedInteractionId = undefined;
            return { kind: "CANCEL" as const };
        }
        this.selectedInteractionId = undefined;
        return undefined;
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

    // A click on a fresh press event either targets a ground item (a generous rect around the item
    // itself, the same projected-footprint approach as enemy/world-object picking) or clears any
    // pending pickup, the same way clicking an enemy or plain ground overrides a melee chase. The
    // target also clears itself once the item is gone (picked up or expired).
    private buildPickupInput(): PickupTarget | undefined {
        if (this.inputCapturedByMenu) {
            return undefined;
        }

        const inputManager = this.mapViewer.inputManager;
        const pendingAction = this.pendingMenuAction;
        if (pendingAction?.kind === MenuActionKind.PICK_UP_GROUND_ITEM) {
            this.pendingMenuAction = undefined;
            this.pickupTargetItemId = pendingAction.groundItemId;
        } else if (!this.isPointerOverHud() && inputManager.isPressEvent()) {
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

    // A box around the item's own mesh (see GROUND_ITEM_HALF_WIDTH_UNITS/HEIGHT_UNITS), projected
    // the same foot+head-corners way as an enemy's or world object's hover rect - the item itself is
    // the hover/pickup target now that there is no floor label to click instead.
    private projectGroundItemScreenRect(item: GroundItem): ScreenRect | undefined {
        const viewProjMatrix = this.mapViewer.camera.viewProjMatrix;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const groundHeight = this.groundItemTileHeight(item.level, item.x, item.y);
        if (groundHeight === undefined) {
            return undefined;
        }
        const corners = [
            [item.x - GROUND_ITEM_HALF_WIDTH_UNITS, item.y - GROUND_ITEM_HALF_WIDTH_UNITS],
            [item.x + GROUND_ITEM_HALF_WIDTH_UNITS, item.y - GROUND_ITEM_HALF_WIDTH_UNITS],
            [item.x - GROUND_ITEM_HALF_WIDTH_UNITS, item.y + GROUND_ITEM_HALF_WIDTH_UNITS],
            [item.x + GROUND_ITEM_HALF_WIDTH_UNITS, item.y + GROUND_ITEM_HALF_WIDTH_UNITS],
        ];
        const points: ScreenPoint[] = [];
        for (const [x, y] of corners) {
            const foot = worldToScreen(viewProjMatrix, x, y, groundHeight, width, height);
            const head = worldToScreen(
                viewProjMatrix,
                x,
                y,
                groundHeight + GROUND_ITEM_HEIGHT_UNITS,
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

    private buildAbilitySlots(player: Player): AbilitySlotHudInfo[] {
        const timeSeconds = this.mapViewer.world.timeSeconds;
        return player.skills.map((definition, skillSlot) => {
            const readiness = player.getSkillReadiness(skillSlot, timeSeconds);
            let blocked = AbilitySlotBlockReason.NONE;
            if (readiness.manaBlocked) {
                blocked = AbilitySlotBlockReason.MANA;
            } else if (readiness.cooldownFraction > 0) {
                blocked = AbilitySlotBlockReason.COOLDOWN;
            }

            return {
                name: definition.name,
                keyLabel: `${skillSlot + 1}`,
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
                const itemName = this.mapViewer.objTypeLoader.load(
                    itemIdForTier(event.path, event.tierIndex),
                ).name;
                pickupFlashEvents.push({ text: `Equipped: ${itemName}` });
                continue;
            }
            if (event.kind === CombatEventKind.LEVEL_UP) {
                pickupFlashEvents.push({ text: `Level up: ${event.level}` });
                void this.mapViewer.audioFeedback.playLevelUp();
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

        const phaseProgress = world.getPhaseProgress();

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
                level: player.characterLevel,
                experience: player.progression.experience,
                levelStartExperience: experienceForLevel(player.characterLevel),
                nextLevelExperience: experienceForLevel(
                    createCharacterLevel(player.characterLevel + 1),
                ),
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
            contextMenu: this.menuState.kind === MenuStateKind.OPEN ? this.menuState : undefined,
            contextMenuTooltip:
                this.menuState.kind === MenuStateKind.CLOSED
                    ? this.buildContextMenuTooltipInfo()
                    : undefined,
            upgradeOffer: world.pendingUpgradeOffer && {
                cards: world.pendingUpgradeOffer.map(
                    (upgrade, index): UpgradeCardHudInfo => ({
                        name: upgrade.name,
                        description: upgrade.description,
                        keyLabel: `${index + 1}`,
                    }),
                ),
            },
            pickupFlashEvents,
            phase: phaseProgress && {
                index: phaseProgress.index,
                total: phaseProgress.total,
                label: phaseProgress.label,
                status: PhaseStatus[phaseProgress.state],
                modifiersSummary: player && summarizeModifiers(player.getModifiers()),
            },
            previewSeqId: this.mapViewer.animPreview
                ? world.enemies[0]?.previewSeq?.seqId
                : undefined,
            boss,
            crossSprites: this.mapViewer.hudAssets.crossSprites,
            clickCross: this.buildClickCrossHudInfo(),
        };
    }

    // The active cross's resolved frame for this instant, or undefined (clearing the state) once
    // its animation has finished.
    private buildClickCrossHudInfo(): ClickCrossHudInfo | undefined {
        const now = this.mapViewer.world.timeSeconds;
        this.clickCrossState = advanceClickCross(this.clickCrossState, now);
        return currentClickCrossFrame(this.clickCrossState, now);
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

        if (this.npcRenderData.length / (4 * NPC_INSTANCE_TEXELS) < newCount) {
            const newData = new Uint32Array(
                Math.ceil((newCount * 2 * NPC_INSTANCE_TEXELS) / 16) * 16 * 4,
            );
            newData.set(this.npcRenderData);
            this.npcRenderData = newData;
        }

        for (const npc of npcs) {
            const tileX = npc.x >> 7;
            const tileY = npc.y >> 7;

            let renderPlane = npc.level;
            if (renderPlane < 3 && (map.getTileRenderFlag(1, tileX, tileY) & 0x2) === 2) {
                renderPlane++;
            }

            writeNpcInstance(this.npcRenderData, this.npcRenderCount, {
                x: npc.x,
                y: npc.y,
                packedInfo: encodeNpcInfo(InteractType.NPC, npc.rotation, renderPlane),
                npcTypeId: npc.npcType.id,
                frame: npc.currentFrame(),
            });

            this.npcRenderCount++;
        }
    }

    // Every visible map's animated locs, including maps outside the tick range: those keep
    // rendering their last frame.
    buildLocInstanceData(): void {
        const frameCount = this.stats.frameCount;
        this.locRenderCount = 0;
        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];
            const slot = frameCount % map.locDataTextureOffsets.length;
            if (map.locsAnimated.length === 0) {
                map.locDataTextureOffsets[slot] = -1;
                continue;
            }
            map.locDataTextureOffsets[slot] = this.locRenderCount;

            const newCount = this.locRenderCount + map.locsAnimated.length;
            if (this.locRenderData.length / (4 * LOC_INSTANCE_TEXELS) < newCount) {
                const newData = new Uint32Array(
                    Math.ceil((newCount * 2 * LOC_INSTANCE_TEXELS) / 16) * 16 * 4,
                );
                newData.set(this.locRenderData);
                this.locRenderData = newData;
            }
            for (const loc of map.locsAnimated) {
                writeLocInstance(this.locRenderData, this.locRenderCount, loc);
                this.locRenderCount++;
            }
        }
    }

    updateLocDataTexture(): DataTextureSlot {
        if (!this.locDataTextures) {
            throw new Error("Loc data texture ring used before init()");
        }
        return this.locDataTextures.upload(
            this.stats.frameCount,
            this.locRenderData,
            this.locRenderCount * LOC_INSTANCE_TEXELS,
        );
    }

    updateNpcDataTexture(): DataTextureSlot {
        if (!this.npcDataTextures) {
            throw new Error("NPC data texture ring used before init()");
        }
        return this.npcDataTextures.upload(
            this.stats.frameCount,
            this.npcRenderData,
            this.npcRenderCount * NPC_INSTANCE_TEXELS,
        );
    }

    private tryGetHeight(level: number, x: number, y: number): number | undefined {
        try {
            return this.terrain.getHeight(level, x, y);
        } catch (e) {
            return undefined;
        }
    }

    // OSRS draws ground items at the tile's own (flat) height rather than the exact bilinear height
    // under the drop's precise sub-tile position (see Scene.getCenterHeight, used by the real
    // client's obj placement) - sampling at the tile's exact centre reduces terrain.getHeight's
    // bilinear interpolation to that same corner average. A moving enemy's feet legitimately track
    // the finer per-point height, which is why only ground items need this: an item dropped near a
    // lower corner of a sloped/uneven tile otherwise renders visibly sunk relative to the tile as a
    // whole, even though its own model already sits flush with whatever height it's given (its base
    // is at model-local y=0).
    private groundItemTileHeight(level: number, x: number, y: number): number | undefined {
        const tileCenterX = Math.floor(x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
        const tileCenterY = Math.floor(y / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
        return this.tryGetHeight(level, tileCenterX, tileCenterY);
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
        // item (weapon or cast-item override, secondary offhand, amulet, and that style's
        // permanently-worn armour) - see Equipment.equippedVisualItemIds. 7 is the most any style's
        // combination ever produces (melee/magic: weapon + secondary + amulet + helm + body + legs,
        // plus the body itself).
        const PLAYER_MAX_INSTANCES = 7;

        const maxCount =
            (world.player !== undefined ? PLAYER_MAX_INSTANCES : 0) +
            world.enemies.length +
            world.projectiles.length +
            world.visualEffects.length +
            world.groundItems.length +
            world.worldObjectVisuals.length +
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
                    CAST_ITEM_OVERRIDES_BY_SEQ_ID.get(player.animation.seqId),
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
                    rotation: effect.rotation,
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
            const groundHeight = this.groundItemTileHeight(item.level, item.x, item.y);
            if (groundHeight === undefined) {
                continue;
            }
            push(
                { kind: "groundItem", item, itemId: itemIdForTier(item.path, item.tierIndex) },
                {
                    worldX: item.x,
                    worldY: item.y,
                    groundHeight,
                    rotation: 0,
                    level: this.terrain.getRenderLevel(item.level, item.x, item.y),
                    interactType: InteractType.OBJ,
                    interactId: item.id,
                    pitch: 0,
                },
            );
        }

        for (const visual of world.worldObjectVisuals) {
            if (!visual.visible) {
                continue;
            }
            const { x, y, level } = visual.object.position;
            const groundHeight = this.tryGetHeight(level, x, y);
            if (groundHeight === undefined) {
                continue;
            }
            push(
                { kind: "worldObject", visual },
                {
                    worldX: x,
                    worldY: y,
                    groundHeight,
                    rotation: worldObjectRotationUnits(visual.object),
                    level: this.terrain.getRenderLevel(level, x, y),
                    interactType: this.activeInteractionForObject(visual.object.id)
                        ? InteractType.LOC
                        : InteractType.NONE,
                    interactId: visual.object.id,
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

    renderOpaquePass(locDataTextureIndex: number, locDataTexture: Texture): void {
        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];

            const { drawCall, drawRanges } = map.getDrawCall(MapDrawPass.OPAQUE);
            this.draw(drawCall, drawRanges);
            this.drawAnimatedLocs(map, MapDrawPass.OPAQUE, locDataTextureIndex, locDataTexture);
        }
    }

    private drawAnimatedLocs(
        map: WebGLMapSquare,
        pass: MapDrawPass,
        locDataTextureIndex: number,
        locDataTexture: Texture,
    ): void {
        const dataOffset = map.locDataTextureOffsets[locDataTextureIndex];
        if (dataOffset === -1) {
            return;
        }
        const { drawCall, drawRanges } = map.getLocDrawCall(pass);
        drawCall.uniform("u_locDataOffset", dataOffset);
        drawCall.texture("u_locDataTexture", locDataTexture);
        this.draw(drawCall, drawRanges);
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
                const frame = npcs[i].animation.mesh.opaque;

                (drawCall as any).offsets[i] = frame[0];
                (drawCall as any).numElements[i] = frame[1];

                drawRanges[i] = frame;
            }

            this.draw(drawCall, drawRanges);
        }
    }

    private getActorPose(
        actor: ActiveActor,
    ): { readonly animation: SkinAnimation; readonly frameIndex: number } | undefined {
        if (!this.actorBuffer) {
            return undefined;
        }
        const actorData = this.actorBuffer.actorData;
        switch (actor.kind) {
            case "playerBody": {
                const { player } = actor;
                return {
                    animation: getPlayerBodyAnimation(
                        actorData.player,
                        player.style,
                        player.animation.seqId,
                    ),
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
                    frameIndex: projectile.frame,
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
                const animation = getGroundItemAnimation(actorData.groundItems, actor.itemId);
                return animation ? { animation, frameIndex: 0 } : undefined;
            }
            case "worldObject": {
                const { object, variant } = actor.visual;
                const animation = getWorldObjectAnimation(
                    actorData.worldObjects,
                    object.kind,
                    variant,
                );
                return { animation, frameIndex: 0 };
            }
            case "previewGfx": {
                const animation = this.currentPreviewGfxBake()?.anim;
                return animation
                    ? { animation, frameIndex: this.previewGfxAnimation?.frame ?? 0 }
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
        drawCall.uniform("u_highlightLocId", this.highlightedWorldObject?.object.id ?? 0);
        drawCall.uniform("u_highlightItemId", this.highlightedGroundItem?.id ?? 0);

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

    renderTransparentPass(locDataTextureIndex: number, locDataTexture: Texture): void {
        for (let i = this.mapManager.visibleMapCount - 1; i >= 0; i--) {
            const map = this.mapManager.visibleMaps[i];

            const { drawCall, drawRanges } = map.getDrawCall(MapDrawPass.ALPHA);
            this.draw(drawCall, drawRanges);
            this.drawAnimatedLocs(map, MapDrawPass.ALPHA, locDataTextureIndex, locDataTexture);
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
                const frame = npcs[i].animation.mesh.transparent;

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
        this.locDataTextures?.delete();
        this.locDataTextures = undefined;

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
