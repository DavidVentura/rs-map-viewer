import { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import { LocTypeLoader } from "../../../rs/config/loctype/LocTypeLoader";
import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { SpotAnimTypeLoader } from "../../../rs/config/spotanimtype/SpotAnimTypeLoader";
import {
    CHARACTER_LIGHT_CONTRAST_BONUS,
    CHARACTER_LIGHT_DIRECTION,
} from "../../../rs/model/CharacterLight";
import { Model } from "../../../rs/model/Model";
import { ModelLoader } from "../../../rs/model/ModelLoader";
import { PoseSpace } from "../../../rs/model/animation/FramePalette";
import {
    ActorAssets,
    ArrowObjBake,
    EnemyTypeAssets,
    PlayerAssets,
    PreviewAssets,
    ProjectileBake,
    SpotAnimBake,
    WORLD_OBJECT_BAKES,
    actorAssets,
} from "../../assets/ActorAssets";
import { WeaponStyle } from "../../game/Ability";
import { getEncounter } from "../../game/Encounter";
import { EnemyTypeId } from "../../game/EnemyType";
import { DroppableItemDisplay } from "../../game/Equipment";
import { WorldObjectKind } from "../../game/Interaction";
import {
    WardenP3VoidPiece,
    WardenP3VoidPieceKey,
    wardenP3VoidPieceKey,
} from "../../game/WardenP3CollapsedFloor";
import { PlayerAppearance, PlayerGender } from "../../player/PlayerAppearance";
import { PlayerModelLoader } from "../../player/PlayerModelLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/WorkerState";
import {
    CollapsedFloorActorData,
    EnemyTypeAnimationSet,
    GROUND_ITEM_SCALE,
    GroundItemActorData,
    PlayerActorData,
    PreviewGfxAnimationSet,
    PreviewGfxBake,
    PreviewNpcBake,
    ProjectileActorData,
    WorldObjectActorData,
    WorldObjectMeshes,
} from "../actor/ActorRenderData";
import { SkinAnimation } from "../skin/SkinAnimation";
import { SkinPaletteBuilder } from "../skin/SkinPaletteBuilder";
import { PoseableSeq, describePoseRig, poseRigKey, samePoseRig } from "../skin/SkinRig";
import { SkinFaceSelection, SkinnedMesh, SkinnedMeshBuilder } from "../skin/SkinnedMeshBuilder";
import { Skinning, skinnedGeometryTransferables } from "../skin/Skinning";
import { ActorBufferData } from "./ActorBufferData";
import { ActorLoaderInput } from "./ActorLoaderInput";
import { brightenModel, buildSpotAnimModel } from "./ActorModels";
import { buildTextureIdIndexMap } from "./TextureIndexMap";

const PLAYER_STYLES: readonly WeaponStyle[] = [
    WeaponStyle.MELEE,
    WeaponStyle.RANGED,
    WeaponStyle.MAGIC,
];

function createPlayerActorData(
    playerModelLoader: PlayerModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
    assets: PlayerAssets,
): PlayerActorData {
    const baseNpc = npcTypeLoader.load(assets.baseNpcTypeId);

    // The full, unfiltered body (every one of npc 3105's own model ids) is only used to pose item
    // attachments below (buildBaseModel merges it with each item so the item's own recolor/label
    // data lines up the same way it would on the complete body) - it is never itself drawn, so its
    // face count only matters as the offset item meshes are extracted from.
    const fullBodyAppearance = new PlayerAppearance(
        baseNpc.modelIds,
        [],
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );
    const fullBodyModel = playerModelLoader.getModel(fullBodyAppearance, -1, -1);
    if (!fullBodyModel) {
        throw new Error("Player body model is missing from the cache");
    }
    const bodyFaceCount = fullBodyModel.faceCount;

    // One body mesh per style, built from only that style's visible body-kit model ids (see
    // ActorAssets.bodyModelIdsForStyle) - a style's permanently-worn armour hides the rest.
    const styleBodyEntries = PLAYER_STYLES.map((style): [WeaponStyle, Model] => {
        const appearance = new PlayerAppearance(
            assets.bodyModelIdsByStyle[style],
            [],
            PlayerGender.MALE,
            baseNpc.ambient,
            baseNpc.contrast,
        );
        const model = playerModelLoader.getModel(appearance, -1, -1);
        if (!model) {
            throw new Error(`Player body model is missing for style ${style}`);
        }
        return [style, model];
    });

    const itemEntries = assets.attachmentItemIds.map((itemId): [number, Model] => {
        const appearance = new PlayerAppearance(
            baseNpc.modelIds,
            [itemId],
            PlayerGender.MALE,
            baseNpc.ambient,
            baseNpc.contrast,
        );
        const model = playerModelLoader.getModel(appearance, -1, -1);
        if (!model) {
            throw new Error(`Player attachment model is missing for item ${itemId}`);
        }
        return [itemId, model];
    });
    const rig = skinning.addRig(
        fullBodyModel,
        [
            ...styleBodyEntries.map(([, model]) => ({ model, selection: SkinFaceSelection.all() })),
            ...itemEntries.map(([, model]) => ({
                model,
                selection: SkinFaceSelection.startingAt(bodyFaceCount),
            })),
        ],
        requireSeqs(skinning, assets.seqIds),
        PoseSpace.identity(),
    );
    const bodyMeshesByStyle = Object.fromEntries(
        styleBodyEntries.map(([style], index) => [style, rig.meshes[index]]),
    ) as Record<WeaponStyle, SkinnedMesh>;
    const itemMeshes = rig.meshes.slice(styleBodyEntries.length);
    const itemsByItemId = new Map(
        itemEntries.map(([itemId], index) => [itemId, itemMeshes[index]]),
    );
    return {
        bodyMeshesByStyle,
        bodyAnimationsBySeqId: rig.animationsBySeqId,
        itemsByItemId,
    };
}

// Bakes every OSRS item that can ever appear as a ground drop as a single static ground-lying
// frame, the same way ProjectileBaker bakes the arrow model. Ammo bakes at its stack display count
// (see Equipment.groundItemDisplayCount) so it resolves to the path's pile model (ObjType.getModel
// picks the model for the count) instead of a lone single-item model.
//
// Lit with the character light rather than ObjModelLoader's own scenery light: a dropped item's
// upward-facing faces are what the top-down camera actually sees, and the scenery light (only ~8
// degrees above horizontal, meant for walls/floors) leaves them nearly black on the arena's dark
// floor. This stays within OSRS's own lighting rules - it's the same direction/contrast players
// and NPCs already use - and only changes this one-time bake, not ObjModelLoader's other callers.
//
// Scaled up by GROUND_ITEM_SCALE around the model's own origin for ARPG-style oversized loot; a
// ground model's origin sits at its base (OSRS convention, verified against the cache: e.g. arrows
// span y -4..0), so scaling about it keeps the item sitting on the floor rather than sinking into
// or floating above it.
function createGroundItemActorData(
    state: WorkerState,
    skinning: Skinning,
    groundItemDrops: readonly DroppableItemDisplay[],
): GroundItemActorData {
    const animationsByItemId = new Map<number, SkinAnimation>();
    for (const { itemId, displayCount } of groundItemDrops) {
        const unlit = state.objModelLoader.getUnlitModel(itemId, displayCount);
        if (!unlit) {
            throw new Error(`Ground item model is missing from the cache for item ${itemId}`);
        }
        const model = unlit.modelData.light(
            state.textureLoader,
            unlit.objType.ambient + 64,
            unlit.objType.contrast + CHARACTER_LIGHT_CONTRAST_BONUS,
            CHARACTER_LIGHT_DIRECTION.x,
            CHARACTER_LIGHT_DIRECTION.y,
            CHARACTER_LIGHT_DIRECTION.z,
        );
        model.scale(GROUND_ITEM_SCALE * 128, GROUND_ITEM_SCALE * 128, GROUND_ITEM_SCALE * 128);
        animationsByItemId.set(itemId, skinning.addStatic(model));
    }
    return { animationsByItemId };
}

// Neither the lever nor the chest loc animates itself in this cache (see the WORLD_OBJECT_BAKES
// comment), so each is baked as two static rest meshes - one per WorldObjectVariant - and the
// renderer swaps which one it draws.
function bakeWorldObjectLoc(
    locTypeLoader: LocTypeLoader,
    locModelLoader: LocModelLoader,
    skinning: Skinning,
    locId: number,
): SkinAnimation {
    const locType = locTypeLoader.load(locId);
    const rest = locModelLoader.getRestModel(locType, LocModelType.NORMAL, 0);
    if (!rest) {
        throw new Error(`World object loc model is missing from the cache for loc ${locId}`);
    }
    return skinning.addStatic(rest.model);
}

function createLocModelLoader(state: WorkerState, locTypeLoader: LocTypeLoader): LocModelLoader {
    return new LocModelLoader(
        locTypeLoader,
        state.cacheLoaderFactory.getModelLoader(),
        state.textureLoader,
        state.seqTypeLoader,
        state.seqFrameLoader,
        state.cacheLoaderFactory.getSkeletalSeqLoader(),
    );
}

function createWorldObjectActorData(
    state: WorkerState,
    skinning: Skinning,
    kinds: readonly WorldObjectKind[],
): WorldObjectActorData {
    const locTypeLoader = state.cacheLoaderFactory.getLocTypeLoader();
    const locModelLoader = createLocModelLoader(state, locTypeLoader);
    const meshesByKind = new Map<WorldObjectKind, WorldObjectMeshes>();
    for (const kind of kinds) {
        const bake = WORLD_OBJECT_BAKES[kind];
        meshesByKind.set(kind, {
            rest: bakeWorldObjectLoc(locTypeLoader, locModelLoader, skinning, bake.restLocId),
            activated: bakeWorldObjectLoc(
                locTypeLoader,
                locModelLoader,
                skinning,
                bake.activatedLocId,
            ),
        });
    }
    return { meshesByKind };
}

// Each piece is baked turned the way the map square would place it, so the renderer draws it
// unrotated at its tile.
function createCollapsedFloorActorData(
    state: WorkerState,
    skinning: Skinning,
    pieces: readonly WardenP3VoidPiece[],
): CollapsedFloorActorData {
    const locTypeLoader = state.cacheLoaderFactory.getLocTypeLoader();
    const locModelLoader = createLocModelLoader(state, locTypeLoader);
    const animationsByPiece = new Map<WardenP3VoidPieceKey, SkinAnimation>();
    for (const piece of pieces) {
        const rest = locModelLoader.getRestModel(
            locTypeLoader.load(piece.loc),
            LocModelType.FLOOR_DECORATION,
            piece.rotation,
        );
        if (!rest) {
            throw new Error(
                `Collapsed floor loc model is missing from the cache for loc ${piece.loc}`,
            );
        }
        animationsByPiece.set(wardenP3VoidPieceKey(piece), skinning.addStatic(rest.model));
    }
    return { animationsByPiece };
}

function createEnemyTypeAnimationSet(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
    assets: EnemyTypeAssets,
): EnemyTypeAnimationSet {
    const npcType = npcTypeLoader.load(assets.npcTypeId);
    const rest = npcModelLoader.getRestModel(npcType);
    if (!rest) {
        throw new Error(`Enemy model is missing for enemy type ${assets.enemyTypeId}`);
    }
    return skinning.addAnimationSet(
        rest.model,
        requireSeqs(skinning, assets.seqIds),
        rest.poseSpace,
    );
}

// The animation viewer's preview enemy: bakes the npc's own idle/walk seqs plus every seq in the
// requested range, so stepping through the range never needs a fresh actor buffer load. A range
// can hold seqs of other npcs, and one rig poses only seqs of its idle's kind and skeleton, so the
// others are reported instead of baked.
function createPreviewNpcBake(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
    preview: Extract<PreviewAssets, { kind: "NPC_SEQS" }>,
): { readonly animations: EnemyTypeAnimationSet; readonly bake: PreviewNpcBake } {
    const npcType = npcTypeLoader.load(preview.npcTypeId);
    const seqIds = new Set<number>([npcType.idleSeqId, npcType.walkSeqId, ...preview.seqIds]);
    const rest = npcModelLoader.getRestModel(npcType);
    if (!rest) {
        throw new Error(`Preview NPC model is missing for ${preview.npcTypeId}`);
    }
    const seqs = requireSeqs(skinning, [...seqIds]);
    const idleRig = poseRigKey(skinning.requireSeq(npcType.idleSeqId));
    const posedSeqs = seqs.filter((seq) => samePoseRig(poseRigKey(seq), idleRig));
    const unposedSeqs = new Map(
        seqs
            .filter((seq) => !samePoseRig(poseRigKey(seq), idleRig))
            .map((seq) => [
                seq.seqId,
                `uses ${describePoseRig(poseRigKey(seq))}, idle ${
                    npcType.idleSeqId
                } uses ${describePoseRig(idleRig)}`,
            ]),
    );
    return {
        animations: skinning.addAnimationSet(rest.model, posedSeqs, rest.poseSpace),
        bake: { unposedSeqs },
    };
}

function requireSeqs(skinning: Skinning, seqIds: readonly number[]): PoseableSeq[] {
    return seqIds.map((seqId) => skinning.requireSeq(seqId));
}

function requireSpotAnimTypeLoader(state: WorkerState): SpotAnimTypeLoader {
    const spotAnimTypeLoader = state.cacheLoaderFactory.getSpotAnimTypeLoader();
    if (!spotAnimTypeLoader) {
        throw new Error("Spot animations are not available in this cache");
    }
    return spotAnimTypeLoader;
}

// The animation viewer's gfx preview: bakes every spot anim id in the requested range, each into
// its own model + (when it has one) its own sequence, so stepping through the range never needs a
// fresh actor buffer load. An id with no model at all (spotAnim.modelId never decoded, since
// SpotAnimType leaves it as the TS-asserted-but-actually-undefined default) bakes to a bare
// { modelId: undefined } entry rather than being skipped, so the viewer's Info line can say
// "no model" instead of silently showing nothing.
function createPreviewGfxAnimationSet(
    state: WorkerState,
    skinning: Skinning,
    preview: Extract<PreviewAssets, { kind: "SPOT_ANIMS" }>,
): PreviewGfxAnimationSet {
    const modelLoader = state.cacheLoaderFactory.getModelLoader();
    const textureLoader = state.textureLoader;
    const spotAnimTypeLoader = requireSpotAnimTypeLoader(state);

    const bakesByGfxId = new Map<number, PreviewGfxBake>();
    for (const gfxId of preview.spotAnimIds) {
        const spotAnim = spotAnimTypeLoader.load(gfxId);
        if (typeof spotAnim.modelId !== "number") {
            bakesByGfxId.set(gfxId, {});
            continue;
        }
        const model = buildSpotAnimModel(modelLoader, textureLoader, spotAnim);
        if (!model) {
            bakesByGfxId.set(gfxId, { modelId: spotAnim.modelId });
            continue;
        }
        const seqId = spotAnim.sequenceId !== -1 ? spotAnim.sequenceId : undefined;
        const anim =
            seqId !== undefined ? skinning.addAnimation(model, seqId) : skinning.addStatic(model);
        bakesByGfxId.set(gfxId, { modelId: spotAnim.modelId, seqId, anim });
    }
    return { bakesByGfxId };
}

// Holds the loaders across the whole projectile/effect table, since the cache loader factory
// builds (and decodes) a fresh loader on every get*Loader call.
class ProjectileBaker {
    private readonly spotAnimTypeLoader: SpotAnimTypeLoader;
    private readonly modelLoader: ModelLoader;

    constructor(
        private readonly state: WorkerState,
        private readonly skinning: Skinning,
    ) {
        this.spotAnimTypeLoader = requireSpotAnimTypeLoader(state);
        this.modelLoader = state.cacheLoaderFactory.getModelLoader();
    }

    bakeProjectile(bake: ProjectileBake): SkinAnimation {
        switch (bake.kind) {
            case "SPOT_ANIM":
                return this.bakeSpotAnim(bake);
            case "ARROW_OBJ":
                return this.bakeArrowObj(bake);
        }
    }

    bakeSpotAnim(bake: SpotAnimBake): SkinAnimation {
        const spotAnim = this.spotAnimTypeLoader.load(bake.spotAnimId);
        const model = buildSpotAnimModel(this.modelLoader, this.state.textureLoader, spotAnim);
        if (!model) {
            throw new Error(`Spot animation ${bake.spotAnimId} model is missing from the cache`);
        }
        const expectedSeqId = bake.seq.kind === "ANIMATED" ? bake.seq.seqId : -1;
        if (spotAnim.sequenceId !== expectedSeqId) {
            throw new Error(
                `Spot animation ${bake.spotAnimId} plays sequence ${spotAnim.sequenceId}, expected ${expectedSeqId}`,
            );
        }
        if (bake.modelScale !== undefined) {
            model.scale(bake.modelScale, bake.modelScale, bake.modelScale);
        }
        return bake.seq.kind === "ANIMATED"
            ? this.skinning.addAnimation(model, bake.seq.seqId)
            : this.skinning.addStatic(model);
    }

    private bakeArrowObj(bake: ArrowObjBake): SkinAnimation {
        const objModel = this.state.objModelLoader.getModel(bake.objId, 1);
        if (!objModel) {
            throw new Error(
                `Arrow projectile model is missing from the cache for obj ${bake.objId}`,
            );
        }
        // The arrow model's tip points down -Z; projectiles fly along +Z before yaw, and pitch is
        // a rotation in that heading frame, so the model is turned to face +Z here rather than with
        // a yaw offset at draw time (which would invert the pitch).
        const model = Model.copy(objModel);
        model.rotate180();
        model.scale(bake.thicknessScale, bake.thicknessScale, bake.lengthScale);
        brightenModel(model, bake.lightnessBoost);
        return this.skinning.addStatic(model);
    }
}

// Object.entries keeps every key of the exhaustive Record, so the result is exhaustive too.
function mapRecord<K extends PropertyKey, V, R>(
    record: Readonly<Record<K, V>>,
    map: (value: V) => R,
): Record<K, R> {
    return Object.fromEntries(
        Object.entries<V>(record).map(([key, value]) => [key, map(value)]),
    ) as Record<K, R>;
}

function createProjectileActorData(
    state: WorkerState,
    skinning: Skinning,
    assets: ActorAssets,
): ProjectileActorData {
    const baker = new ProjectileBaker(state, skinning);
    return {
        projectileMeshes: mapRecord(assets.projectiles, (bake) => baker.bakeProjectile(bake)),
        effectAnimations: mapRecord(assets.effects, (bake) => baker.bakeSpotAnim(bake)),
    };
}

export class ActorRenderDataLoader implements RenderDataLoader<ActorLoaderInput, ActorBufferData> {
    __type = "actorRenderDataLoader" as const;

    init(): void {}

    async load(
        state: WorkerState,
        { encounterId, loadedTextureIds, preview }: ActorLoaderInput,
    ): Promise<RenderDataResult<ActorBufferData>> {
        console.time(`load actors ${encounterId}`);

        const textureLoader = state.textureLoader;
        const npcTypeLoader = state.npcTypeLoader;
        const npcModelLoader = state.npcModelLoader;

        const textureIdIndexMap = buildTextureIdIndexMap(textureLoader);
        const skinning = new Skinning(
            new SkinnedMeshBuilder(textureLoader, textureIdIndexMap),
            new SkinPaletteBuilder(),
            state.seqTypeLoader,
            state.seqFrameLoader,
            state.skeletalSeqLoader,
        );

        const playerModelLoader = new PlayerModelLoader(
            state.objTypeLoader,
            state.cacheLoaderFactory.getModelLoader(),
            textureLoader,
            state.seqTypeLoader,
            state.seqFrameLoader,
            state.skeletalSeqLoader,
        );
        const assets = actorAssets(getEncounter(encounterId), preview);
        const player = createPlayerActorData(
            playerModelLoader,
            npcTypeLoader,
            skinning,
            assets.player,
        );

        const enemyTypes: Partial<Record<EnemyTypeId, EnemyTypeAnimationSet>> = {};
        for (const enemyTypeAssets of assets.enemyTypes) {
            enemyTypes[enemyTypeAssets.enemyTypeId] = createEnemyTypeAnimationSet(
                npcModelLoader,
                npcTypeLoader,
                skinning,
                enemyTypeAssets,
            );
        }
        const previewNpc =
            assets.preview?.kind === "NPC_SEQS"
                ? createPreviewNpcBake(npcModelLoader, npcTypeLoader, skinning, assets.preview)
                : undefined;
        if (previewNpc) {
            enemyTypes[EnemyTypeId.PREVIEW] = previewNpc.animations;
        }
        const previewGfx =
            assets.preview?.kind === "SPOT_ANIMS"
                ? createPreviewGfxAnimationSet(state, skinning, assets.preview)
                : undefined;

        const projectiles = createProjectileActorData(state, skinning, assets);
        const groundItems = createGroundItemActorData(state, skinning, assets.groundItemDrops);
        const worldObjects = createWorldObjectActorData(state, skinning, assets.worldObjectKinds);
        const collapsedFloor = createCollapsedFloorActorData(
            state,
            skinning,
            assets.collapsedFloorPieces,
        );

        const { geometry: skinned, usedTextureIds } = skinning.build();

        const loadedTextures = new Map<number, Int32Array>();
        for (const textureId of usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) {}
            }
        }

        console.timeEnd(`load actors ${encounterId}`);

        const transferables = [
            ...skinnedGeometryTransferables(skinned),
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),
        ];

        return {
            data: {
                cacheName: state.cache.info.name,
                encounterId,

                skinned,

                actorData: {
                    player,
                    enemyTypes,
                    projectiles,
                    groundItems,
                    worldObjects,
                    collapsedFloor,
                    previewGfx,
                    previewNpc: previewNpc?.bake,
                },

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {}
}
