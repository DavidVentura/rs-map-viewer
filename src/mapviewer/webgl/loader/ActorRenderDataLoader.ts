import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../../rs/config/npctype/NpcType";
import { Model } from "../../../rs/model/Model";
import { WeaponStyle } from "../../game/Ability";
import { getEncounter } from "../../game/Encounter";
import { EnemyType, EnemyTypeId, getEnemyType } from "../../game/EnemyType";
import { StanceSeqIds } from "../../game/Player";
import {
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    ProjectileKind,
} from "../../game/Projectile";
import { ICE_BARRAGE_HIT_SEQ_ID, VisualEffectKind } from "../../game/VisualEffect";
import { ICE_BARRAGE_CAST_SEQ_ID } from "../../game/abilities";
import { PlayerAppearance, PlayerGender } from "../../player/PlayerAppearance";
import { PlayerModelLoader } from "../../player/PlayerModelLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import {
    EnemyTypeAnimationSet,
    PlayerActorData,
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

const COMMON_EXTRA_SEQ_IDS = [
    POTION_DRINK_SEQ_ID,
    MAGIC_SWITCH_SEQ_ID,
    MELEE_SWITCH_SEQ_ID,
    PLAYER_DEATH_SEQ_ID,
];

type StanceEquipment = StanceSeqIds & { itemId: number; extraSeqIds: readonly number[] };

// bow: shortbow, unarmed idle/walk/run, bow attack
// staff: staff of fire, standard spellcast idle/walk/run/attack, plus the ice barrage cast
// scimitar: rune scimitar, unarmed idle/walk/run, slash attack
const STANCE_EQUIPMENT: Record<WeaponStyle, StanceEquipment> = {
    [WeaponStyle.RANGED]: {
        itemId: 841,
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: 426,
        extraSeqIds: COMMON_EXTRA_SEQ_IDS,
    },
    [WeaponStyle.MAGIC]: {
        itemId: 1387,
        idleSeqId: 813,
        walkSeqId: 1146,
        runSeqId: 1210,
        attackSeqId: 711,
        extraSeqIds: [...COMMON_EXTRA_SEQ_IDS, ICE_BARRAGE_CAST_SEQ_ID],
    },
    [WeaponStyle.MELEE]: {
        itemId: 1333,
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: 390,
        extraSeqIds: [...COMMON_EXTRA_SEQ_IDS, CLEAVE_SEQ_ID],
    },
};

function createStanceAnimationSet(
    playerModelLoader: PlayerModelLoader,
    sceneBuf: SceneBuffer,
    baseNpc: NpcType,
    equipment: StanceEquipment,
): StanceAnimationSet | undefined {
    const appearance = new PlayerAppearance(
        baseNpc.modelIds,
        [equipment.itemId],
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );

    const seqIds = [
        equipment.idleSeqId,
        equipment.walkSeqId,
        equipment.runSeqId,
        equipment.attackSeqId,
        ...equipment.extraSeqIds,
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

    return {
        idleSeqId: equipment.idleSeqId,
        walkSeqId: equipment.walkSeqId,
        runSeqId: equipment.runSeqId,
        attackSeqId: equipment.attackSeqId,
        idleAnim: animationsBySeqId.get(equipment.idleSeqId)!,
        animationsBySeqId,
    };
}

function createPlayerActorData(
    playerModelLoader: PlayerModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    sceneBuf: SceneBuffer,
): PlayerActorData | undefined {
    const baseNpc = npcTypeLoader.load(3105);

    const stances: Partial<Record<WeaponStyle, StanceAnimationSet>> = {};
    for (const style of [WeaponStyle.RANGED, WeaponStyle.MAGIC, WeaponStyle.MELEE] as const) {
        const equipment = STANCE_EQUIPMENT[style];
        const set = createStanceAnimationSet(playerModelLoader, sceneBuf, baseNpc, equipment);
        if (!set) {
            return undefined;
        }
        stances[style] = set;
    }

    return { stances: stances as Record<WeaponStyle, StanceAnimationSet> };
}

function createEnemyTypeAnimationSet(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: WorkerState["npcTypeLoader"],
    sceneBuf: SceneBuffer,
    enemyType: EnemyType,
): EnemyTypeAnimationSet | undefined {
    const npcType = npcTypeLoader.load(enemyType.npcTypeId);

    const idleAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, enemyType.idleSeqId);
    const walkAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, enemyType.walkSeqId);
    const deathAnim = addNpcAnimationFrames(
        npcModelLoader,
        sceneBuf,
        npcType,
        enemyType.deathSeqId,
    );
    const attackAnim = addNpcAnimationFrames(
        npcModelLoader,
        sceneBuf,
        npcType,
        enemyType.attackSeqId,
    );
    if (!idleAnim || !walkAnim || !deathAnim || !attackAnim) {
        return undefined;
    }

    return {
        idleAnim,
        walkAnim,
        deathAnim,
        attackAnim,
        idleSeqId: enemyType.idleSeqId,
        walkSeqId: enemyType.walkSeqId,
        deathSeqId: enemyType.deathSeqId,
        attackSeqId: enemyType.attackSeqId,
    };
}

// Fire Bolt spell (SpotAnimType ids): 127 travels, 128 hits.
const FIRE_BOLT_PROJECTILE_SPOTANIM_ID = 127;
const FIRE_BOLT_HIT_SPOTANIM_ID = 128;

// Ice Barrage hit graphic (SpotAnimType id): 369.
const ICE_BARRAGE_HIT_SPOTANIM_ID = 369;

// A visually distinct, larger arrow model for the ranged Power Shot special.
const POWER_SHOT_MODEL_SCALE = 200;

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
    const arrowAnim = addStaticModelAnimationFrames(sceneBuf, arrowModel);

    const powerShotModel = Model.copy(arrowModel);
    powerShotModel.scale(POWER_SHOT_MODEL_SCALE, POWER_SHOT_MODEL_SCALE, POWER_SHOT_MODEL_SCALE);
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
        { encounterId, loadedTextureIds }: ActorLoaderInput,
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
            const enemyType = getEnemyType(enemyTypeId);
            const animSet = createEnemyTypeAnimationSet(
                npcModelLoader,
                npcTypeLoader,
                sceneBuf,
                enemyType,
            );
            if (!animSet) {
                throw new Error(`Failed baking enemy actor animation data for ${enemyTypeId}`);
            }
            enemyTypes[enemyTypeId] = animSet;
        }

        const projectiles = createProjectileActorData(state, sceneBuf);

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

                actorData: { player, enemyTypes, projectiles },

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {}
}
