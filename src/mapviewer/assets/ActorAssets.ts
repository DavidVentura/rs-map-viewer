import { WeaponStyle } from "../game/Ability";
import { AnimPreviewParams, SeqRange } from "../game/AnimPreview";
import { AppearanceSlot, BodyKitPart, resolveAppearance } from "../game/Appearance";
import { Encounter, EncounterScriptKind, EncounterSpawnMode } from "../game/Encounter";
import { EnemyType, EnemyTypeId, getEnemyType } from "../game/EnemyType";
import {
    DroppableItemDisplay,
    EquipmentPath,
    allDroppableItemDrops,
    armourItemIdsForStyle,
    armourWearInfoForStyle,
    secondaryPathForStyle,
    visualGroupItemIds,
    weaponVisualItemIds,
} from "../game/Equipment";
import { WorldObjectKind } from "../game/Interaction";
import { Player } from "../game/Player";
import {
    ENERGY_SIPHON_LAUNCH_TRAVEL_SEQ_ID,
    ENERGY_SIPHON_LEECH_TRAVEL_SEQ_ID,
    ENERGY_SIPHON_RECALL_TRAVEL_SEQ_ID,
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    JAD_FIRE_SEQ_ID,
    JAD_RANGED_ROCK_SEQ_ID,
    KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    ProjectileKind,
    SWAMP_TRIDENT_TRAVEL_SEQ_ID,
    TUMEKENS_SHADOW_TRAVEL_SEQ_ID,
    WARPED_SCEPTRE_TRAVEL_SEQ_ID,
    ZEBAK_PHANTOM_MAGIC_TRAVEL_SEQ_ID,
    ZEBAK_PHANTOM_RANGED_TRAVEL_SEQ_ID,
} from "../game/Projectile";
import {
    ARROW_LAUNCH_SEQ_ID,
    BABA_ROCK_FALL_SEQ_ID,
    CRYSTAL_HALBERD_SPECIAL_SEQ_ID,
    DUST_WAVE_SEQ_ID,
    FALLING_SHADOW_SEQ_ID,
    FIRE_BOLT_CAST_SEQ_ID,
    ICE_BARRAGE_HIT_SEQ_ID,
    MAUL_IMPACT_SPARK_SEQ_ID,
    SWAMP_TRIDENT_CAST_SEQ_ID,
    SWAMP_TRIDENT_IMPACT_SEQ_ID,
    TUMEKENS_SHADOW_CAST_SEQ_ID,
    TUMEKENS_SHADOW_IMPACT_SEQ_ID,
    TZHAAR_HEAL_SEQ_ID,
    VisualEffectKind,
    WARDENS_FALLING_TILE_SEQ_ID,
    WARDENS_LIGHTNING_SEQ_ID,
    WARPED_SCEPTRE_IMPACT_SEQ_ID,
    ZEBAK_PHANTOM_MAGIC_IMPACT_SEQ_ID,
    ZEBAK_PHANTOM_RANGED_IMPACT_SEQ_ID,
} from "../game/VisualEffect";
import { wardenP3AnimationSeqIds } from "../game/WardenP3Animations";
import { WardenPhantom } from "../game/WardenP3Director";
import { wardenPhantomEnemyTypeId } from "../game/WardenP3Phantoms";
import {
    HEALING_POTION_CAST_SEQ_ID,
    WEAPON_LADDERS,
    WeaponStanceSeqIds,
    allPlayerAbilities,
    resolveWeaponStance,
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

// bow: unarmed idle/walk/run, bow attack (shared by every ranged tier)
// staff: standard spellcast idle/walk/run/attack
// scimitar: unarmed idle/walk/run, slash attack
// This is each style's *default* stance - the one every weapon tier plays unless its own
// WeaponTier.stance overrides it (see WEAPON_LADDERS/resolveWeaponStance and stancesByTier below;
// e.g. the dragon 2h sword rests on the shoulder rather than sharing melee's default one-handed
// idle). Which item ids are actually worn for a given style/equipment/cast comes from
// Equipment.equippedVisualItemIds, resolved separately per attachment instance rather than folded
// into one PlayerAppearance here (see ActorRenderDataLoader's createPlayerActorData). Every
// ability's own cast seq (every weapon tier's basic attack, every skill) is baked generically via
// allPlayerAbilities() in
// playerAssets() below, so this config only needs the seqs that aren't tied to an ability at all:
// the style default idle/walk/run and COMMON_EXTRA_SEQ_IDS' switch/death seqs.
const STANCE_SEQ_CONFIG: Record<WeaponStyle, WeaponStanceSeqIds> = {
    [WeaponStyle.RANGED]: {
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
    },
    [WeaponStyle.MAGIC]: {
        idleSeqId: 813,
        walkSeqId: 1146,
        runSeqId: 1210,
    },
    [WeaponStyle.MELEE]: {
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
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

export type AnimatedSpotAnimBake = SpotAnimBake & {
    readonly seq: Extract<SpotAnimSeq, { kind: "ANIMATED" }>;
};

function animatedSpotAnim(
    spotAnimId: number,
    seqId: number,
    modelScale?: number,
): AnimatedSpotAnimBake {
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

// Bow of Faerdhinen's crystal arrow (SpotAnimType id): 1887, SP_ATTACK_ARROW_TRAVEL_FAERDHINEN, a
// static model without a sequence.
const CRYSTAL_ARROW_SPOTANIM_ID = 1887;

// Warped sceptre projectile (SpotAnimType ids): 2569 travels, 2568 hits.
const WARPED_SCEPTRE_PROJECTILE_SPOTANIM_ID = 2569;
const WARPED_SCEPTRE_IMPACT_SPOTANIM_ID = 2568;

// Trident of the swamp projectile (SpotAnimType ids, TOXIC_TOTS_*): 1040 travels, 1042 hits.
const SWAMP_TRIDENT_PROJECTILE_SPOTANIM_ID = 1040;
const SWAMP_TRIDENT_IMPACT_SPOTANIM_ID = 1042;

// Tumeken's shadow projectile (SpotAnimType ids): 2126 travels, 2127 hits.
const TUMEKENS_SHADOW_PROJECTILE_SPOTANIM_ID = 2126;
const TUMEKENS_SHADOW_IMPACT_SPOTANIM_ID = 2127;

// Crystal halberd special weapon-trail (SpotAnimType id): 1232, DRAGON_HALBERD_SPECIAL_SOUTH_WHITE
// (see VisualEffect.CRYSTAL_HALBERD_SPECIAL_SEQ_ID for why only the SOUTH bake is kept).
const CRYSTAL_HALBERD_SPECIAL_SPOTANIM_ID = 1232;

// The generic bow release (SpotAnimType id): 19, BRONZE_ARROW_LAUNCH (see
// VisualEffect.ARROW_LAUNCH_SEQ_ID).
const ARROW_LAUNCH_SPOTANIM_ID = 19;
// Bow of Faerdhinen's own crystal-arrow launch (SpotAnimType id): 1888,
// SP_ATTACK_ARROW_LAUNCH_FAERDHINEN, the same sequence as the generic bow release above in the
// bow's own crystal livery.
const CRYSTAL_ARROW_LAUNCH_SPOTANIM_ID = 1888;

// Trident of the swamp's own cast graphic (SpotAnimType id): 665, TOXIC_TOTS_CASTING.
const SWAMP_TRIDENT_CAST_SPOTANIM_ID = 665;
// Tumeken's shadow's own cast graphic (SpotAnimType id): 2125, TUMEKENS_SHADOW_CASTING.
const TUMEKENS_SHADOW_CAST_SPOTANIM_ID = 2125;
// The tier-0 staff's fire bolt cast graphic (SpotAnimType id): 126, FIREBOLT_CASTING.
const FIRE_BOLT_CAST_SPOTANIM_ID = 126;

const WARDENS_LIGHTNING_SPOTANIM_ID = 2197;
const WARDENS_LIGHTNING_WARNING_SPOTANIM_ID = 2198;
const WARDENS_FALLING_TILE_SPOTANIM_ID = 2228;

// Zebak's own projectiles (SpotAnimType ids): 2176 ZEBAK_MAGE_PROJANIM_INITIAL, a jug, and 2178
// ZEBAK_RANGE_PROJANIM_INITIAL, a rock shard; 2186/2185 are the bursts they break into.
const ZEBAK_PHANTOM_MAGIC_PROJECTILE_SPOTANIM_ID = 2176;
const ZEBAK_PHANTOM_RANGED_PROJECTILE_SPOTANIM_ID = 2178;
const ZEBAK_PHANTOM_MAGIC_IMPACT_SPOTANIM_ID = 2186;
const ZEBAK_PHANTOM_RANGED_IMPACT_SPOTANIM_ID = 2185;
const BABA_ROCK_FALL_SPOTANIM_ID = 2252;

// Energy siphon flights (SpotAnimType ids): 2224 FX_WARDENS_BOMB01 flies out, 2238
// SPOTANIM_WARDENS_PHASE01_BALL02 leeches and 2237 SPOTANIM_WARDENS_PHASE01_BALL01 flies back.
const ENERGY_SIPHON_LAUNCH_SPOTANIM_ID = 2224;
const ENERGY_SIPHON_LEECH_SPOTANIM_ID = 2238;
const ENERGY_SIPHON_RECALL_SPOTANIM_ID = 2237;

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
    [ProjectileKind.CRYSTAL_ARROW]: {
        kind: "SPOT_ANIM",
        spotAnimId: CRYSTAL_ARROW_SPOTANIM_ID,
        seq: { kind: "STATIC" },
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
    [ProjectileKind.WARPED_SCEPTRE]: animatedSpotAnim(
        WARPED_SCEPTRE_PROJECTILE_SPOTANIM_ID,
        WARPED_SCEPTRE_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.SWAMP_TRIDENT]: animatedSpotAnim(
        SWAMP_TRIDENT_PROJECTILE_SPOTANIM_ID,
        SWAMP_TRIDENT_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.TUMEKENS_SHADOW]: animatedSpotAnim(
        TUMEKENS_SHADOW_PROJECTILE_SPOTANIM_ID,
        TUMEKENS_SHADOW_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.ZEBAK_PHANTOM_MAGIC]: animatedSpotAnim(
        ZEBAK_PHANTOM_MAGIC_PROJECTILE_SPOTANIM_ID,
        ZEBAK_PHANTOM_MAGIC_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.ZEBAK_PHANTOM_RANGED]: animatedSpotAnim(
        ZEBAK_PHANTOM_RANGED_PROJECTILE_SPOTANIM_ID,
        ZEBAK_PHANTOM_RANGED_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.ENERGY_SIPHON_LAUNCH]: animatedSpotAnim(
        ENERGY_SIPHON_LAUNCH_SPOTANIM_ID,
        ENERGY_SIPHON_LAUNCH_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.ENERGY_SIPHON_LEECH]: animatedSpotAnim(
        ENERGY_SIPHON_LEECH_SPOTANIM_ID,
        ENERGY_SIPHON_LEECH_TRAVEL_SEQ_ID,
    ),
    [ProjectileKind.ENERGY_SIPHON_RECALL]: animatedSpotAnim(
        ENERGY_SIPHON_RECALL_SPOTANIM_ID,
        ENERGY_SIPHON_RECALL_TRAVEL_SEQ_ID,
    ),
};

export const EFFECT_BAKES: Readonly<Record<VisualEffectKind, AnimatedSpotAnimBake>> = {
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
    [VisualEffectKind.CRYSTAL_HALBERD_SPECIAL]: animatedSpotAnim(
        CRYSTAL_HALBERD_SPECIAL_SPOTANIM_ID,
        CRYSTAL_HALBERD_SPECIAL_SEQ_ID,
    ),
    [VisualEffectKind.WARPED_SCEPTRE_IMPACT]: animatedSpotAnim(
        WARPED_SCEPTRE_IMPACT_SPOTANIM_ID,
        WARPED_SCEPTRE_IMPACT_SEQ_ID,
    ),
    [VisualEffectKind.SWAMP_TRIDENT_IMPACT]: animatedSpotAnim(
        SWAMP_TRIDENT_IMPACT_SPOTANIM_ID,
        SWAMP_TRIDENT_IMPACT_SEQ_ID,
    ),
    [VisualEffectKind.TUMEKENS_SHADOW_IMPACT]: animatedSpotAnim(
        TUMEKENS_SHADOW_IMPACT_SPOTANIM_ID,
        TUMEKENS_SHADOW_IMPACT_SEQ_ID,
    ),
    [VisualEffectKind.ARROW_LAUNCH]: animatedSpotAnim(
        ARROW_LAUNCH_SPOTANIM_ID,
        ARROW_LAUNCH_SEQ_ID,
    ),
    [VisualEffectKind.CRYSTAL_ARROW_LAUNCH]: animatedSpotAnim(
        CRYSTAL_ARROW_LAUNCH_SPOTANIM_ID,
        ARROW_LAUNCH_SEQ_ID,
    ),
    [VisualEffectKind.SWAMP_TRIDENT_CAST]: animatedSpotAnim(
        SWAMP_TRIDENT_CAST_SPOTANIM_ID,
        SWAMP_TRIDENT_CAST_SEQ_ID,
    ),
    [VisualEffectKind.TUMEKENS_SHADOW_CAST]: animatedSpotAnim(
        TUMEKENS_SHADOW_CAST_SPOTANIM_ID,
        TUMEKENS_SHADOW_CAST_SEQ_ID,
    ),
    [VisualEffectKind.FIRE_BOLT_CAST]: animatedSpotAnim(
        FIRE_BOLT_CAST_SPOTANIM_ID,
        FIRE_BOLT_CAST_SEQ_ID,
    ),
    [VisualEffectKind.WARDENS_LIGHTNING]: animatedSpotAnim(
        WARDENS_LIGHTNING_SPOTANIM_ID,
        WARDENS_LIGHTNING_SEQ_ID,
    ),
    [VisualEffectKind.WARDENS_LIGHTNING_WARNING]: animatedSpotAnim(
        WARDENS_LIGHTNING_WARNING_SPOTANIM_ID,
        WARDENS_LIGHTNING_SEQ_ID,
    ),
    [VisualEffectKind.WARDENS_FALLING_TILE]: animatedSpotAnim(
        WARDENS_FALLING_TILE_SPOTANIM_ID,
        WARDENS_FALLING_TILE_SEQ_ID,
    ),
    [VisualEffectKind.ZEBAK_PHANTOM_MAGIC_IMPACT]: animatedSpotAnim(
        ZEBAK_PHANTOM_MAGIC_IMPACT_SPOTANIM_ID,
        ZEBAK_PHANTOM_MAGIC_IMPACT_SEQ_ID,
    ),
    [VisualEffectKind.ZEBAK_PHANTOM_RANGED_IMPACT]: animatedSpotAnim(
        ZEBAK_PHANTOM_RANGED_IMPACT_SPOTANIM_ID,
        ZEBAK_PHANTOM_RANGED_IMPACT_SEQ_ID,
    ),
    [VisualEffectKind.BABA_ROCK_FALL]: animatedSpotAnim(
        BABA_ROCK_FALL_SPOTANIM_ID,
        BABA_ROCK_FALL_SEQ_ID,
    ),
};

// A world object (lever/chest) has no animation of its own in this cache - see the comment on
// LEVER_INTERACTION_ANIMATION_SEQ_ID/CHEST_INTERACTION_ANIMATION_SEQ_ID in game/Encounter.ts - so
// it renders as one of two static locs, swapped by kind and WorldObjectVariant (see
// webgl/loader/ActorRenderDataLoader.ts's createWorldObjectActorData).
export type WorldObjectBake = {
    readonly restLocId: number;
    readonly activatedLocId: number;
};

// Lever: UPASS_LEVER_UP (3241, "Pull") swaps to UPASS_LEVER_DOWN (3242) once pulled.
// Chest: CHESTCLOSED (375, "Open") swaps to CHESTOPEN (378) once opened.
export const WORLD_OBJECT_BAKES: Readonly<Record<WorldObjectKind, WorldObjectBake>> = {
    [WorldObjectKind.LEVER]: { restLocId: 3241, activatedLocId: 3242 },
    [WorldObjectKind.CHEST]: { restLocId: 375, activatedLocId: 378 },
};

// Hans's (npc 3105) own body-region models, one per appearance slot they occupy - worked out with
// a throwaway script (scripts/cache/verify-armour-throwaway.ts, not checked in) by rendering each
// of npc.modelIds individually (model-raster.ts) and cross-referencing against the identkit
// archive, since Hans is a fixed NPC body rather than a real player built from identikit parts (no
// idk model in this cache matches any of npc.modelIds directly). Every one of the 8 raw model ids
// npc 3105 lists is accounted for here exactly once: 217 head/hair/face (there is no separate bare-
// face mesh to keep visible once a full helm hides this slot), 246 jaw/chin, 28515+320 torso (a
// shirt plus its collar, which disappear together), 26630 arms, 176 hands, 28285 legs, 185 boots.
export const PLAYER_BODY_KIT: readonly BodyKitPart[] = [
    { slot: AppearanceSlot.HAIR, modelIds: [217] },
    { slot: AppearanceSlot.JAW, modelIds: [246] },
    { slot: AppearanceSlot.TORSO, modelIds: [28515, 320] },
    { slot: AppearanceSlot.ARMS, modelIds: [26630] },
    { slot: AppearanceSlot.HANDS, modelIds: [176] },
    { slot: AppearanceSlot.LEGS, modelIds: [28285] },
    { slot: AppearanceSlot.BOOTS, modelIds: [185] },
];

// The body-kit model ids actually visible for a style, once its permanently-worn armour (see
// Equipment.armourWearInfoForStyle) has hidden whatever it covers - baked once per style rather
// than per equipment combination, since that armour never changes tier (see
// ActorRenderDataLoader.createPlayerActorData).
export function bodyModelIdsForStyle(style: WeaponStyle): readonly number[] {
    return resolveAppearance(PLAYER_BODY_KIT, armourWearInfoForStyle(style)).bodyModelIds;
}

export type PlayerAssets = {
    readonly baseNpcTypeId: number;
    // Every weapon tier's own resolved idle/walk/run (see WEAPON_LADDERS/resolveWeaponStance),
    // indexed the same way as basicAttackByTier - which one is active depends on the player's
    // currently-equipped tier for this style, not just the style itself.
    readonly stancesByTier: Readonly<Record<WeaponStyle, readonly WeaponStanceSeqIds[]>>;
    // Every seq the body rig is posed with, across all styles.
    readonly seqIds: readonly number[];
    readonly attachmentItemIds: readonly number[];
    // The body-kit model ids to bake per style (see bodyModelIdsForStyle) - one body mesh per
    // style, not per equipment combination.
    readonly bodyModelIdsByStyle: Readonly<Record<WeaponStyle, readonly number[]>>;
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
    readonly effects: Readonly<Record<VisualEffectKind, AnimatedSpotAnimBake>>;
    // Every OSRS item that can ever appear as a ground drop, with how many of it to show stacked
    // (see Equipment.allDroppableItemDrops).
    readonly groundItemDrops: readonly DroppableItemDisplay[];
    // The kinds of world object (lever, chest) this encounter actually declares, deduplicated -
    // each is baked once regardless of how many Interactions in the encounter operate it.
    readonly worldObjectKinds: readonly WorldObjectKind[];
};

// interactionSeqIds are the encounter's interaction animations, which the player plays too.
function playerAssets(interactionSeqIds: readonly number[]): PlayerAssets {
    const seqIds = new Set<number>();
    const itemIds = new Set<number>();
    const stancesByTier = {} as Record<WeaponStyle, readonly WeaponStanceSeqIds[]>;
    const bodyModelIdsByStyle = {} as Record<WeaponStyle, readonly number[]>;
    for (const seqId of [...COMMON_EXTRA_SEQ_IDS, ...interactionSeqIds]) {
        seqIds.add(seqId);
    }
    for (const style of ALL_STYLES) {
        stancesByTier[style] = WEAPON_LADDERS[style].map((tier) =>
            resolveWeaponStance(STANCE_SEQ_CONFIG[style], tier),
        );
        for (const stance of stancesByTier[style]) {
            seqIds.add(stance.idleSeqId);
            seqIds.add(stance.walkSeqId);
            seqIds.add(stance.runSeqId);
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
        for (const itemId of armourItemIdsForStyle(style)) {
            itemIds.add(itemId);
        }
        bodyModelIdsByStyle[style] = bodyModelIdsForStyle(style);
    }
    for (const itemId of visualGroupItemIds(EquipmentPath.AMULET)) {
        itemIds.add(itemId);
    }
    // Every cast-item override (elder maul/crystal halberd specials) and its own cast seq, derived
    // generically from every player ability rather than named one by one here (see
    // AbilityDefinition.castItemOverride).
    for (const ability of allPlayerAbilities()) {
        if (ability.castItemOverride) {
            itemIds.add(ability.castItemOverride.itemId);
        }
        seqIds.add(ability.castSeqId);
    }
    return {
        baseNpcTypeId: PLAYER_BASE_NPC_TYPE_ID,
        stancesByTier,
        seqIds: [...seqIds],
        attachmentItemIds: [...itemIds],
        bodyModelIdsByStyle,
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

// A scripted encounter's own seqs play on its boss and its phantoms, so they are baked into the
// type of whichever actor plays them.
function scriptSeqIds(encounter: Encounter, enemyTypeId: StaticEnemyTypeId): readonly number[] {
    if (encounter.spawnMode !== EncounterSpawnMode.SCRIPTED) {
        return [];
    }
    switch (encounter.script.kind) {
        case EncounterScriptKind.WARDENS_P3: {
            if (enemyTypeId === EnemyTypeId.TUMEKENS_WARDEN) {
                return wardenP3AnimationSeqIds(encounter.script.wardenAnimations);
            }
            return Object.values(WardenPhantom)
                .filter((phantom) => wardenPhantomEnemyTypeId(phantom) === enemyTypeId)
                .map((phantom) => encounter.script.phantomAnimations.attacks[phantom].seqId);
        }
    }
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
                seqIds: [
                    ...new Set([
                        ...enemyTypeSeqIds(enemyType),
                        ...scriptSeqIds(encounter, enemyTypeId),
                    ]),
                ],
            };
        });
    return {
        player: playerAssets(
            encounter.interactions.map((interaction) => interaction.animationSeqId),
        ),
        enemyTypes,
        preview: preview ? previewAssets(preview) : undefined,
        projectiles: PROJECTILE_BAKES,
        effects: EFFECT_BAKES,
        groundItemDrops: [
            ...new Map(allDroppableItemDrops().map((drop) => [drop.itemId, drop])).values(),
        ],
        worldObjectKinds: [...new Set(encounter.worldObjects.map((object) => object.kind))],
    };
}
