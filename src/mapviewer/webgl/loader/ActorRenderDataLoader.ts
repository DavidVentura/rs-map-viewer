import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { SpotAnimTypeLoader } from "../../../rs/config/spotanimtype/SpotAnimTypeLoader";
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
    actorAssets,
} from "../../assets/ActorAssets";
import { getEncounter } from "../../game/Encounter";
import { EnemyTypeId } from "../../game/EnemyType";
import { PlayerAppearance, PlayerGender } from "../../player/PlayerAppearance";
import { PlayerModelLoader } from "../../player/PlayerModelLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import {
    EnemyTypeAnimationSet,
    GroundItemActorData,
    PlayerActorData,
    PreviewGfxAnimationSet,
    PreviewGfxBake,
    ProjectileActorData,
} from "../actor/ActorRenderData";
import { SkinAnimation } from "../skin/SkinAnimation";
import { SkinPaletteBuilder } from "../skin/SkinPaletteBuilder";
import { SkinFaceSelection, SkinnedMeshBuilder } from "../skin/SkinnedMeshBuilder";
import { SkinSeqFrames, Skinning, skinnedGeometryTransferables } from "../skin/Skinning";
import { ActorBufferData } from "./ActorBufferData";
import { ActorLoaderInput } from "./ActorLoaderInput";
import { brightenModel, buildSpotAnimModel } from "./ActorModels";
import { buildTextureIdIndexMap } from "./TextureIndexMap";

function createPlayerActorData(
    playerModelLoader: PlayerModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
    assets: PlayerAssets,
): PlayerActorData {
    const baseNpc = npcTypeLoader.load(assets.baseNpcTypeId);
    const bodyOnlyAppearance = new PlayerAppearance(
        baseNpc.modelIds,
        [],
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );
    const bodyOnlyModel = playerModelLoader.getModel(bodyOnlyAppearance, -1, -1);
    if (!bodyOnlyModel) {
        throw new Error("Player body model is missing from the cache");
    }
    const bodyFaceCount = bodyOnlyModel.faceCount;

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
        bodyOnlyModel,
        [
            { model: bodyOnlyModel, selection: SkinFaceSelection.all() },
            ...itemEntries.map(([, model]) => ({
                model,
                selection: SkinFaceSelection.startingAt(bodyFaceCount),
            })),
        ],
        requireAllFrames(skinning, assets.seqIds),
        PoseSpace.identity(),
    );
    const [bodyMesh, ...itemMeshes] = rig.meshes;
    const itemsByItemId = new Map(
        itemEntries.map(([itemId], index) => [itemId, itemMeshes[index]]),
    );
    return {
        stanceSeqIds: assets.stanceSeqIds,
        body: { mesh: bodyMesh, animationsBySeqId: rig.animationsBySeqId },
        itemsByItemId,
    };
}

// Bakes every OSRS item that can ever appear as a ground drop as a single static ground-lying
// frame, the same way ProjectileBaker bakes the arrow model.
function createGroundItemActorData(
    state: WorkerState,
    skinning: Skinning,
    groundItemIds: readonly number[],
): GroundItemActorData {
    const animationsByItemId = new Map<number, SkinAnimation>();
    for (const itemId of groundItemIds) {
        const model = state.objModelLoader.getModel(itemId, 1);
        if (!model) {
            throw new Error(`Ground item model is missing from the cache for item ${itemId}`);
        }
        animationsByItemId.set(itemId, skinning.addStatic(model));
    }
    return { animationsByItemId };
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
        requireAllFrames(skinning, assets.seqIds),
        rest.poseSpace,
    );
}

// The animation viewer's preview enemy: bakes the npc's own idle/walk seqs plus every seq in the
// requested range, so stepping through the range never needs a fresh actor buffer load.
function createPreviewEnemyTypeAnimationSet(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
    preview: Extract<PreviewAssets, { kind: "NPC_SEQS" }>,
): EnemyTypeAnimationSet {
    const npcType = npcTypeLoader.load(preview.npcTypeId);
    const seqIds = new Set<number>([npcType.idleSeqId, npcType.walkSeqId, ...preview.seqIds]);
    const rest = npcModelLoader.getRestModel(npcType);
    if (!rest) {
        throw new Error(`Preview NPC model is missing for ${preview.npcTypeId}`);
    }
    return skinning.addAnimationSet(
        rest.model,
        requireAllFrames(skinning, [...seqIds]),
        rest.poseSpace,
    );
}

function requireAllFrames(
    skinning: Skinning,
    seqIds: readonly number[],
): ReadonlyMap<number, SkinSeqFrames> {
    return new Map(seqIds.map((seqId) => [seqId, skinning.requireFrames(seqId)]));
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
    const seqTypeLoader = state.seqTypeLoader;
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
        // Newer spot anims use skeletal sequences with no old-style frames, which this baker
        // can't pose; the viewer shows their rest model (the Info line reports 0 frames) rather
        // than one such id in the range aborting the whole actor buffer load.
        const hasFrames =
            seqId !== undefined && (seqTypeLoader.load(seqId).frameIds?.length ?? 0) > 0;
        const anim = hasFrames ? skinning.addAnimation(model, seqId!) : skinning.addStatic(model);
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
        if (assets.preview?.kind === "NPC_SEQS") {
            enemyTypes[EnemyTypeId.PREVIEW] = createPreviewEnemyTypeAnimationSet(
                npcModelLoader,
                npcTypeLoader,
                skinning,
                assets.preview,
            );
        }
        const previewGfx =
            assets.preview?.kind === "SPOT_ANIMS"
                ? createPreviewGfxAnimationSet(state, skinning, assets.preview)
                : undefined;

        const projectiles = createProjectileActorData(state, skinning, assets);
        const groundItems = createGroundItemActorData(state, skinning, assets.groundItemIds);

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

                actorData: { player, enemyTypes, projectiles, groundItems, previewGfx },

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {}
}
