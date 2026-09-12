import { WeaponStyle } from "../game/Ability";
import { AnimPreviewParams, SeqRange } from "../game/AnimPreview";
import { Encounter } from "../game/Encounter";
import { EnemyType, EnemyTypeId, getEnemyType } from "../game/EnemyType";
import {
    ELDER_MAUL_ITEM_ID,
    EquipmentPath,
    allDroppableItemIds,
    secondaryPathForStyle,
    visualGroupItemIds,
    weaponVisualItemIds,
} from "../game/Equipment";
import { Player, StanceSeqIds, StanceSeqIdsByStance } from "../game/Player";
import {
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    JAD_FIRE_SEQ_ID,
    JAD_RANGED_ROCK_SEQ_ID,
    KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    ProjectileKind,
} from "../game/Projectile";
import {
    DUST_WAVE_SEQ_ID,
    FALLING_SHADOW_SEQ_ID,
    ICE_BARRAGE_HIT_SEQ_ID,
    MAUL_IMPACT_SPARK_SEQ_ID,
    TZHAAR_HEAL_SEQ_ID,
    VisualEffectKind,
} from "../game/VisualEffect";
import {
    BOW_SHOT_CAST_SEQ_ID,
    CLEAVE_CAST_SEQ_ID,
    HEALING_POTION_CAST_SEQ_ID,
    ICE_BARRAGE_CAST_SEQ_ID,
    MAGIC_BOLT_CAST_SEQ_ID,
    MAUL_SMASH_CAST_SEQ_ID,
    SCIMITAR_SLASH_CAST_SEQ_ID,
} from "../game/abilities";

const PLAYER_BASE_NPC_TYPE_ID = 3105;

// A switch animation plays while the OLD style's weapon is still equipped, so the "switch into
// magic/melee" and "drink potion" animations must be baked into every stance's animation set.
// The player death animation (Player.DEATH_SEQ_ID) plays regardless of the active style too.
const MAGIC_SWITCH_SEQ_ID = 7660; // imbued heart
const MELEE_SWITCH_SEQ_ID = 1056; // dragon battleaxe special

const COMMON_EXTRA_SEQ_IDS: readonly number[] = [
    HEALING_POTION_CAST_SEQ_ID,
    MAGIC_SWITCH_SEQ_ID,
    MELEE_SWITCH_SEQ_ID,
    Player.DEATH_SEQ_ID,
];

type StanceSeqConfig = StanceSeqIds & { readonly extraSeqIds: readonly number[] };

// bow: unarmed idle/walk/run, bow attack
// staff: standard spellcast idle/walk/run/attack, plus the ice barrage cast
// scimitar: unarmed idle/walk/run, slash attack
// Seq ids are fixed per style regardless of equipped tier; which item ids are actually worn for a
// given style/equipment/seq now comes from Equipment.equippedVisualItemIds, resolved separately
// per attachment instance rather than folded into one PlayerAppearance here (see
// ActorRenderDataLoader's createPlayerActorData).
const STANCE_SEQ_CONFIG: Record<WeaponStyle, StanceSeqConfig> = {
    [WeaponStyle.RANGED]: {
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: BOW_SHOT_CAST_SEQ_ID,
        extraSeqIds: COMMON_EXTRA_SEQ_IDS,
    },
    [WeaponStyle.MAGIC]: {
        idleSeqId: 813,
        walkSeqId: 1146,
        runSeqId: 1210,
        attackSeqId: MAGIC_BOLT_CAST_SEQ_ID,
        extraSeqIds: [...COMMON_EXTRA_SEQ_IDS, ICE_BARRAGE_CAST_SEQ_ID],
    },
    [WeaponStyle.MELEE]: {
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: SCIMITAR_SLASH_CAST_SEQ_ID,
        extraSeqIds: [...COMMON_EXTRA_SEQ_IDS, CLEAVE_CAST_SEQ_ID, MAUL_SMASH_CAST_SEQ_ID],
    },
};

const ALL_STYLES = [WeaponStyle.RANGED, WeaponStyle.MAGIC, WeaponStyle.MELEE] as const;

// A spot anim's own sequence as the cache must have it: the game plays these seq ids on the baked
// model, so a spot anim pointing at any other sequence would animate the wrong frames.
export type SpotAnimSeq =
    | { readonly kind: "ANIMATED"; readonly seqId: number }
    | { readonly kind: "STATIC" };

export type SpotAnimBake = {
    readonly kind: "SPOT_ANIM";
    readonly spotAnimId: number;
    readonly seq: SpotAnimSeq;
    readonly modelScale?: number;
};

// An obj model turned nose-forward and stretched into a projectile (see ActorRenderDataLoader's
// ProjectileBaker for the orientation).
export type ArrowObjBake = {
    readonly kind: "ARROW_OBJ";
    readonly objId: number;
    readonly thicknessScale: number;
    readonly lengthScale: number;
    readonly lightnessBoost: number;
};

export type ProjectileBake = SpotAnimBake | ArrowObjBake;

function animatedSpotAnim(spotAnimId: number, seqId: number, modelScale?: number): SpotAnimBake {
    return { kind: "SPOT_ANIM", spotAnimId, seq: { kind: "ANIMATED", seqId }, modelScale };
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

// Bronze arrow, the model every arrow projectile flies with regardless of the equipped arrow tier.
const ARROW_OBJ_ID = 882;

// A visually distinct, larger arrow model for the ranged Power Shot special.
const POWER_SHOT_MODEL_SCALE = 200;
const ARROW_LENGTH_SCALE = 160;
const ARROW_THICKNESS_SCALE = 380;
const ARROW_LIGHTNESS_BOOST = 45;

// TzTok-Jad's mage blast graphic is scaled up (Model.scale divides by 128, so this is 3x) so the
// slow-moving projectile reads as a bigger, boss-scale attack.
const JAD_MAGE_BLAST_MODEL_SCALE = 128 * 3;

export const PROJECTILE_BAKES: Readonly<Record<ProjectileKind, ProjectileBake>> = {
    [ProjectileKind.ARROW]: {
        kind: "ARROW_OBJ",
        objId: ARROW_OBJ_ID,
        thicknessScale: ARROW_THICKNESS_SCALE,
        lengthScale: ARROW_LENGTH_SCALE,
        lightnessBoost: ARROW_LIGHTNESS_BOOST,
    },
    [ProjectileKind.MAGIC]: animatedSpotAnim(
        FIRE_BOLT_PROJECTILE_SPOTANIM_ID,
        FIRE_BOLT_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.POWER_SHOT]: {
        kind: "ARROW_OBJ",
        objId: ARROW_OBJ_ID,
        thicknessScale: ARROW_THICKNESS_SCALE * 2,
        lengthScale: POWER_SHOT_MODEL_SCALE,
        lightnessBoost: ARROW_LIGHTNESS_BOOST,
    },
    [ProjectileKind.JAD_MAGE_BLAST]: animatedSpotAnim(
        JAD_FIRE_PROJECTILE_SPOTANIM_ID,
        JAD_FIRE_SEQ_ID,
        JAD_MAGE_BLAST_MODEL_SCALE,
    ),
    [ProjectileKind.JAD_RANGED_ROCK]: animatedSpotAnim(
        JAD_RANGED_ROCK_SPOTANIM_ID,
        JAD_RANGED_ROCK_SEQ_ID,
    ),
    [ProjectileKind.TOK_XIL_SHOT]: {
        kind: "SPOT_ANIM",
        spotAnimId: TOK_XIL_SHOT_SPOTANIM_ID,
        seq: { kind: "STATIC" },
    },
    [ProjectileKind.KET_ZEK_FIRE_BLAST]: animatedSpotAnim(
        KET_ZEK_FIRE_BLAST_TRAVEL_SPOTANIM_ID,
        KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    ),
};

export const EFFECT_BAKES: Readonly<Record<VisualEffectKind, SpotAnimBake>> = {
    [VisualEffectKind.MAGIC_HIT]: animatedSpotAnim(FIRE_BOLT_HIT_SPOTANIM_ID, FIRE_BOLT_HIT_SEQ_ID),
    [VisualEffectKind.ICE_BARRAGE_HIT]: animatedSpotAnim(
        ICE_BARRAGE_HIT_SPOTANIM_ID,
        ICE_BARRAGE_HIT_SEQ_ID,
    ),
    [VisualEffectKind.JAD_FIRE_HIT]: animatedSpotAnim(JAD_FIRE_HIT_SPOTANIM_ID, JAD_FIRE_SEQ_ID),
    [VisualEffectKind.TZHAAR_HEAL]: animatedSpotAnim(TZHAAR_HEAL_SPOTANIM_ID, TZHAAR_HEAL_SEQ_ID),
    [VisualEffectKind.DUST_WAVE]: animatedSpotAnim(DUST_WAVE_SPOTANIM_ID, DUST_WAVE_SEQ_ID),
    [VisualEffectKind.MAUL_IMPACT_SPARK]: animatedSpotAnim(
        MAUL_IMPACT_SPARK_SPOTANIM_ID,
        MAUL_IMPACT_SPARK_SEQ_ID,
    ),
    [VisualEffectKind.FALLING_SHADOW]: animatedSpotAnim(
        FALLING_SHADOW_SPOTANIM_ID,
        FALLING_SHADOW_SEQ_ID,
    ),
};

export type PlayerAssets = {
    readonly baseNpcTypeId: number;
    readonly stanceSeqIds: StanceSeqIdsByStance;
    // Every seq the body rig is posed with, across all styles.
    readonly seqIds: readonly number[];
    readonly attachmentItemIds: readonly number[];
};

export type StaticEnemyTypeId = Exclude<EnemyTypeId, EnemyTypeId.PREVIEW>;

export type EnemyTypeAssets = {
    readonly enemyTypeId: StaticEnemyTypeId;
    readonly npcTypeId: number;
    readonly seqIds: readonly number[];
};

// The animation viewer's bakes, expanded from its id ranges so stepping through a range never
// needs a fresh actor buffer load. The preview npc's own idle/walk seqs come from its npc type.
export type PreviewAssets =
    | { readonly kind: "NPC_SEQS"; readonly npcTypeId: number; readonly seqIds: readonly number[] }
    | { readonly kind: "SPOT_ANIMS"; readonly spotAnimIds: readonly number[] };

export type ActorAssets = {
    readonly player: PlayerAssets;
    readonly enemyTypes: readonly EnemyTypeAssets[];
    readonly preview?: PreviewAssets;
    readonly projectiles: Readonly<Record<ProjectileKind, ProjectileBake>>;
    readonly effects: Readonly<Record<VisualEffectKind, SpotAnimBake>>;
    // Every OSRS item that can ever appear as a ground drop (see Equipment.allDroppableItemIds).
    readonly groundItemIds: readonly number[];
};

function playerAssets(): PlayerAssets {
    const seqIds = new Set<number>();
    const itemIds = new Set<number>();
    const stanceSeqIds = {} as Record<WeaponStyle, StanceSeqIds>;
    for (const style of ALL_STYLES) {
        const { idleSeqId, walkSeqId, runSeqId, attackSeqId, extraSeqIds } =
            STANCE_SEQ_CONFIG[style];
        stanceSeqIds[style] = { idleSeqId, walkSeqId, runSeqId, attackSeqId };
        for (const seqId of [idleSeqId, walkSeqId, runSeqId, attackSeqId, ...extraSeqIds]) {
            seqIds.add(seqId);
        }
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
    return {
        baseNpcTypeId: PLAYER_BASE_NPC_TYPE_ID,
        stanceSeqIds,
        seqIds: [...seqIds],
        attachmentItemIds: [...itemIds],
    };
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

function rangeIds(range: SeqRange): number[] {
    return Array.from({ length: range.to - range.from + 1 }, (_, index) => range.from + index);
}

function previewAssets(preview: AnimPreviewParams): PreviewAssets {
    switch (preview.kind) {
        case "NPC_SEQS":
            return {
                kind: "NPC_SEQS",
                npcTypeId: preview.npcTypeId,
                seqIds: rangeIds(preview.seqRange),
            };
        case "SPOT_ANIMS":
            return { kind: "SPOT_ANIMS", spotAnimIds: rangeIds(preview.range) };
    }
}

// Everything the actor buffer is baked from for this encounter. ActorRenderDataLoader reads the
// cache only through this value, and the encounter's cache roots are flattened from it, so what a
// pack ships and what the loader reads cannot drift apart.
export function actorAssets(encounter: Encounter, preview?: AnimPreviewParams): ActorAssets {
    const enemyTypes = encounter.enemyTypeIds
        .filter((id): id is StaticEnemyTypeId => id !== EnemyTypeId.PREVIEW)
        .map((enemyTypeId) => {
            const enemyType = getEnemyType(enemyTypeId);
            return {
                enemyTypeId,
                npcTypeId: enemyType.npcTypeId,
                seqIds: enemyTypeSeqIds(enemyType),
            };
        });
    return {
        player: playerAssets(),
        enemyTypes,
        preview: preview ? previewAssets(preview) : undefined,
        projectiles: PROJECTILE_BAKES,
        effects: EFFECT_BAKES,
        groundItemIds: [...new Set(allDroppableItemIds())],
    };
}
