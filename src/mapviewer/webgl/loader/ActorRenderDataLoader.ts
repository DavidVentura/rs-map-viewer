import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../../rs/config/npctype/NpcType";
import { Model } from "../../../rs/model/Model";
import { WeaponStyle } from "../../game/Ability";
import { AnimPreviewParams } from "../../game/AnimPreview";
import { getEncounter } from "../../game/Encounter";
import { EnemyType, EnemyTypeId, getEnemyType } from "../../game/EnemyType";
import {
    ELDER_MAUL_ITEM_ID,
    EquipmentPath,
    allDroppableItemIds,
    attachmentVisibleSeqIds,
    secondaryPathForStyle,
    visualGroupItemIds,
    weaponVisualItemIds,
} from "../../game/Equipment";
import { StanceSeqIds } from "../../game/Player";
import {
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    JAD_FIRE_SEQ_ID,
    JAD_RANGED_ROCK_SEQ_ID,
    KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    ProjectileKind,
} from "../../game/Projectile";
import {
    ICE_BARRAGE_HIT_SEQ_ID,
    MAUL_SMASH_HIT_SEQ_ID,
    TZHAAR_HEAL_SEQ_ID,
    VisualEffectKind,
} from "../../game/VisualEffect";
import { ICE_BARRAGE_CAST_SEQ_ID, MAUL_SMASH_CAST_SEQ_ID } from "../../game/abilities";
import { PlayerAppearance, PlayerGender } from "../../player/PlayerAppearance";
import { PlayerModelLoader } from "../../player/PlayerModelLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import {
    EnemyTypeAnimationSet,
    GroundItemActorData,
    ItemAnimationSet,
    PlayerActorData,
    PreviewGfxAnimationSet,
    PreviewGfxBake,
    ProjectileActorData,
    StanceAnimationSet,
} from "../actor/ActorRenderData";
import { SceneBuffer } from "../buffer/SceneBuffer";
import { ActorBufferData } from "./ActorBufferData";
import { ActorLoaderInput } from "./ActorLoaderInput";
import {
    addNpcAnimationFrames,
    addPlayerAnimationFrames,
    addSpotAnimAnimationFrames,
    addStaticModelAnimationFrames,
    brightenModel,
    buildSpotAnimModel,
} from "./AnimationBaking";
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

// Bakes one style's body (idle/walk/run/attack/specials), with no equipment: the body model never
// changes with what's equipped, so it only needs baking once per style rather than once per
// equipment combination.
function createBodyAnimationSet(
    playerModelLoader: PlayerModelLoader,
    sceneBuf: SceneBuffer,
    baseNpc: NpcType,
    seqConfig: StanceSeqConfig,
): StanceAnimationSet | undefined {
    const appearance = new PlayerAppearance(
        baseNpc.modelIds,
        [],
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );

    const animationsBySeqId = new Map<number, AnimationFrames>();
    for (const seqId of allStanceSeqIds(seqConfig)) {
        const anim = addPlayerAnimationFrames(playerModelLoader, sceneBuf, appearance, seqId);
        if (!anim) {
            return undefined;
        }
        animationsBySeqId.set(seqId, anim);
    }

    return {
        idleSeqId: seqConfig.idleSeqId,
        walkSeqId: seqConfig.walkSeqId,
        runSeqId: seqConfig.runSeqId,
        attackSeqId: seqConfig.attackSeqId,
        idleAnim: animationsBySeqId.get(seqConfig.idleSeqId)!,
        animationsBySeqId,
    };
}

// Bakes one equipped item's own worn model, posed at every requested seq id. The item is merged
// with the body (baseNpc.modelIds) before posing - a lone item model's vertex labels don't include
// the parent bone groups the body carries, so animating it alone yields the wrong pose (verified
// with scripts/cache/verify-item-attach-throwaway.ts: worst-case vertex delta of ~400 units on a
// scimitar's attack swing). Only the item's own faces (everything from bodyFaceCount onward, since
// ModelData.merge appends faces in source-model order) are written to the scene buffer, so the
// body geometry itself is never duplicated into an item's baked mesh.
function createItemAnimationSet(
    playerModelLoader: PlayerModelLoader,
    sceneBuf: SceneBuffer,
    baseNpc: NpcType,
    bodyFaceCount: number,
    itemId: number,
    seqIds: readonly number[],
): ItemAnimationSet | undefined {
    const appearance = new PlayerAppearance(
        baseNpc.modelIds,
        [itemId],
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );

    const animationsBySeqId = new Map<number, AnimationFrames>();
    for (const seqId of seqIds) {
        if (animationsBySeqId.has(seqId)) {
            continue;
        }
        const anim = addPlayerAnimationFrames(
            playerModelLoader,
            sceneBuf,
            appearance,
            seqId,
            bodyFaceCount,
        );
        if (!anim) {
            return undefined;
        }
        animationsBySeqId.set(seqId, anim);
    }

    const idleSeqId = seqIds[0];
    return {
        idleSeqId,
        idleAnim: animationsBySeqId.get(idleSeqId)!,
        animationsBySeqId,
    };
}

function createPlayerActorData(
    playerModelLoader: PlayerModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    sceneBuf: SceneBuffer,
): PlayerActorData | undefined {
    const baseNpc = npcTypeLoader.load(3105);

    const bodyByStyle = {} as Record<WeaponStyle, StanceAnimationSet>;
    const seqIdsByStyle = {} as Record<WeaponStyle, readonly number[]>;
    for (const style of ALL_STYLES) {
        const seqConfig = STANCE_SEQ_CONFIG[style];
        const body = createBodyAnimationSet(playerModelLoader, sceneBuf, baseNpc, seqConfig);
        if (!body) {
            return undefined;
        }
        bodyByStyle[style] = body;
        seqIdsByStyle[style] = allStanceSeqIds(seqConfig);
    }

    const bodyOnlyAppearance = new PlayerAppearance(
        baseNpc.modelIds,
        [],
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );
    const bodyOnlyModel = playerModelLoader.getModel(bodyOnlyAppearance, -1, -1);
    if (!bodyOnlyModel) {
        return undefined;
    }
    const bodyFaceCount = bodyOnlyModel.faceCount;

    const itemsByItemId = new Map<number, ItemAnimationSet>();
    const ensureItem = (itemId: number, seqIds: readonly number[]): boolean => {
        if (itemsByItemId.has(itemId)) {
            return true;
        }
        const set = createItemAnimationSet(
            playerModelLoader,
            sceneBuf,
            baseNpc,
            bodyFaceCount,
            itemId,
            seqIds,
        );
        if (!set) {
            return false;
        }
        itemsByItemId.set(itemId, set);
        return true;
    };

    for (const style of ALL_STYLES) {
        const visibleSeqIds = attachmentVisibleSeqIds(seqIdsByStyle[style]);
        for (const itemId of weaponVisualItemIds(style)) {
            if (!ensureItem(itemId, visibleSeqIds)) {
                return undefined;
            }
        }
        const secondaryPath = secondaryPathForStyle(style);
        if (secondaryPath) {
            for (const itemId of visualGroupItemIds(secondaryPath)) {
                if (!ensureItem(itemId, visibleSeqIds)) {
                    return undefined;
                }
            }
        }
    }

    const amuletSeqIds = attachmentVisibleSeqIds([
        ...new Set(ALL_STYLES.flatMap((style) => seqIdsByStyle[style])),
    ]);
    for (const itemId of visualGroupItemIds(EquipmentPath.AMULET)) {
        if (!ensureItem(itemId, amuletSeqIds)) {
            return undefined;
        }
    }

    if (!ensureItem(ELDER_MAUL_ITEM_ID, [MAUL_SMASH_CAST_SEQ_ID])) {
        return undefined;
    }

    return { bodyByStyle, itemsByItemId };
}

// Bakes every OSRS item that can ever appear as a ground drop (every tier above tier 0 across
// every equipment path; see Equipment.allDroppableItemIds) as a single static ground-lying frame,
// the same way createProjectileActorData bakes the arrow model.
function createGroundItemActorData(state: WorkerState, sceneBuf: SceneBuffer): GroundItemActorData {
    const objModelLoader = state.objModelLoader;
    const animationsByItemId = new Map<number, AnimationFrames>();
    for (const itemId of allDroppableItemIds()) {
        if (animationsByItemId.has(itemId)) {
            continue;
        }
        const model = objModelLoader.getModel(itemId, 1);
        if (!model) {
            throw new Error(`Ground item model is missing from the cache for item ${itemId}`);
        }
        animationsByItemId.set(itemId, addStaticModelAnimationFrames(sceneBuf, model));
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
    sceneBuf: SceneBuffer,
    enemyType: EnemyType,
): EnemyTypeAnimationSet {
    const npcType = npcTypeLoader.load(enemyType.npcTypeId);
    const animationsBySeqId = new Map<number, AnimationFrames>();
    for (const seqId of enemyTypeSeqIds(enemyType)) {
        const anim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, seqId);
        if (!anim) {
            throw new Error(`Failed baking seq ${seqId} for enemy type ${enemyType.id}`);
        }
        animationsBySeqId.set(seqId, anim);
    }
    return { idleAnim: animationsBySeqId.get(enemyType.idleSeqId)!, animationsBySeqId };
}

// The animation viewer's preview enemy: bakes the npc's own idle/walk seqs plus every seq in the
// requested range, so stepping through the range never needs a fresh actor buffer load.
function createPreviewEnemyTypeAnimationSet(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    sceneBuf: SceneBuffer,
    preview: Extract<AnimPreviewParams, { kind: "NPC_SEQS" }>,
): EnemyTypeAnimationSet {
    const npcType = npcTypeLoader.load(preview.npcTypeId);
    const seqIds = new Set<number>([npcType.idleSeqId, npcType.walkSeqId]);
    for (let seqId = preview.seqRange.from; seqId <= preview.seqRange.to; seqId++) {
        seqIds.add(seqId);
    }
    const animationsBySeqId = new Map<number, AnimationFrames>();
    for (const seqId of seqIds) {
        const anim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, seqId);
        if (!anim) {
            throw new Error(`Failed baking seq ${seqId} for preview npc ${preview.npcTypeId}`);
        }
        animationsBySeqId.set(seqId, anim);
    }
    return { idleAnim: animationsBySeqId.get(npcType.idleSeqId)!, animationsBySeqId };
}

// The animation viewer's gfx preview: bakes every spot anim id in the requested range, each into
// its own model + (when it has one) its own sequence, so stepping through the range never needs a
// fresh actor buffer load. An id with no model at all (spotAnim.modelId never decoded, since
// SpotAnimType leaves it as the TS-asserted-but-actually-undefined default) bakes to a bare
// { modelId: undefined } entry rather than being skipped, so the viewer's Info line can say
// "no model" instead of silently showing nothing.
function createPreviewGfxAnimationSet(
    state: WorkerState,
    sceneBuf: SceneBuffer,
    preview: Extract<AnimPreviewParams, { kind: "SPOT_ANIMS" }>,
): PreviewGfxAnimationSet {
    const modelLoader = state.cacheLoaderFactory.getModelLoader();
    const textureLoader = state.textureLoader;
    const seqTypeLoader = state.seqTypeLoader;
    const seqFrameLoader = state.seqFrameLoader;
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
        const anim =
            seqId !== undefined
                ? addSpotAnimAnimationFrames(sceneBuf, seqTypeLoader, seqFrameLoader, model, seqId)
                : addStaticModelAnimationFrames(sceneBuf, model);
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

// Elder maul special impact graphic (SpotAnimType id): 2804, found by scanning the cache for spot
// animations driven by a sequence in the same block as the maul's own cast seq (11124) - this one
// uses seq 11125 (MAUL_SMASH_HIT_SEQ_ID), immediately after it.
const MAUL_SMASH_HIT_SPOTANIM_ID = 2804;

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

function createProjectileActorData(state: WorkerState, sceneBuf: SceneBuffer): ProjectileActorData {
    const objModelLoader = state.objModelLoader;
    const modelLoader = state.cacheLoaderFactory.getModelLoader();
    const textureLoader = state.textureLoader;
    const seqTypeLoader = state.seqTypeLoader;
    const seqFrameLoader = state.seqFrameLoader;
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
    const arrowAnim = addStaticModelAnimationFrames(sceneBuf, visibleArrowModel);

    const powerShotModel = Model.copy(arrowModel);
    powerShotModel.rotate180();
    powerShotModel.scale(
        ARROW_THICKNESS_SCALE * 2,
        ARROW_THICKNESS_SCALE * 2,
        POWER_SHOT_MODEL_SCALE,
    );
    brightenModel(powerShotModel, ARROW_LIGHTNESS_BOOST);
    const powerShotAnim = addStaticModelAnimationFrames(sceneBuf, powerShotModel);

    const boltSpotAnim = spotAnimTypeLoader.load(FIRE_BOLT_PROJECTILE_SPOTANIM_ID);
    const boltModel = buildSpotAnimModel(modelLoader, textureLoader, boltSpotAnim);
    if (!boltModel || boltSpotAnim.sequenceId !== FIRE_BOLT_TRAVEL_SEQ_ID) {
        throw new Error("Fire bolt projectile spot animation does not match the expected sequence");
    }
    const boltAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        boltModel,
        FIRE_BOLT_TRAVEL_SEQ_ID,
    );

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
    const jadFireAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        jadFireModel,
        JAD_FIRE_SEQ_ID,
    );

    const jadFireHitSpotAnim = spotAnimTypeLoader.load(JAD_FIRE_HIT_SPOTANIM_ID);
    const jadFireHitModel = buildSpotAnimModel(modelLoader, textureLoader, jadFireHitSpotAnim);
    if (!jadFireHitModel || jadFireHitSpotAnim.sequenceId !== JAD_FIRE_SEQ_ID) {
        throw new Error("TzTok-Jad fire hit spot animation does not match the expected sequence");
    }
    const jadFireHitAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        jadFireHitModel,
        JAD_FIRE_SEQ_ID,
    );

    const jadRockSpotAnim = spotAnimTypeLoader.load(JAD_RANGED_ROCK_SPOTANIM_ID);
    const jadRockModel = buildSpotAnimModel(modelLoader, textureLoader, jadRockSpotAnim);
    if (!jadRockModel || jadRockSpotAnim.sequenceId !== JAD_RANGED_ROCK_SEQ_ID) {
        throw new Error(
            "TzTok-Jad ranged attack spot animation does not match the expected sequence",
        );
    }
    const jadRockAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        jadRockModel,
        JAD_RANGED_ROCK_SEQ_ID,
    );

    const tzhaarHealSpotAnim = spotAnimTypeLoader.load(TZHAAR_HEAL_SPOTANIM_ID);
    const tzhaarHealModel = buildSpotAnimModel(modelLoader, textureLoader, tzhaarHealSpotAnim);
    if (!tzhaarHealModel || tzhaarHealSpotAnim.sequenceId !== TZHAAR_HEAL_SEQ_ID) {
        throw new Error("TzHaar heal spot animation does not match the expected sequence");
    }
    const tzhaarHealAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        tzhaarHealModel,
        TZHAAR_HEAL_SEQ_ID,
    );

    const boltHitSpotAnim = spotAnimTypeLoader.load(FIRE_BOLT_HIT_SPOTANIM_ID);
    const boltHitModel = buildSpotAnimModel(modelLoader, textureLoader, boltHitSpotAnim);
    if (!boltHitModel || boltHitSpotAnim.sequenceId !== FIRE_BOLT_HIT_SEQ_ID) {
        throw new Error("Fire bolt hit spot animation does not match the expected sequence");
    }
    const boltHitAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        boltHitModel,
        FIRE_BOLT_HIT_SEQ_ID,
    );

    const iceBarrageSpotAnim = spotAnimTypeLoader.load(ICE_BARRAGE_HIT_SPOTANIM_ID);
    const iceBarrageModel = buildSpotAnimModel(modelLoader, textureLoader, iceBarrageSpotAnim);
    if (!iceBarrageModel || iceBarrageSpotAnim.sequenceId !== ICE_BARRAGE_HIT_SEQ_ID) {
        throw new Error("Ice barrage hit spot animation does not match the expected sequence");
    }
    const iceBarrageAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        iceBarrageModel,
        ICE_BARRAGE_HIT_SEQ_ID,
    );

    const maulSmashHitSpotAnim = spotAnimTypeLoader.load(MAUL_SMASH_HIT_SPOTANIM_ID);
    const maulSmashHitModel = buildSpotAnimModel(modelLoader, textureLoader, maulSmashHitSpotAnim);
    if (!maulSmashHitModel || maulSmashHitSpotAnim.sequenceId !== MAUL_SMASH_HIT_SEQ_ID) {
        throw new Error("Maul smash hit spot animation does not match the expected sequence");
    }
    const maulSmashHitAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        maulSmashHitModel,
        MAUL_SMASH_HIT_SEQ_ID,
    );

    const tokXilShotSpotAnim = spotAnimTypeLoader.load(TOK_XIL_SHOT_SPOTANIM_ID);
    const tokXilShotModel = buildSpotAnimModel(modelLoader, textureLoader, tokXilShotSpotAnim);
    if (!tokXilShotModel || tokXilShotSpotAnim.sequenceId !== -1) {
        throw new Error("Tok-Xil shot spot animation is expected to be a static model");
    }
    const tokXilShotAnim = addStaticModelAnimationFrames(sceneBuf, tokXilShotModel);

    const ketZekBlastSpotAnim = spotAnimTypeLoader.load(KET_ZEK_FIRE_BLAST_TRAVEL_SPOTANIM_ID);
    const ketZekBlastModel = buildSpotAnimModel(modelLoader, textureLoader, ketZekBlastSpotAnim);
    if (!ketZekBlastModel || ketZekBlastSpotAnim.sequenceId !== KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID) {
        throw new Error("Ket-Zek fire blast spot animation does not match the expected sequence");
    }
    const ketZekBlastAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
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
            [VisualEffectKind.MAUL_SMASH_HIT]: maulSmashHitAnim,
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
        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 20000);

        const playerModelLoader = new PlayerModelLoader(
            state.objTypeLoader,
            state.cacheLoaderFactory.getModelLoader(),
            textureLoader,
            state.seqTypeLoader,
            state.seqFrameLoader,
            state.skeletalSeqLoader,
        );
        const player = createPlayerActorData(playerModelLoader, npcTypeLoader, sceneBuf);
        if (!player) {
            throw new Error("Failed baking player actor animation data");
        }

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
                sceneBuf,
                enemyType,
            );
        }
        if (preview?.kind === "NPC_SEQS") {
            enemyTypes[EnemyTypeId.PREVIEW] = createPreviewEnemyTypeAnimationSet(
                npcModelLoader,
                npcTypeLoader,
                sceneBuf,
                preview,
            );
        }
        const previewGfx =
            preview?.kind === "SPOT_ANIMS"
                ? createPreviewGfxAnimationSet(state, sceneBuf, preview)
                : undefined;

        const projectiles = createProjectileActorData(state, sceneBuf);
        const groundItems = createGroundItemActorData(state, sceneBuf);

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);

        const loadedTextures = new Map<number, Int32Array>();
        for (const textureId of sceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) {}
            }
        }

        console.timeEnd(`load actors ${encounterId}`);

        const transferables = [
            vertices.buffer,
            indices.buffer,
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),
        ];

        return {
            data: {
                cacheName: state.cache.info.name,
                encounterId,

                vertices,
                indices,

                actorData: { player, enemyTypes, projectiles, groundItems, previewGfx },

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {}
}
