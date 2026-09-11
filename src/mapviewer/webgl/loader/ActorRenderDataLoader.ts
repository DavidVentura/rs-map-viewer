import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { Model } from "../../../rs/model/Model";
import { PoseSpace } from "../../../rs/model/animation/FramePalette";
import { WeaponStyle } from "../../game/Ability";
import { AnimPreviewParams } from "../../game/AnimPreview";
import { getEncounter } from "../../game/Encounter";
import { EnemyType, EnemyTypeId, getEnemyType } from "../../game/EnemyType";
import {
    ELDER_MAUL_ITEM_ID,
    EquipmentPath,
    allDroppableItemIds,
    secondaryPathForStyle,
    visualGroupItemIds,
    weaponVisualItemIds,
} from "../../game/Equipment";
import { StanceSeqIds, StanceSeqIdsByStance } from "../../game/Player";
import {
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    JAD_FIRE_SEQ_ID,
    JAD_RANGED_ROCK_SEQ_ID,
    KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    ProjectileKind,
} from "../../game/Projectile";
import {
    DUST_WAVE_SEQ_ID,
    FALLING_SHADOW_SEQ_ID,
    ICE_BARRAGE_HIT_SEQ_ID,
    MAUL_IMPACT_SPARK_SEQ_ID,
    TZHAAR_HEAL_SEQ_ID,
    VisualEffectKind,
} from "../../game/VisualEffect";
import { ICE_BARRAGE_CAST_SEQ_ID, MAUL_SMASH_CAST_SEQ_ID } from "../../game/abilities";
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
import { brightenModel, buildSpotAnimModel } from "./AnimationBaking";
import { buildTextureIdIndexMap } from "./TextureIndexMap";

// A switch animation plays while the OLD style's weapon is still equipped, so the "switch into
// magic/melee" and "drink potion" animations must be baked into every stance's animation set.
// The player death animation (Player.DEATH_SEQ_ID) plays regardless of the active style too.
const POTION_DRINK_SEQ_ID = 829;
const MAGIC_SWITCH_SEQ_ID = 7660; // imbued heart
const MELEE_SWITCH_SEQ_ID = 1056; // dragon battleaxe special
const CLEAVE_SEQ_ID = 1203; // crystal halberd special, melee only
const PLAYER_DEATH_SEQ_ID = 836;

type ExtraSeq = { readonly seqId: number };

const COMMON_EXTRA_SEQS: readonly ExtraSeq[] = [
    { seqId: POTION_DRINK_SEQ_ID },
    { seqId: MAGIC_SWITCH_SEQ_ID },
    { seqId: MELEE_SWITCH_SEQ_ID },
    { seqId: PLAYER_DEATH_SEQ_ID },
];

type StanceSeqConfig = StanceSeqIds & { extraSeqs: readonly ExtraSeq[] };

// bow: unarmed idle/walk/run, bow attack
// staff: standard spellcast idle/walk/run/attack, plus the ice barrage cast
// scimitar: unarmed idle/walk/run, slash attack
// Seq ids are fixed per style regardless of equipped tier; which item ids are actually worn for a
// given style/equipment/seq now comes from Equipment.equippedVisualItemIds, resolved separately
// per attachment instance rather than folded into one PlayerAppearance here (see
// createBodyAnimationSet / createItemAnimationSet / createPlayerActorData below).
const STANCE_SEQ_CONFIG: Record<WeaponStyle, StanceSeqConfig> = {
    [WeaponStyle.RANGED]: {
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: 426,
        extraSeqs: COMMON_EXTRA_SEQS,
    },
    [WeaponStyle.MAGIC]: {
        idleSeqId: 813,
        walkSeqId: 1146,
        runSeqId: 1210,
        attackSeqId: 711,
        extraSeqs: [...COMMON_EXTRA_SEQS, { seqId: ICE_BARRAGE_CAST_SEQ_ID }],
    },
    [WeaponStyle.MELEE]: {
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: 390,
        extraSeqs: [
            ...COMMON_EXTRA_SEQS,
            { seqId: CLEAVE_SEQ_ID },
            { seqId: MAUL_SMASH_CAST_SEQ_ID },
        ],
    },
};

const ALL_STYLES = [WeaponStyle.RANGED, WeaponStyle.MAGIC, WeaponStyle.MELEE] as const;

function allStanceSeqIds(seqConfig: StanceSeqConfig): number[] {
    return [
        ...new Set([
            seqConfig.idleSeqId,
            seqConfig.walkSeqId,
            seqConfig.runSeqId,
            seqConfig.attackSeqId,
            ...seqConfig.extraSeqs.map((extra) => extra.seqId),
        ]),
    ];
}

function createPlayerActorData(
    playerModelLoader: PlayerModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
): PlayerActorData {
    const baseNpc = npcTypeLoader.load(3105);
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
    const seqIdsByStyle = {} as Record<WeaponStyle, readonly number[]>;
    const itemIds = new Set<number>();
    for (const style of ALL_STYLES) {
        seqIdsByStyle[style] = allStanceSeqIds(STANCE_SEQ_CONFIG[style]);
        for (const itemId of weaponVisualItemIds(style)) {
            itemIds.add(itemId);
        }
        const secondaryPath = secondaryPathForStyle(style);
        if (secondaryPath) {
            for (const itemId of visualGroupItemIds(secondaryPath)) {
                itemIds.add(itemId);
            }
        }
    }

    for (const itemId of visualGroupItemIds(EquipmentPath.AMULET)) {
        itemIds.add(itemId);
    }
    itemIds.add(ELDER_MAUL_ITEM_ID);

    const itemModels = new Map<number, Model>();
    for (const itemId of itemIds) {
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
        itemModels.set(itemId, model);
    }
    const seqIds = [...new Set(ALL_STYLES.flatMap((style) => seqIdsByStyle[style]))];
    const itemEntries = [...itemModels];
    const rig = skinning.addRig(
        bodyOnlyModel,
        [
            { model: bodyOnlyModel, selection: SkinFaceSelection.all() },
            ...itemEntries.map(([, model]) => ({
                model,
                selection: SkinFaceSelection.startingAt(bodyFaceCount),
            })),
        ],
        new Map(seqIds.map((seqId) => [seqId, skinning.requireFrames(seqId)])),
        PoseSpace.identity(),
    );
    const [bodyMesh, ...itemMeshes] = rig.meshes;
    const itemsByItemId = new Map(
        itemEntries.map(([itemId], index) => [itemId, itemMeshes[index]]),
    );
    const stanceSeqIds = {} as StanceSeqIdsByStance;
    for (const style of ALL_STYLES) {
        stanceSeqIds[style] = STANCE_SEQ_CONFIG[style];
    }
    return {
        stanceSeqIds,
        body: { mesh: bodyMesh, animationsBySeqId: rig.animationsBySeqId },
        itemsByItemId,
    };
}

// Bakes every OSRS item that can ever appear as a ground drop (every tier above tier 0 across
// every equipment path; see Equipment.allDroppableItemIds) as a single static ground-lying frame,
// the same way createProjectileActorData bakes the arrow model.
function createGroundItemActorData(state: WorkerState, skinning: Skinning): GroundItemActorData {
    const objModelLoader = state.objModelLoader;
    const animationsByItemId = new Map<number, SkinAnimation>();
    for (const itemId of allDroppableItemIds()) {
        if (animationsByItemId.has(itemId)) {
            continue;
        }
        const model = objModelLoader.getModel(itemId, 1);
        if (!model) {
            throw new Error(`Ground item model is missing from the cache for item ${itemId}`);
        }
        animationsByItemId.set(itemId, skinning.addStatic(model));
    }
    return { animationsByItemId };
}

function enemyTypeSeqIds(enemyType: EnemyType): number[] {
    const seqIds = [
        enemyType.idleSeqId,
        enemyType.walkSeqId,
        enemyType.deathSeqId,
        enemyType.attackSeqId,
        enemyType.castSeqId,
        ...enemyType.abilities.map((ability) => ability.castSeqId),
    ];
    return [...new Set(seqIds.filter((seqId): seqId is number => seqId !== undefined))];
}

function createEnemyTypeAnimationSet(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
    enemyType: EnemyType,
): EnemyTypeAnimationSet {
    const npcType = npcTypeLoader.load(enemyType.npcTypeId);
    const rest = npcModelLoader.getRestModel(npcType);
    if (!rest) {
        throw new Error(`Enemy model is missing for enemy type ${enemyType.id}`);
    }
    return skinning.addAnimationSet(
        rest.model,
        requireAllFrames(skinning, enemyTypeSeqIds(enemyType)),
        rest.poseSpace,
    );
}

// The animation viewer's preview enemy: bakes the npc's own idle/walk seqs plus every seq in the
// requested range, so stepping through the range never needs a fresh actor buffer load.
function createPreviewEnemyTypeAnimationSet(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    skinning: Skinning,
    preview: Extract<AnimPreviewParams, { kind: "NPC_SEQS" }>,
): EnemyTypeAnimationSet {
    const npcType = npcTypeLoader.load(preview.npcTypeId);
    const seqIds = new Set<number>([npcType.idleSeqId, npcType.walkSeqId]);
    for (let seqId = preview.seqRange.from; seqId <= preview.seqRange.to; seqId++) {
        seqIds.add(seqId);
    }
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

// The animation viewer's gfx preview: bakes every spot anim id in the requested range, each into
// its own model + (when it has one) its own sequence, so stepping through the range never needs a
// fresh actor buffer load. An id with no model at all (spotAnim.modelId never decoded, since
// SpotAnimType leaves it as the TS-asserted-but-actually-undefined default) bakes to a bare
// { modelId: undefined } entry rather than being skipped, so the viewer's Info line can say
// "no model" instead of silently showing nothing.
function createPreviewGfxAnimationSet(
    state: WorkerState,
    skinning: Skinning,
    preview: Extract<AnimPreviewParams, { kind: "SPOT_ANIMS" }>,
): PreviewGfxAnimationSet {
    const modelLoader = state.cacheLoaderFactory.getModelLoader();
    const textureLoader = state.textureLoader;
    const seqTypeLoader = state.seqTypeLoader;
    const spotAnimTypeLoader = state.cacheLoaderFactory.getSpotAnimTypeLoader();
    if (!spotAnimTypeLoader) {
        throw new Error("Spot animations are not available in this cache");
    }

    const bakesByGfxId = new Map<number, PreviewGfxBake>();
    for (let gfxId = preview.range.from; gfxId <= preview.range.to; gfxId++) {
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

// Fire Bolt spell (SpotAnimType ids): 127 travels, 128 hits.
const FIRE_BOLT_PROJECTILE_SPOTANIM_ID = 127;
const FIRE_BOLT_HIT_SPOTANIM_ID = 128;

// Ice Barrage hit graphic (SpotAnimType id): 369.
const ICE_BARRAGE_HIT_SPOTANIM_ID = 369;

// TzTok-Jad's own fire graphic (SpotAnimType ids): 449 travels, 450 hits, both driven by the same
// sequence (JAD_FIRE_SEQ_ID) rather than the player's fire bolt spell graphic (127/128).
const JAD_FIRE_PROJECTILE_SPOTANIM_ID = 449;
const JAD_FIRE_HIT_SPOTANIM_ID = 450;

// TzTok-Jad's ranged attack graphic (SpotAnimType id): 451, a falling boulder.
const JAD_RANGED_ROCK_SPOTANIM_ID = 451;

// TzHaar healer heal graphic (SpotAnimType id): 444.
const TZHAAR_HEAL_SPOTANIM_ID = 444;

// Zebak's roar dust wave (SpotAnimType id): 2184, driven by seq 9647 (DUST_WAVE_SEQ_ID).
const DUST_WAVE_SPOTANIM_ID = 2184;
// Elder maul special impact (SpotAnimType id): 2805, driven by seq 11126.
const MAUL_IMPACT_SPARK_SPOTANIM_ID = 2805;

// Grotesque Guardians' falling debris shadow (SpotAnimType id): 1446, driven by seq 7816
// (FALLING_SHADOW_SEQ_ID).
const FALLING_SHADOW_SPOTANIM_ID = 1446;

// Tok-Xil's ranged shot (SpotAnimType id): 443, a static spike model without a sequence.
const TOK_XIL_SHOT_SPOTANIM_ID = 443;

// Ket-Zek's fire blast (SpotAnimType id): 445, the graphic whose sequence follows Ket-Zek's own
// animation block. It has no impact graphic.
const KET_ZEK_FIRE_BLAST_TRAVEL_SPOTANIM_ID = 445;

// A visually distinct, larger arrow model for the ranged Power Shot special.
const POWER_SHOT_MODEL_SCALE = 200;
const ARROW_LENGTH_SCALE = 160;
const ARROW_THICKNESS_SCALE = 380;
const ARROW_LIGHTNESS_BOOST = 45;

// TzTok-Jad's mage blast graphic is scaled up (Model.scale divides by 128, so this is 3x) so the
// slow-moving projectile reads as a bigger, boss-scale attack.
const JAD_MAGE_BLAST_MODEL_SCALE = 128 * 3;

function createProjectileActorData(state: WorkerState, skinning: Skinning): ProjectileActorData {
    const objModelLoader = state.objModelLoader;
    const modelLoader = state.cacheLoaderFactory.getModelLoader();
    const textureLoader = state.textureLoader;
    const spotAnimTypeLoader = state.cacheLoaderFactory.getSpotAnimTypeLoader();

    const arrowModel = objModelLoader.getModel(882, 1);
    if (!arrowModel) {
        throw new Error("Arrow projectile model is missing from the cache");
    }
    if (!spotAnimTypeLoader) {
        throw new Error("Spot animations are not available in this cache");
    }
    // The arrow model's tip points down -Z; projectiles fly along +Z before yaw, and pitch is a
    // rotation in that heading frame, so the model is turned to face +Z here rather than with a
    // yaw offset at draw time (which would invert the pitch).
    const visibleArrowModel = Model.copy(arrowModel);
    visibleArrowModel.rotate180();
    visibleArrowModel.scale(ARROW_THICKNESS_SCALE, ARROW_THICKNESS_SCALE, ARROW_LENGTH_SCALE);
    brightenModel(visibleArrowModel, ARROW_LIGHTNESS_BOOST);
    const arrowAnim = skinning.addStatic(visibleArrowModel);

    const powerShotModel = Model.copy(arrowModel);
    powerShotModel.rotate180();
    powerShotModel.scale(
        ARROW_THICKNESS_SCALE * 2,
        ARROW_THICKNESS_SCALE * 2,
        POWER_SHOT_MODEL_SCALE,
    );
    brightenModel(powerShotModel, ARROW_LIGHTNESS_BOOST);
    const powerShotAnim = skinning.addStatic(powerShotModel);

    const boltSpotAnim = spotAnimTypeLoader.load(FIRE_BOLT_PROJECTILE_SPOTANIM_ID);
    const boltModel = buildSpotAnimModel(modelLoader, textureLoader, boltSpotAnim);
    if (!boltModel || boltSpotAnim.sequenceId !== FIRE_BOLT_TRAVEL_SEQ_ID) {
        throw new Error("Fire bolt projectile spot animation does not match the expected sequence");
    }
    const boltAnim = skinning.addAnimation(boltModel, FIRE_BOLT_TRAVEL_SEQ_ID);

    const jadFireSpotAnim = spotAnimTypeLoader.load(JAD_FIRE_PROJECTILE_SPOTANIM_ID);
    const jadFireModel = buildSpotAnimModel(modelLoader, textureLoader, jadFireSpotAnim);
    if (!jadFireModel || jadFireSpotAnim.sequenceId !== JAD_FIRE_SEQ_ID) {
        throw new Error(
            "TzTok-Jad fire projectile spot animation does not match the expected sequence",
        );
    }
    jadFireModel.scale(
        JAD_MAGE_BLAST_MODEL_SCALE,
        JAD_MAGE_BLAST_MODEL_SCALE,
        JAD_MAGE_BLAST_MODEL_SCALE,
    );
    const jadFireAnim = skinning.addAnimation(jadFireModel, JAD_FIRE_SEQ_ID);

    const jadFireHitSpotAnim = spotAnimTypeLoader.load(JAD_FIRE_HIT_SPOTANIM_ID);
    const jadFireHitModel = buildSpotAnimModel(modelLoader, textureLoader, jadFireHitSpotAnim);
    if (!jadFireHitModel || jadFireHitSpotAnim.sequenceId !== JAD_FIRE_SEQ_ID) {
        throw new Error("TzTok-Jad fire hit spot animation does not match the expected sequence");
    }
    const jadFireHitAnim = skinning.addAnimation(jadFireHitModel, JAD_FIRE_SEQ_ID);

    const jadRockSpotAnim = spotAnimTypeLoader.load(JAD_RANGED_ROCK_SPOTANIM_ID);
    const jadRockModel = buildSpotAnimModel(modelLoader, textureLoader, jadRockSpotAnim);
    if (!jadRockModel || jadRockSpotAnim.sequenceId !== JAD_RANGED_ROCK_SEQ_ID) {
        throw new Error(
            "TzTok-Jad ranged attack spot animation does not match the expected sequence",
        );
    }
    const jadRockAnim = skinning.addAnimation(jadRockModel, JAD_RANGED_ROCK_SEQ_ID);

    const tzhaarHealSpotAnim = spotAnimTypeLoader.load(TZHAAR_HEAL_SPOTANIM_ID);
    const tzhaarHealModel = buildSpotAnimModel(modelLoader, textureLoader, tzhaarHealSpotAnim);
    if (!tzhaarHealModel || tzhaarHealSpotAnim.sequenceId !== TZHAAR_HEAL_SEQ_ID) {
        throw new Error("TzHaar heal spot animation does not match the expected sequence");
    }
    const tzhaarHealAnim = skinning.addAnimation(tzhaarHealModel, TZHAAR_HEAL_SEQ_ID);

    const boltHitSpotAnim = spotAnimTypeLoader.load(FIRE_BOLT_HIT_SPOTANIM_ID);
    const boltHitModel = buildSpotAnimModel(modelLoader, textureLoader, boltHitSpotAnim);
    if (!boltHitModel || boltHitSpotAnim.sequenceId !== FIRE_BOLT_HIT_SEQ_ID) {
        throw new Error("Fire bolt hit spot animation does not match the expected sequence");
    }
    const boltHitAnim = skinning.addAnimation(boltHitModel, FIRE_BOLT_HIT_SEQ_ID);

    const iceBarrageSpotAnim = spotAnimTypeLoader.load(ICE_BARRAGE_HIT_SPOTANIM_ID);
    const iceBarrageModel = buildSpotAnimModel(modelLoader, textureLoader, iceBarrageSpotAnim);
    if (!iceBarrageModel || iceBarrageSpotAnim.sequenceId !== ICE_BARRAGE_HIT_SEQ_ID) {
        throw new Error("Ice barrage hit spot animation does not match the expected sequence");
    }
    const iceBarrageAnim = skinning.addAnimation(iceBarrageModel, ICE_BARRAGE_HIT_SEQ_ID);

    const dustWaveSpotAnim = spotAnimTypeLoader.load(DUST_WAVE_SPOTANIM_ID);
    const dustWaveModel = buildSpotAnimModel(modelLoader, textureLoader, dustWaveSpotAnim);
    if (!dustWaveModel || dustWaveSpotAnim.sequenceId !== DUST_WAVE_SEQ_ID) {
        throw new Error("Dust wave spot animation does not match the expected sequence");
    }
    const dustWaveAnim = skinning.addAnimation(dustWaveModel, DUST_WAVE_SEQ_ID);

    const maulSparkSpotAnim = spotAnimTypeLoader.load(MAUL_IMPACT_SPARK_SPOTANIM_ID);
    const maulSparkModel = buildSpotAnimModel(modelLoader, textureLoader, maulSparkSpotAnim);
    if (!maulSparkModel || maulSparkSpotAnim.sequenceId !== MAUL_IMPACT_SPARK_SEQ_ID) {
        throw new Error("Maul impact spark spot animation does not match the expected sequence");
    }
    const maulSparkAnim = skinning.addAnimation(maulSparkModel, MAUL_IMPACT_SPARK_SEQ_ID);

    const fallingShadowSpotAnim = spotAnimTypeLoader.load(FALLING_SHADOW_SPOTANIM_ID);
    const fallingShadowModel = buildSpotAnimModel(
        modelLoader,
        textureLoader,
        fallingShadowSpotAnim,
    );
    if (!fallingShadowModel || fallingShadowSpotAnim.sequenceId !== FALLING_SHADOW_SEQ_ID) {
        throw new Error("Falling shadow spot animation does not match the expected sequence");
    }
    const fallingShadowAnim = skinning.addAnimation(fallingShadowModel, FALLING_SHADOW_SEQ_ID);

    const tokXilShotSpotAnim = spotAnimTypeLoader.load(TOK_XIL_SHOT_SPOTANIM_ID);
    const tokXilShotModel = buildSpotAnimModel(modelLoader, textureLoader, tokXilShotSpotAnim);
    if (!tokXilShotModel || tokXilShotSpotAnim.sequenceId !== -1) {
        throw new Error("Tok-Xil shot spot animation is expected to be a static model");
    }
    const tokXilShotAnim = skinning.addStatic(tokXilShotModel);

    const ketZekBlastSpotAnim = spotAnimTypeLoader.load(KET_ZEK_FIRE_BLAST_TRAVEL_SPOTANIM_ID);
    const ketZekBlastModel = buildSpotAnimModel(modelLoader, textureLoader, ketZekBlastSpotAnim);
    if (!ketZekBlastModel || ketZekBlastSpotAnim.sequenceId !== KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID) {
        throw new Error("Ket-Zek fire blast spot animation does not match the expected sequence");
    }
    const ketZekBlastAnim = skinning.addAnimation(
        ketZekBlastModel,
        KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    );

    return {
        projectileMeshes: {
            [ProjectileKind.ARROW]: arrowAnim,
            [ProjectileKind.MAGIC]: boltAnim,
            [ProjectileKind.POWER_SHOT]: powerShotAnim,
            [ProjectileKind.JAD_MAGE_BLAST]: jadFireAnim,
            [ProjectileKind.JAD_RANGED_ROCK]: jadRockAnim,
            [ProjectileKind.TOK_XIL_SHOT]: tokXilShotAnim,
            [ProjectileKind.KET_ZEK_FIRE_BLAST]: ketZekBlastAnim,
        },
        effectAnimations: {
            [VisualEffectKind.MAGIC_HIT]: boltHitAnim,
            [VisualEffectKind.ICE_BARRAGE_HIT]: iceBarrageAnim,
            [VisualEffectKind.JAD_FIRE_HIT]: jadFireHitAnim,
            [VisualEffectKind.TZHAAR_HEAL]: tzhaarHealAnim,
            [VisualEffectKind.DUST_WAVE]: dustWaveAnim,
            [VisualEffectKind.MAUL_IMPACT_SPARK]: maulSparkAnim,
            [VisualEffectKind.FALLING_SHADOW]: fallingShadowAnim,
        },
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
        const player = createPlayerActorData(playerModelLoader, npcTypeLoader, skinning);

        const encounter = getEncounter(encounterId);
        const enemyTypes: Partial<Record<EnemyTypeId, EnemyTypeAnimationSet>> = {};
        for (const enemyTypeId of encounter.enemyTypeIds) {
            if (enemyTypeId === EnemyTypeId.PREVIEW) {
                continue;
            }
            const enemyType = getEnemyType(enemyTypeId);
            enemyTypes[enemyTypeId] = createEnemyTypeAnimationSet(
                npcModelLoader,
                npcTypeLoader,
                skinning,
                enemyType,
            );
        }
        if (preview?.kind === "NPC_SEQS") {
            enemyTypes[EnemyTypeId.PREVIEW] = createPreviewEnemyTypeAnimationSet(
                npcModelLoader,
                npcTypeLoader,
                skinning,
                preview,
            );
        }
        const previewGfx =
            preview?.kind === "SPOT_ANIMS"
                ? createPreviewGfxAnimationSet(state, skinning, preview)
                : undefined;

        const projectiles = createProjectileActorData(state, skinning);
        const groundItems = createGroundItemActorData(state, skinning);

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
