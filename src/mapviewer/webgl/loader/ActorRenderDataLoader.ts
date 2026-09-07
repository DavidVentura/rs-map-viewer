import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../../rs/config/npctype/NpcType";
import { Model } from "../../../rs/model/Model";
import { WeaponStyle } from "../../game/Ability";
import { getEncounter } from "../../game/Encounter";
import { EnemyType, EnemyTypeId, getEnemyType } from "../../game/EnemyType";
import {
    StanceVisualKey,
    allDroppableItemIds,
    stanceAppearanceItemIds,
    stanceVisualVariants,
} from "../../game/Equipment";
import { StanceSeqIds } from "../../game/Player";
import {
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    ProjectileKind,
} from "../../game/Projectile";
import { ICE_BARRAGE_HIT_SEQ_ID, VisualEffectKind } from "../../game/VisualEffect";
import { ICE_BARRAGE_CAST_SEQ_ID, MAUL_SMASH_CAST_SEQ_ID } from "../../game/abilities";
import { PlayerAppearance, PlayerGender } from "../../player/PlayerAppearance";
import { PlayerModelLoader } from "../../player/PlayerModelLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import {
    EnemyTypeAnimationSet,
    GroundItemActorData,
    PlayerActorData,
    ProjectileActorData,
    StanceAnimationSet,
} from "../actor/ActorRenderData";
import { SceneBuffer } from "../buffer/SceneBuffer";
import { ActorBufferData } from "./ActorBufferData";
import { ActorLoaderInput, PreviewAnimInput } from "./ActorLoaderInput";
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
const ELDER_MAUL_ITEM_ID = 21003; // maul smash special, baked with the elder maul instead of the scimitar

// A stance's extra (non-movement) animations are baked with the stance's own weapon equipped by
// default; itemId overrides that for a single seq, e.g. a special attack that needs its own weapon.
type ExtraSeq = { readonly seqId: number; readonly itemId?: number };

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
// Seq ids are fixed per style regardless of equipped tier; the equipped item ids used to build the
// PlayerAppearance for a given bake now come from Equipment.stanceAppearanceItemIds instead of a
// single hardcoded itemId here (see createStanceAnimationSet / createPlayerActorData below).
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
            { seqId: MAUL_SMASH_CAST_SEQ_ID, itemId: ELDER_MAUL_ITEM_ID },
        ],
    },
};

// Bakes one full stance (idle/walk/run/attack/specials) for one equipment combination. Called once
// per visual variant a style has (see Equipment.stanceVisualVariants): the weapon path bakes one
// variant per raw tier (recolored per tier), while the secondary paths (defender/offhand/amulet)
// still collapse to 2 groups each since only their top tier's model actually differs (see the
// comment on Equipment.secondaryVisualGroup).
function createStanceAnimationSet(
    playerModelLoader: PlayerModelLoader,
    sceneBuf: SceneBuffer,
    baseNpc: NpcType,
    seqConfig: StanceSeqConfig,
    appearanceItemIds: readonly number[],
): StanceAnimationSet | undefined {
    const appearance = new PlayerAppearance(
        baseNpc.modelIds,
        appearanceItemIds,
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );

    const seqIds = [
        seqConfig.idleSeqId,
        seqConfig.walkSeqId,
        seqConfig.runSeqId,
        seqConfig.attackSeqId,
    ];

    const animationsBySeqId = new Map<number, AnimationFrames>();
    for (const seqId of seqIds) {
        if (animationsBySeqId.has(seqId)) {
            continue;
        }
        const anim = addPlayerAnimationFrames(playerModelLoader, sceneBuf, appearance, seqId);
        if (!anim) {
            return undefined;
        }
        animationsBySeqId.set(seqId, anim);
    }

    for (const extra of seqConfig.extraSeqs) {
        if (animationsBySeqId.has(extra.seqId)) {
            continue;
        }
        const extraAppearance =
            extra.itemId === undefined
                ? appearance
                : new PlayerAppearance(
                      baseNpc.modelIds,
                      [extra.itemId],
                      PlayerGender.MALE,
                      baseNpc.ambient,
                      baseNpc.contrast,
                  );
        const anim = addPlayerAnimationFrames(
            playerModelLoader,
            sceneBuf,
            extraAppearance,
            extra.seqId,
        );
        if (!anim) {
            return undefined;
        }
        animationsBySeqId.set(extra.seqId, anim);
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

function createPlayerActorData(
    playerModelLoader: PlayerModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    sceneBuf: SceneBuffer,
): PlayerActorData | undefined {
    const baseNpc = npcTypeLoader.load(3105);

    const stanceVariants = new Map<StanceVisualKey, StanceAnimationSet>();
    const defaultStanceKeyByStyle = {} as Record<WeaponStyle, StanceVisualKey>;
    for (const style of [WeaponStyle.RANGED, WeaponStyle.MAGIC, WeaponStyle.MELEE] as const) {
        const seqConfig = STANCE_SEQ_CONFIG[style];
        const variants = stanceVisualVariants(style);
        defaultStanceKeyByStyle[style] = variants[0].key;
        for (const variant of variants) {
            if (stanceVariants.has(variant.key)) {
                continue;
            }
            const appearanceItemIds = stanceAppearanceItemIds(style, variant.equipment);
            const set = createStanceAnimationSet(
                playerModelLoader,
                sceneBuf,
                baseNpc,
                seqConfig,
                appearanceItemIds,
            );
            if (!set) {
                return undefined;
            }
            stanceVariants.set(variant.key, set);
        }
    }

    return { stanceVariants, defaultStanceKeyByStyle };
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
    preview: PreviewAnimInput,
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

// Fire Bolt spell (SpotAnimType ids): 127 travels, 128 hits.
const FIRE_BOLT_PROJECTILE_SPOTANIM_ID = 127;
const FIRE_BOLT_HIT_SPOTANIM_ID = 128;

// Ice Barrage hit graphic (SpotAnimType id): 369.
const ICE_BARRAGE_HIT_SPOTANIM_ID = 369;

// A visually distinct, larger arrow model for the ranged Power Shot special.
const POWER_SHOT_MODEL_SCALE = 200;
const ARROW_LENGTH_SCALE = 160;
const ARROW_THICKNESS_SCALE = 380;
const ARROW_LIGHTNESS_BOOST = 45;

// TzTok-Jad's mage blast reuses the fire bolt spot animation, scaled up (Model.scale divides by
// 128, so this is 3x) so the slow-moving projectile reads as a bigger, boss-scale attack.
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
    const visibleArrowModel = Model.copy(arrowModel);
    visibleArrowModel.scale(ARROW_THICKNESS_SCALE, ARROW_THICKNESS_SCALE, ARROW_LENGTH_SCALE);
    brightenModel(visibleArrowModel, ARROW_LIGHTNESS_BOOST);
    const arrowAnim = addStaticModelAnimationFrames(sceneBuf, visibleArrowModel);

    const powerShotModel = Model.copy(arrowModel);
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

    const jadBoltModel = buildSpotAnimModel(modelLoader, textureLoader, boltSpotAnim);
    if (!jadBoltModel) {
        throw new Error("Fire bolt projectile spot animation does not match the expected sequence");
    }
    jadBoltModel.scale(
        JAD_MAGE_BLAST_MODEL_SCALE,
        JAD_MAGE_BLAST_MODEL_SCALE,
        JAD_MAGE_BLAST_MODEL_SCALE,
    );
    const jadBoltAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        jadBoltModel,
        FIRE_BOLT_TRAVEL_SEQ_ID,
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

    return {
        projectileMeshes: {
            [ProjectileKind.ARROW]: { anim: arrowAnim, rotationOffset: 1024 },
            [ProjectileKind.MAGIC]: { anim: boltAnim, rotationOffset: 0 },
            [ProjectileKind.POWER_SHOT]: { anim: powerShotAnim, rotationOffset: 1024 },
            [ProjectileKind.JAD_MAGE_BLAST]: { anim: jadBoltAnim, rotationOffset: 0 },
        },
        effectAnimations: {
            [VisualEffectKind.MAGIC_HIT]: boltHitAnim,
            [VisualEffectKind.ICE_BARRAGE_HIT]: iceBarrageAnim,
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
        if (preview) {
            enemyTypes[EnemyTypeId.PREVIEW] = createPreviewEnemyTypeAnimationSet(
                npcModelLoader,
                npcTypeLoader,
                sceneBuf,
                preview,
            );
        }

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

                actorData: { player, enemyTypes, projectiles, groundItems },

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {}
}
