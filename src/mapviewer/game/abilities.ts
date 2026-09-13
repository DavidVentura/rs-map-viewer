import {
    AbilityDefinition,
    CastItemOverride,
    CasterEffectPlacement,
    CircleCenter,
    ConeAim,
    CooldownGroup,
    DeliveryKind,
    ProjectileDelivery,
    ResolvedAbility,
    WeaponStyle,
    resolveAbility,
} from "./Ability";
import { Affects, DamageRoll, PayloadKind, damagePayload } from "./Effect";
import {
    ARROW_SPEC,
    CRYSTAL_ARROW_SPEC,
    JAD_MAGE_BLAST_SPEC,
    JAD_RANGED_ROCK_SPEC,
    KET_ZEK_FIRE_BLAST_SPEC,
    MAGIC_SPEC,
    POWER_SHOT_SPEC,
    ProjectileSpec,
    SWAMP_TRIDENT_SPEC,
    TOK_XIL_SHOT_SPEC,
    TUMEKENS_SHADOW_SPEC,
    VOLLEY_ARROW_SPEC,
    WARPED_SCEPTRE_SPEC,
} from "./Projectile";
import { SeqCatalog } from "./SeqCatalog";
import { VisualEffectKind } from "./VisualEffect";

// The player's basic-attack sequences are the same ids the renderer preloads per stance (see
// ActorAssets' STANCE_SEQ_CONFIG).
export const BOW_SHOT_CAST_SEQ_ID = 426;
export const MAGIC_BOLT_CAST_SEQ_ID = 711;
export const SCIMITAR_SLASH_CAST_SEQ_ID = 390;
export const ICE_BARRAGE_CAST_SEQ_ID = 1979;
export const CLEAVE_CAST_SEQ_ID = 1203;
export const HEALING_POTION_CAST_SEQ_ID = 829;

// The item shown in hand for each weapon tier and cast-item-override special, verified to exist
// and render in this cache with a throwaway script (scripts/cache/verify-armour-throwaway.ts, not
// checked in).
export const RUNE_SCIMITAR_ITEM_ID = 1333;
export const DRAGON_SCIMITAR_ITEM_ID = 4587;
export const DRAGON_2H_SWORD_ITEM_ID = 7158;
export const SCYTHE_OF_VITUR_ITEM_ID = 22325;
export const STAFF_ITEM_ID = 1379;
export const WARPED_SCEPTRE_ITEM_ID = 28585;
export const SWAMP_TRIDENT_ITEM_ID = 12899;
export const TUMEKENS_SHADOW_ITEM_ID = 27275;
export const SHORTBOW_ITEM_ID = 841;
export const MAGIC_SHORTBOW_ITEM_ID = 861;
export const BOW_OF_FAERDHINEN_ITEM_ID = 25865;
export const TWISTED_BOW_ITEM_ID = 20997;
// Elder maul special attack (obj 21003) and crystal halberd special attack (obj 23987): the item
// shown in the caster's hand for the duration of MAUL_SMASH/CLEAVE, in place of whatever weapon is
// actually equipped (see AbilityDefinition.castItemOverride). Both are two-handed (op14=5, hiding
// a worn shield-slot attachment), like every other override/2h weapon in this project.
export const ELDER_MAUL_ITEM_ID = 21003;
export const CRYSTAL_HALBERD_ITEM_ID = 23987;

const ON_CASTER: CasterEffectPlacement = { kind: "ON_CASTER" };
// The halberd and scythe sweeps hit the row one tile in front, where OSRS plays their arc.
const SWEEP_AHEAD: CasterEffectPlacement = { kind: "AHEAD", distance: 128 };

function singleShot(spec: ProjectileSpec): ProjectileDelivery {
    return { kind: DeliveryKind.PROJECTILE, spec, count: 1, spreadAngleRadians: 0 };
}

const ARROW_DAMAGE = 8;
const MAGIC_BOLT_DAMAGE = 12;
const SCIMITAR_SLASH_DAMAGE: DamageRoll = { min: 4, max: 9 };
const MELEE_REACH = 48;

// Player castSpeeds keep each basic attack's whole sequence inside its old windup+lock cadence,
// so the swing plays as one continuous motion with the recovery under the ATTACK lock.
// Bow shot's release is the string-snap frame.
export const BOW_SHOT: AbilityDefinition = {
    id: "bow_shot",
    name: "Bow Shot",
    castSeqId: BOW_SHOT_CAST_SEQ_ID,
    contactFrame: 5,
    castSpeed: 2.9,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: {
        delivery: singleShot(ARROW_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(ARROW_DAMAGE)],
        // Every shortbow-family tier draws the same bow (magic shortbow/twisted bow inherit this
        // effect below), so they all show the same generic bow release; Bow of Faerdhinen overrides
        // it with its own crystal-arrow launch instead (see BOW_OF_FAERDHINEN_SHOT).
        casterEffect: { kind: VisualEffectKind.ARROW_LAUNCH, height: 70, placement: ON_CASTER },
    },
};

// Release at the second cast-hold, not the first (the raise).
export const MAGIC_BOLT: AbilityDefinition = {
    id: "magic_bolt",
    name: "Magic Bolt",
    castSeqId: MAGIC_BOLT_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 2.47,
    channelSeconds: 0,
    manaCost: 10,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: {
        delivery: singleShot(MAGIC_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(MAGIC_BOLT_DAMAGE)],
        hitEffect: { kind: VisualEffectKind.MAGIC_HIT, height: 124 },
        casterEffect: { kind: VisualEffectKind.FIRE_BOLT_CAST, height: 100, placement: ON_CASTER },
    },
};

// Contact at the extended-arm hold right after the fast downswing.
export const SCIMITAR_SLASH: AbilityDefinition = {
    id: "scimitar_slash",
    name: "Scimitar Slash",
    castSeqId: SCIMITAR_SLASH_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1.56,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.14 }],
    effect: {
        delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(SCIMITAR_SLASH_DAMAGE.min, SCIMITAR_SLASH_DAMAGE.max)],
    },
};

// Dragon scimitar reuses the plain scimitar's own slash animation and timing (real OSRS scimitars
// of every tier share one slash animation); only the item shown in hand differs by tier.
export const DRAGON_SCIMITAR_SLASH: AbilityDefinition = {
    ...SCIMITAR_SLASH,
    id: "dragon_scimitar_slash",
    name: "Dragon Scimitar Slash",
};

export const DRAGON_2H_SWORD_CAST_SEQ_ID = 7045;

// The dragon 2h sword's own stance (RuneLite AnimationID DH_SWORD_UPDATE_READY/_WALK/_RUN): OSRS
// rests a 2h weapon on the shoulder rather than holding it one-handed like the ladder's lower
// tiers, which otherwise all share the style's default stance (see WEAPON_LADDERS).
export const DRAGON_2H_SWORD_IDLE_SEQ_ID = 7053;
export const DRAGON_2H_SWORD_WALK_SEQ_ID = 7052;
export const DRAGON_2H_SWORD_RUN_SEQ_ID = 7043;

// The current OSRS 2h slash (DH_SWORD_UPDATE_SLASH); the classic HUMAN_DHSWORD_SLASH (407) is the
// alternative, kept here only as a note since this project targets the current animation set.
// Uniform 40ms frames with no standout hold (unlike the scythe sweep below), so contact sits ~55%
// through the swing (frame 10 of 19, the same rule of thumb used for TUMEKENS_SHADOW_BEAM/
// SWAMP_TRIDENT_BOLT's own uniform frame data), and castSpeed is picked so that frame lands at the
// same wall-clock offset as the plain scimitar's own contact frame (359ms), keeping the melee
// ladder's basic attack equally snappy regardless of the equipped tier. A small, close arc rather
// than a single target: the 2h sword starts the ladder's cleaving tiers, hitting whatever's in
// front of the swing (see ConeAim.TRACKED_TARGET) instead of just one aimed enemy.
export const DRAGON_2H_SWORD_SLASH: AbilityDefinition = {
    id: "dragon_2h_sword_slash",
    name: "Dragon 2h Sword Attack",
    castSeqId: DRAGON_2H_SWORD_CAST_SEQ_ID,
    contactFrame: 10,
    castSpeed: 1.11,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.14 }],
    effect: {
        delivery: {
            kind: DeliveryKind.CONE,
            angleRadians: Math.PI / 2,
            reach: 1.5 * 128,
            casterHalfWidth: 0.5 * 128,
            aim: ConeAim.TRACKED_TARGET,
        },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(SCIMITAR_SLASH_DAMAGE.min, SCIMITAR_SLASH_DAMAGE.max)],
    },
};

export const SCYTHE_ATTACK_CAST_SEQ_ID = 8056;

// The scythe's own idle (RuneLite AnimationID SCYTHE_OF_VITUR_READY); RuneLite has no distinct
// walk/run for it, so it keeps the melee style's default walk/run (see WEAPON_LADDERS).
export const SCYTHE_OF_VITUR_IDLE_SEQ_ID = 8057;

// Contact at the scythe's biggest single hold (frame 11, 220ms raw), the follow-through as the
// blade completes its sweep; castSpeed picked the same way as the 2h sword's, to land at the same
// wall-clock offset as the plain scimitar's contact frame. A wide arc rather than a single target,
// the ladder's widest reach, like the real scythe of vitur's own hit on every adjacent tile.
export const SCYTHE_SWEEP: AbilityDefinition = {
    id: "scythe_sweep",
    name: "Scythe of Vitur Attack",
    castSeqId: SCYTHE_ATTACK_CAST_SEQ_ID,
    contactFrame: 11,
    castSpeed: 1.23,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.14 }],
    effect: {
        delivery: {
            kind: DeliveryKind.CONE,
            angleRadians: (5 * Math.PI) / 6,
            reach: 2 * 128,
            casterHalfWidth: 128,
            aim: ConeAim.TRACKED_TARGET,
        },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(SCIMITAR_SLASH_DAMAGE.min, SCIMITAR_SLASH_DAMAGE.max)],
        // No casterEffect yet: the scythe's real swing graphic hasn't been found. The halberd
        // sweep liveries (478/1891/1895 sets) don't match its 22-frame swing and looked wrong.
    },
};

// Magic shortbow/Bow of Faerdhinen/twisted bow all share the plain shortbow's own bow-draw
// animation (real OSRS bows share one basic-attack animation regardless of tier); only the fired
// projectile's own model differs for Bow of Faerdhinen (see CRYSTAL_ARROW_SPEC).
export const MAGIC_SHORTBOW_SHOT: AbilityDefinition = {
    ...BOW_SHOT,
    id: "magic_shortbow_shot",
    name: "Magic Shortbow Shot",
};
export const BOW_OF_FAERDHINEN_SHOT: AbilityDefinition = {
    ...BOW_SHOT,
    id: "bow_of_faerdhinen_shot",
    name: "Bow of Faerdhinen Shot",
    effect: {
        ...BOW_SHOT.effect,
        delivery: singleShot(CRYSTAL_ARROW_SPEC),
        // Its own crystal-arrow launch in place of the generic bow release the rest of the ladder
        // inherits from BOW_SHOT.
        casterEffect: {
            kind: VisualEffectKind.CRYSTAL_ARROW_LAUNCH,
            height: 70,
            placement: ON_CASTER,
        },
    },
};
export const TWISTED_BOW_SHOT: AbilityDefinition = {
    ...BOW_SHOT,
    id: "twisted_bow_shot",
    name: "Twisted Bow Shot",
};

export const WARPED_SCEPTRE_ATTACK_CAST_SEQ_ID = 10501;

// Contact at the cast's peak hold (frame 9), castSpeed picked so the whole sequence lands at the
// same wall-clock offset as the plain staff's own impact (413ms) - see MAGIC_BOLT.
// No casterEffect for its own cast graphic (SpotAnimType 2567, VFX_WARPED_SCEPTRE_CAST), which plays
// a skeletal sequence.
export const WARPED_SCEPTRE_BOLT: AbilityDefinition = {
    id: "warped_sceptre_bolt",
    name: "Warped Sceptre Attack",
    castSeqId: WARPED_SCEPTRE_ATTACK_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 2.52,
    channelSeconds: 0,
    manaCost: 10,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: {
        delivery: singleShot(WARPED_SCEPTRE_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(MAGIC_BOLT_DAMAGE)],
        hitEffect: {
            kind: VisualEffectKind.WARPED_SCEPTRE_IMPACT,
            height: 100,
        },
    },
};

export const SWAMP_TRIDENT_ATTACK_CAST_SEQ_ID = 1167;

// Fairly uniform frame lengths (the generic magic "wave" cast several mid/high magic weapons
// share), so contact sits ~55% through the build-up, the rule of thumb used elsewhere in this file
// for animations with no standout hold (see JAD_MAGE_BLAST).
export const SWAMP_TRIDENT_BOLT: AbilityDefinition = {
    id: "swamp_trident_bolt",
    name: "Trident of the Swamp Attack",
    castSeqId: SWAMP_TRIDENT_ATTACK_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1.07,
    channelSeconds: 0,
    manaCost: 10,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: {
        delivery: singleShot(SWAMP_TRIDENT_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(MAGIC_BOLT_DAMAGE)],
        hitEffect: {
            kind: VisualEffectKind.SWAMP_TRIDENT_IMPACT,
            height: 100,
        },
        casterEffect: {
            kind: VisualEffectKind.SWAMP_TRIDENT_CAST,
            height: 100,
            placement: ON_CASTER,
        },
    },
};

export const TUMEKENS_SHADOW_ATTACK_CAST_SEQ_ID = 9493;

// Perfectly uniform frame lengths, so contact sits ~55% through the build-up like the trident's
// above. The slower castSpeed (a longer wall-clock cast than the rest of the magic ladder) reads as
// a heavier, more deliberate cast for the ladder's top tier.
export const TUMEKENS_SHADOW_BEAM: AbilityDefinition = {
    id: "tumekens_shadow_beam",
    name: "Tumeken's Shadow Attack",
    castSeqId: TUMEKENS_SHADOW_ATTACK_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 2.18,
    channelSeconds: 0,
    manaCost: 10,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: {
        delivery: singleShot(TUMEKENS_SHADOW_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(MAGIC_BOLT_DAMAGE)],
        hitEffect: {
            kind: VisualEffectKind.TUMEKENS_SHADOW_IMPACT,
            height: 100,
        },
        casterEffect: {
            kind: VisualEffectKind.TUMEKENS_SHADOW_CAST,
            height: 50,
            placement: ON_CASTER,
        },
    },
};

// A weapon tier's own idle/walk/run, overriding whichever of the style's default stance seqs it
// replaces (see resolveWeaponStance) - e.g. the dragon 2h sword overrides all three to rest on the
// shoulder, while the scythe of vitur only has its own idle and keeps melee's default walk/run.
export type WeaponStance = {
    readonly idleSeqId?: number;
    readonly walkSeqId?: number;
    readonly runSeqId?: number;
};

// One entry per weapon tier: the item shown in hand and that tier's own basic attack. Lengths must
// match EQUIPMENT_PATHS' weapon ladders exactly - Equipment.ts derives its weapon itemIds arrays
// from these instead of duplicating them, so the two cannot drift apart.
export type WeaponTier = {
    readonly itemId: number;
    readonly basicAttack: AbilityDefinition;
    // undefined for a tier that plays the style's default stance unchanged (every ladder tier not
    // named below - real OSRS reuses the same one-handed/bow/staff stance across those tiers).
    readonly stance?: WeaponStance;
};

export const MELEE_WEAPON_LADDER: readonly WeaponTier[] = [
    { itemId: RUNE_SCIMITAR_ITEM_ID, basicAttack: SCIMITAR_SLASH },
    { itemId: DRAGON_SCIMITAR_ITEM_ID, basicAttack: DRAGON_SCIMITAR_SLASH },
    {
        itemId: DRAGON_2H_SWORD_ITEM_ID,
        basicAttack: DRAGON_2H_SWORD_SLASH,
        stance: {
            idleSeqId: DRAGON_2H_SWORD_IDLE_SEQ_ID,
            walkSeqId: DRAGON_2H_SWORD_WALK_SEQ_ID,
            runSeqId: DRAGON_2H_SWORD_RUN_SEQ_ID,
        },
    },
    {
        itemId: SCYTHE_OF_VITUR_ITEM_ID,
        basicAttack: SCYTHE_SWEEP,
        stance: { idleSeqId: SCYTHE_OF_VITUR_IDLE_SEQ_ID },
    },
];

export const RANGED_WEAPON_LADDER: readonly WeaponTier[] = [
    { itemId: SHORTBOW_ITEM_ID, basicAttack: BOW_SHOT },
    { itemId: MAGIC_SHORTBOW_ITEM_ID, basicAttack: MAGIC_SHORTBOW_SHOT },
    { itemId: BOW_OF_FAERDHINEN_ITEM_ID, basicAttack: BOW_OF_FAERDHINEN_SHOT },
    { itemId: TWISTED_BOW_ITEM_ID, basicAttack: TWISTED_BOW_SHOT },
];

export const MAGIC_WEAPON_LADDER: readonly WeaponTier[] = [
    { itemId: STAFF_ITEM_ID, basicAttack: MAGIC_BOLT },
    { itemId: WARPED_SCEPTRE_ITEM_ID, basicAttack: WARPED_SCEPTRE_BOLT },
    { itemId: SWAMP_TRIDENT_ITEM_ID, basicAttack: SWAMP_TRIDENT_BOLT },
    { itemId: TUMEKENS_SHADOW_ITEM_ID, basicAttack: TUMEKENS_SHADOW_BEAM },
];

export const WEAPON_LADDERS: Readonly<Record<WeaponStyle, readonly WeaponTier[]>> = {
    [WeaponStyle.MELEE]: MELEE_WEAPON_LADDER,
    [WeaponStyle.RANGED]: RANGED_WEAPON_LADDER,
    [WeaponStyle.MAGIC]: MAGIC_WEAPON_LADDER,
};

// A tier's own idle/walk/run, falling back field-by-field to the style's default stance (baked in
// ActorAssets' STANCE_SEQ_CONFIG) for whichever of the three a tier does not override.
export type WeaponStanceSeqIds = {
    readonly idleSeqId: number;
    readonly walkSeqId: number;
    readonly runSeqId: number;
};

export function resolveWeaponStance(
    styleDefault: WeaponStanceSeqIds,
    tier: WeaponTier,
): WeaponStanceSeqIds {
    return {
        idleSeqId: tier.stance?.idleSeqId ?? styleDefault.idleSeqId,
        walkSeqId: tier.stance?.walkSeqId ?? styleDefault.walkSeqId,
        runSeqId: tier.stance?.runSeqId ?? styleDefault.runSeqId,
    };
}

const SPECIAL_RECHARGE_SECONDS = 6;

// Both melee specials hit for twice the basic slash.
const MELEE_SPECIAL_DAMAGE = damagePayload(
    SCIMITAR_SLASH_DAMAGE.min * 2,
    SCIMITAR_SLASH_DAMAGE.max * 2,
);

const MELEE_SWEEP_DELIVERY = {
    kind: DeliveryKind.CONE,
    angleRadians: (2 * Math.PI) / 3,
    reach: 3 * 128,
    casterHalfWidth: 1.5 * 128,
    // Both specials aim at the ground point under the cursor, not whatever's hovered (see
    // ConeAim.POINT / aimModeFor) - a wide swing read wrong snapped onto a hovered body.
    aim: ConeAim.POINT,
} as const;

// The wide sweep's most-held frame reads as contact across the arc. Swaps the equipped weapon for
// the crystal halberd (see castItemOverride) and plays its own weapon-trail graphic on the caster,
// rotated to their facing (see VisualEffect.CRYSTAL_HALBERD_SPECIAL_SEQ_ID).
export const CLEAVE: AbilityDefinition = {
    id: "cleave",
    name: "Cleave",
    castSeqId: CLEAVE_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 1.3,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.55 }],
    castItemOverride: { itemId: CRYSTAL_HALBERD_ITEM_ID, hidesShield: true },
    effect: {
        delivery: MELEE_SWEEP_DELIVERY,
        affects: Affects.HOSTILE,
        payloads: [MELEE_SPECIAL_DAMAGE],
        casterEffect: {
            kind: VisualEffectKind.CRYSTAL_HALBERD_SPECIAL,
            height: 100,
            placement: SWEEP_AHEAD,
        },
    },
};

// The spell fires at the second, later charge-hold rather than the first (the raise/build-up).
export const ICE_BARRAGE: AbilityDefinition = {
    id: "ice_barrage",
    name: "Ice Barrage",
    castSeqId: ICE_BARRAGE_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 0.88,
    channelSeconds: 0,
    manaCost: 30,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.675 }],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 1, center: CircleCenter.TARGET },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(MAGIC_BOLT_DAMAGE), { kind: PayloadKind.FREEZE, seconds: 3 }],
        hitEffect: {
            kind: VisualEffectKind.ICE_BARRAGE_HIT,
            height: 100,
        },
    },
};

// Volley/Power Shot reuse the bow's basic-attack sequence and release point, played slower to
// fill each ability's own longer commit time.
export const VOLLEY: AbilityDefinition = {
    id: "volley",
    name: "Volley",
    castSeqId: BOW_SHOT_CAST_SEQ_ID,
    contactFrame: 5,
    castSpeed: 1.45,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.38 }],
    effect: {
        delivery: {
            kind: DeliveryKind.PROJECTILE,
            spec: VOLLEY_ARROW_SPEC,
            count: 8,
            spreadAngleRadians: Math.PI / 3,
        },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(ARROW_DAMAGE)],
    },
};

export const POWER_SHOT: AbilityDefinition = {
    id: "power_shot",
    name: "Power Shot",
    castSeqId: BOW_SHOT_CAST_SEQ_ID,
    contactFrame: 5,
    castSpeed: 1.45,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.38 }],
    effect: {
        delivery: singleShot(POWER_SHOT_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(20)],
    },
};

// The heal lands on the drink's last frame, as the bottle comes down; the HEAL lock is a pure
// re-use cooldown rather than a recovery animation, so the player is free to move as soon as the
// drink finishes.
export const HEALING_POTION: AbilityDefinition = {
    id: "healing_potion",
    name: "Healing Potion",
    castSeqId: HEALING_POTION_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 1.46,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 3,
    rechargeSeconds: 20,
    requires: [CooldownGroup.HEAL],
    locks: [
        { group: CooldownGroup.HEAL, seconds: 3 },
        { group: CooldownGroup.ATTACK, seconds: 1.5 },
    ],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 0, center: CircleCenter.CASTER },
        affects: Affects.SELF,
        payloads: [{ kind: PayloadKind.HEAL, amount: 30 }],
    },
};

// Enemy abilities play their cast sequence at natural speed: slowing them down to fill the attack
// cadence read as the enemy hanging in its top pose. The ATTACK lock carries the rest of the
// cadence as idle recovery once the animation has finished.
export const GOBLIN_MELEE_SEQ_ID = 6183;
export const TZ_KIH_MELEE_SEQ_ID = 2621;
export const TZ_KEK_MELEE_SEQ_ID = 2625;

// The chaff melee swing, one definition per rig since each rig's swing has its own contact frame.
function chaffMelee(
    id: string,
    name: string,
    castSeqId: number,
    contactFrame: number,
): AbilityDefinition {
    return {
        id,
        name,
        castSeqId,
        contactFrame,
        castSpeed: 1,
        channelSeconds: 0,
        manaCost: 0,
        maxCharges: 1,
        rechargeSeconds: 0,
        requires: [CooldownGroup.ATTACK],
        locks: [{ group: CooldownGroup.ATTACK, seconds: 1.84 }],
        effect: {
            delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
            affects: Affects.HOSTILE,
            payloads: [damagePayload(2, 5)],
        },
    };
}

export const GOBLIN_MELEE = chaffMelee("goblin_melee", "Goblin Melee", GOBLIN_MELEE_SEQ_ID, 5);
export const TZ_KIH_MELEE = chaffMelee("tz_kih_melee", "Tz-Kih Bite", TZ_KIH_MELEE_SEQ_ID, 9);
// Tz-Kek's mid-swing hold.
export const TZ_KEK_MELEE = chaffMelee("tz_kek_melee", "Tz-Kek Melee", TZ_KEK_MELEE_SEQ_ID, 5);

export const TOK_XIL_RANGED_SHOT_CAST_SEQ_ID = 2633;

// Tok-Xil's kiting band tops out at 7 tiles; the shot's range matches that band so it can always
// fire once in range, without needing a second number to keep in sync. Fires a real projectile
// (see TOK_XIL_SHOT_SPEC) instead of the old telegraphed ground strike. The second, later
// aim-hold is the shot's release.
export const TOK_XIL_RANGED_SHOT: AbilityDefinition = {
    id: "tok_xil_ranged_shot",
    name: "Tok-Xil Ranged Shot",
    castSeqId: TOK_XIL_RANGED_SHOT_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.46 }],
    effect: {
        delivery: singleShot(TOK_XIL_SHOT_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(4, 8)],
    },
};

export const KET_ZEK_FIRE_BLAST_CAST_SEQ_ID = 2647;

// Ket-Zek's casting band tops out at 10 tiles, matching the blast's range for the same reason as
// Tok-Xil above. Fires a real projectile (see KET_ZEK_FIRE_BLAST_SPEC) instead of the old
// telegraphed ground strike. The second, later cast-hold is the blast's release.
export const KET_ZEK_FIRE_BLAST: AbilityDefinition = {
    id: "ket_zek_fire_blast",
    name: "Ket-Zek Fire Blast",
    castSeqId: KET_ZEK_FIRE_BLAST_CAST_SEQ_ID,
    contactFrame: 11,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.63 }],
    effect: {
        delivery: singleShot(KET_ZEK_FIRE_BLAST_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(14, 22)],
    },
};

export const YT_MEJKOT_MELEE_CAST_SEQ_ID = 2637;

// The held pose right after the fast swing is the contact hold.
export const YT_MEJKOT_MELEE: AbilityDefinition = {
    id: "yt_mejkot_melee",
    name: "Yt-MejKot Slam",
    castSeqId: YT_MEJKOT_MELEE_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2.4 }],
    effect: {
        delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(5, 9)],
    },
};

// Uses the HEAL cooldown group (not ATTACK) so the pulse recurs on its own 6s timer independently
// of Yt-MejKot's melee swings. castSeqId is provisional (2639, from the same animation block as
// its idle/walk/death/melee seqs 2636-2638/2637) pending visual confirmation with the anim viewer.
export const YT_MEJKOT_HEAL_SEQ_ID = 2639;

// The heal sequence has no single standout hold (a fairly uniform raise into a slightly longer
// close), so the release frame is a judgment call: the first of the longer closing frames.
export const YT_MEJKOT_HEAL_PULSE: AbilityDefinition = {
    id: "yt_mejkot_heal_pulse",
    name: "Yt-MejKot Heal Pulse",
    castSeqId: YT_MEJKOT_HEAL_SEQ_ID,
    contactFrame: 6,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.HEAL],
    locks: [{ group: CooldownGroup.HEAL, seconds: 6 }],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 4, center: CircleCenter.CASTER },
        affects: Affects.ALLIED,
        payloads: [{ kind: PayloadKind.HEAL, amount: 15 }],
        hitEffect: { kind: VisualEffectKind.TZHAAR_HEAL, height: 120 },
    },
};

// Elder maul special attack (obj 21003): a wide overhead smash in front of the caster, verified
// against the cache with a throwaway script (seq 7514, in the same animation block as the elder
// maul's normal attack, seq 7516).
export const MAUL_SMASH_CAST_SEQ_ID = 11124;
const MAUL_SMASH_RECHARGE_SECONDS = 10;

// Frame 10 is only the 40 ms downswing transient (the maul snapping through); frame 11, held for
// 100 ms from 1.02 s in, is the impact pose, so contact lands there. The rest is recovery under
// the ATTACK lock, so the hit lands as the maul comes down instead of after it's already back up.
export const MAUL_SMASH: AbilityDefinition = {
    id: "maul_smash",
    name: "Maul Smash",
    castSeqId: MAUL_SMASH_CAST_SEQ_ID,
    contactFrame: 11,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: MAUL_SMASH_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1.6 }],
    castItemOverride: { itemId: ELDER_MAUL_ITEM_ID, hidesShield: true },
    effect: {
        delivery: MELEE_SWEEP_DELIVERY,
        affects: Affects.HOSTILE,
        payloads: [MELEE_SPECIAL_DAMAGE],
        // Two impact graphics both read well in the per-tile placement and the owner has not
        // picked one yet: MAUL_IMPACT_SPARK (2805, the elder maul special's own ground sparks)
        // and DUST_WAVE (2184, Zebak's roar dust, swap in with DUST_WAVE_SEQ_ID). Both stay baked.
        hitEffect: {
            kind: VisualEffectKind.MAUL_IMPACT_SPARK,
            height: 0,
        },
    },
};

// TzTok-Jad's three attacks, verified from the cache (see EnemyType.ts's TZTOK_JAD comment for how
// the cast seq ids were picked). Cycled in a fixed pattern (see EnemyType.BossPattern) rather than
// picked by priority, so each ability's own ATTACK lock just needs to cover its own recovery
// before the pattern's next entry becomes eligible, not to sequence the attacks itself.

export const JAD_MELEE_BITE_CAST_SEQ_ID = 2655;

// The jaw-closed hold (the longer of its two holds) is the bite connecting.
export const JAD_MELEE_BITE: AbilityDefinition = {
    id: "jad_melee_bite",
    name: "TzTok-Jad Bite",
    castSeqId: JAD_MELEE_BITE_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2.92 }],
    effect: {
        delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(20, 35)],
    },
};

export const JAD_RANGED_STOMP_CAST_SEQ_ID = 2652;

// The frames accelerate into a quick 2-tick frame right as the rock launches.
export const JAD_RANGED_STOMP: AbilityDefinition = {
    id: "jad_ranged_stomp",
    name: "TzTok-Jad Stomp",
    castSeqId: JAD_RANGED_STOMP_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.14 }],
    effect: {
        delivery: singleShot(JAD_RANGED_ROCK_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(30, 45)],
    },
};

export const JAD_MAGE_BLAST_CAST_SEQ_ID = 2656;

// Uniform frame lengths with no distinct hold to read, so the contact frame is ~55% through the
// build-up, the rule of thumb used when the frame data has no standout hold.
export const JAD_MAGE_BLAST: AbilityDefinition = {
    id: "jad_mage_blast",
    name: "TzTok-Jad Mage Blast",
    castSeqId: JAD_MAGE_BLAST_CAST_SEQ_ID,
    contactFrame: 17,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.29 }],
    effect: {
        delivery: singleShot(JAD_MAGE_BLAST_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(25, 40)],
        hitEffect: { kind: VisualEffectKind.JAD_FIRE_HIT, height: 124 },
    },
};

// Yt-HurKot: same heal pulse as Yt-MejKot but bigger, reusing the shared heal cast seq (see
// EnemyType.ts's YT_HURKOT comment).
export const YT_HURKOT_HEAL_PULSE: AbilityDefinition = {
    id: "yt_hurkot_heal_pulse",
    name: "Yt-HurKot Heal Pulse",
    castSeqId: YT_MEJKOT_HEAL_SEQ_ID,
    contactFrame: 6,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.HEAL],
    locks: [{ group: CooldownGroup.HEAL, seconds: 6 }],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 4, center: CircleCenter.CASTER },
        affects: Affects.ALLIED,
        payloads: [{ kind: PayloadKind.HEAL, amount: 30 }],
        hitEffect: { kind: VisualEffectKind.TZHAAR_HEAL, height: 120 },
    },
};

export type PlayerLoadout<TAbility> = {
    // One basic attack per weapon tier (see WEAPON_LADDERS) - which one is active depends on the
    // player's currently-equipped tier for this style, not just the style itself.
    readonly basicAttackByTier: readonly TAbility[];
    readonly skills: readonly TAbility[];
};

export type PlayerLoadoutsByStyle<TAbility> = Record<WeaponStyle, PlayerLoadout<TAbility>>;

const ALL_STYLES: readonly WeaponStyle[] = [
    WeaponStyle.MELEE,
    WeaponStyle.RANGED,
    WeaponStyle.MAGIC,
];

// Every ability the player can ever cast, across every style - the composition point for the
// bake-time item/seq enumeration in ActorAssets (cast-item overrides, weapon-ladder attack seqs),
// so nothing there needs its own separate list of ability ids to stay in sync with this file.
export function allPlayerAbilities(): readonly AbilityDefinition[] {
    return ALL_STYLES.flatMap((style) => {
        const loadout = buildPlayerLoadout(style);
        return [...loadout.basicAttackByTier, ...loadout.skills];
    });
}

// Every cast-item override, keyed by its ability's own cast seq id - the runtime-facing lookup
// WebGLMapViewerRenderer uses (from the player's current animation.seqId) to find the item override
// to pass into Equipment.equippedVisualItemIds, so nothing outside this file hardcodes which
// ability has one.
export const CAST_ITEM_OVERRIDES_BY_SEQ_ID: ReadonlyMap<number, CastItemOverride> = new Map(
    allPlayerAbilities()
        .filter(
            (ability): ability is AbilityDefinition & { castItemOverride: CastItemOverride } =>
                ability.castItemOverride !== undefined,
        )
        .map((ability) => [ability.castSeqId, ability.castItemOverride]),
);

export function buildPlayerLoadout(style: WeaponStyle): PlayerLoadout<AbilityDefinition> {
    const basicAttackByTier = WEAPON_LADDERS[style].map((tier) => tier.basicAttack);
    switch (style) {
        case WeaponStyle.MELEE:
            return { basicAttackByTier, skills: [CLEAVE, MAUL_SMASH, HEALING_POTION] };
        case WeaponStyle.MAGIC:
            return { basicAttackByTier, skills: [ICE_BARRAGE, HEALING_POTION] };
        case WeaponStyle.RANGED:
            return { basicAttackByTier, skills: [VOLLEY, POWER_SHOT, HEALING_POTION] };
    }
}

// The composition point for the player's loadouts: every cast sequence is resolved here, once per
// encounter load, so nothing downstream looks a sequence up.
export function resolvePlayerLoadouts(catalog: SeqCatalog): PlayerLoadoutsByStyle<ResolvedAbility> {
    const resolveLoadout = (style: WeaponStyle): PlayerLoadout<ResolvedAbility> => {
        const loadout = buildPlayerLoadout(style);
        return {
            basicAttackByTier: loadout.basicAttackByTier.map((definition) =>
                resolveAbility(definition, catalog),
            ),
            skills: loadout.skills.map((definition) => resolveAbility(definition, catalog)),
        };
    };
    return {
        [WeaponStyle.MELEE]: resolveLoadout(WeaponStyle.MELEE),
        [WeaponStyle.MAGIC]: resolveLoadout(WeaponStyle.MAGIC),
        [WeaponStyle.RANGED]: resolveLoadout(WeaponStyle.RANGED),
    };
}
