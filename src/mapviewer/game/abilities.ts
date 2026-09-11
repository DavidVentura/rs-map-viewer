import { AbilityDefinition, AbilityEffectKind, CooldownGroup, WeaponStyle } from "./Ability";
import {
    ARROW_SPEC,
    JAD_MAGE_BLAST_SPEC,
    JAD_RANGED_ROCK_SPEC,
    KET_ZEK_FIRE_BLAST_SPEC,
    MAGIC_SPEC,
    POWER_SHOT_SPEC,
    TOK_XIL_SHOT_SPEC,
    VOLLEY_ARROW_SPEC,
} from "./Projectile";
import {
    ICE_BARRAGE_HIT_SEQ_ID,
    MAUL_SMASH_HIT_SEQ_ID,
    TZHAAR_HEAL_SEQ_ID,
    VisualEffectKind,
} from "./VisualEffect";

export const ICE_BARRAGE_CAST_SEQ_ID = 1979;
export const CLEAVE_CAST_SEQ_ID = 1203;
export const HEALING_POTION_CAST_SEQ_ID = 829;

// Impact/castSpeed derivation for the player abilities below (kept as originally tuned - see
// abilities.ts's file header history): the old windupSeconds+lock duration is kept as the
// ability's total commit-to-next-use time, but the swing's damage lands at the animation's visual
// contact frame (found from the cache's per-frame lengths via scripts/cache/anim-table.ts) instead
// of at the very end, with the rest of the animation playing as recovery through the ATTACK lock's
// own seconds. castSpeed is whatever multiplier makes the seq's natural length fill that same
// total time (naturalSeconds / (oldWindup + oldLock)), so the swing is no longer sped up as
// aggressively as when the whole animation had to fit in just the windup. animationSeconds below
// is that same naturalSeconds figure, now an explicit field instead of only living in this
// comment: it's what castAnimationSeconds() divides by castSpeed to know when the cast sequence
// itself finishes (see Ability.ts). Bow shot (seq 426, 1.16s natural): release sits at the
// string-snap frame (frame 5, 53%).
export const BOW_SHOT: AbilityDefinition = {
    id: "bow_shot",
    name: "Bow Shot",
    impactSeconds: 0.21,
    channelSeconds: 0,
    animationSeconds: 1.16,
    castSpeed: 2.9,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: { kind: AbilityEffectKind.PROJECTILE, spec: ARROW_SPEC },
};

// Magic bolt (seq 711, 1.48s natural): release at the second cast-hold (frame 9, 69%).
export const MAGIC_BOLT: AbilityDefinition = {
    id: "magic_bolt",
    name: "Magic Bolt",
    impactSeconds: 0.41,
    channelSeconds: 0,
    animationSeconds: 1.48,
    castSpeed: 2.47,
    manaCost: 10,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: { kind: AbilityEffectKind.PROJECTILE, spec: MAGIC_SPEC },
};

// Scimitar slash (seq 390, 0.78s natural): contact at the extended-arm hold after the fast
// downswing (frame 8, 72%).
export const SCIMITAR_SLASH: AbilityDefinition = {
    id: "scimitar_slash",
    name: "Scimitar Slash",
    impactSeconds: 0.36,
    channelSeconds: 0,
    animationSeconds: 0.78,
    castSpeed: 1.56,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.14 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 4, maxDamage: 9, reach: 48 },
};

export function getStyleAttack(style: WeaponStyle): AbilityDefinition {
    switch (style) {
        case WeaponStyle.RANGED:
            return BOW_SHOT;
        case WeaponStyle.MAGIC:
            return MAGIC_BOLT;
        case WeaponStyle.MELEE:
            return SCIMITAR_SLASH;
    }
}

const SPECIAL_RECHARGE_SECONDS = 6;

// Cleave (seq 1203, 1.04s natural): the wide sweep's most-held frame (frame 9, 31%) reads as
// contact across the arc.
export const CLEAVE: AbilityDefinition = {
    id: "cleave",
    name: "Cleave",
    impactSeconds: 0.25,
    channelSeconds: 0,
    animationSeconds: 1.04,
    castSpeed: 1.3,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.55 }],
    castSeqId: CLEAVE_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.CONE_MELEE,
        damageMultiplier: 2,
        angleRadians: Math.PI / 2,
        reach: 2.5 * 128,
    },
};

// Ice barrage (seq 1979, 1.32s natural): the spell fires at the second, later charge-hold
// (frame 8, 55%) rather than the first (which is the raise/build-up).
export const ICE_BARRAGE: AbilityDefinition = {
    id: "ice_barrage",
    name: "Ice Barrage",
    impactSeconds: 0.825,
    channelSeconds: 0,
    animationSeconds: 1.32,
    castSpeed: 0.88,
    manaCost: 30,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.675 }],
    castSeqId: ICE_BARRAGE_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.AREA,
        radiusTiles: 1,
        damageMin: MAGIC_SPEC.damage,
        damageMax: MAGIC_SPEC.damage,
        freezeSeconds: 3,
        hitEffect: {
            kind: VisualEffectKind.ICE_BARRAGE_HIT,
            seqId: ICE_BARRAGE_HIT_SEQ_ID,
            height: 100,
        },
    },
};

// Volley/Power Shot both reuse the bow's basic-attack seq (426); same release point as Bow Shot
// (frame 5, 53%), scaled to each ability's own total commit time.
export const VOLLEY: AbilityDefinition = {
    id: "volley",
    name: "Volley",
    impactSeconds: 0.42,
    channelSeconds: 0,
    animationSeconds: 1.16,
    castSpeed: 1.45,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.38 }],
    effect: {
        kind: AbilityEffectKind.MULTI_PROJECTILE,
        spec: VOLLEY_ARROW_SPEC,
        count: 8,
        spreadAngleRadians: Math.PI / 3,
    },
};

export const POWER_SHOT: AbilityDefinition = {
    id: "power_shot",
    name: "Power Shot",
    impactSeconds: 0.42,
    channelSeconds: 0,
    animationSeconds: 1.16,
    castSpeed: 1.45,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.38 }],
    effect: { kind: AbilityEffectKind.PROJECTILE, spec: POWER_SHOT_SPEC },
};

// Heal effects resolve at the end of the drink (impactSeconds unchanged from the old
// windupSeconds); castSpeed is only derived so the seq 829 drink animation (1.46s natural) fills
// that same time instead of being computed dynamically at runtime. Unlike the ATTACK-locked
// abilities above, castAnimationSeconds (1.46 / 1.46 = 1s) now lands almost exactly on
// impactSeconds itself rather than on impact+lock, since there's no ATTACK lock to give a
// recovery portion to play through - the HEAL lock below is a pure re-use cooldown, not a
// recovery animation, so once the drink finishes the player is free to move immediately.
export const HEALING_POTION: AbilityDefinition = {
    id: "healing_potion",
    name: "Healing Potion",
    impactSeconds: 1,
    channelSeconds: 0,
    animationSeconds: 1.46,
    castSpeed: 1.46,
    manaCost: 0,
    maxCharges: 3,
    rechargeSeconds: 20,
    requires: [CooldownGroup.HEAL],
    locks: [
        { group: CooldownGroup.HEAL, seconds: 3 },
        { group: CooldownGroup.ATTACK, seconds: 1.5 },
    ],
    castSeqId: HEALING_POTION_CAST_SEQ_ID,
    effect: { kind: AbilityEffectKind.HEAL, amount: 30 },
};

// Enemy abilities below all play their cast sequence at castSpeed 1 (natural speed) instead of the
// old per-ability slowdown (0.27x-0.99x) that stretched the whole animation to fill the old
// windup+lock window - that read as the enemy hanging in its top pose for way too long.
// impactSeconds now lands on the animation's own visual contact frame (from per-frame tick lengths
// dumped with a throwaway script modelled on scripts/cache/anim-table.ts), and animationSeconds is
// that sequence's natural length, so castAnimationSeconds (animationSeconds / castSpeed, see
// Ability.ts) is the point past which Enemy.ts falls back to idle instead of holding the cast's
// last frame. Each ability's ATTACK lock is widened so impactSeconds + lock still equals the old
// windup + lock total (i.e. the same overall attack cadence as before), so the difference between
// the (now much shorter) animation and that total plays out as idle recovery, not as a frozen pose.
//
// Shared by goblin/Tz-Kih/Tz-Kek, whose attack seqs run from 0.6s to 1.9s natural; Tz-Kek's (seq
// 2625, 1.16s) is the most legible of the three so its mid-swing hold (frame 5, 48%) is the
// reference point for both impactSeconds and animationSeconds, applied uniformly since the ability
// itself has one impact/animation time regardless of which enemy type is casting it (same
// simplification the old single windupSeconds already made). This under/over-shoots the other two
// enemies' own seqs a little: the goblin's real 1.9s swing will start showing idle a bit before its
// own animation would otherwise finish, and Tz-Kih's real 0.6s swing briefly holds its last frame
// for ~0.6s before switching to idle - both far short of the old multi-second freeze.
export const ENEMY_MELEE: AbilityDefinition = {
    id: "enemy_melee",
    name: "Enemy Melee",
    impactSeconds: 0.56,
    channelSeconds: 0,
    animationSeconds: 1.16,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1.84 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 2, maxDamage: 5, reach: 48 },
};

// Tok-Xil's kiting band tops out at 7 tiles; the shot's range matches that band so it can always
// fire once in range, without needing a second number to keep in sync. Fires a real projectile
// (see TOK_XIL_SHOT_SPEC) instead of the old telegraphed ground strike. Cast seq 2633 (Tok-Xil's
// own castSeqId, 1.58s natural): the second, later aim-hold (frame 9, 72%) is the shot's release.
export const TOK_XIL_RANGED_SHOT: AbilityDefinition = {
    id: "tok_xil_ranged_shot",
    name: "Tok-Xil Ranged Shot",
    impactSeconds: 1.14,
    channelSeconds: 0,
    animationSeconds: 1.58,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.46 }],
    effect: {
        kind: AbilityEffectKind.PROJECTILE,
        spec: TOK_XIL_SHOT_SPEC,
        damageMin: 4,
        damageMax: 8,
    },
};

// Ket-Zek's casting band tops out at 10 tiles, matching the blast's range for the same reason as
// Tok-Xil above. Fires a real projectile (see KET_ZEK_FIRE_BLAST_SPEC) instead of the old
// telegraphed ground strike. Cast seq 2647 (Ket-Zek's own castSeqId, 1.3s natural): the second,
// later cast-hold (frame 11, 82%) is the blast's release.
export const KET_ZEK_FIRE_BLAST: AbilityDefinition = {
    id: "ket_zek_fire_blast",
    name: "Ket-Zek Fire Blast",
    impactSeconds: 1.07,
    channelSeconds: 0,
    animationSeconds: 1.3,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.63 }],
    effect: {
        kind: AbilityEffectKind.PROJECTILE,
        spec: KET_ZEK_FIRE_BLAST_SPEC,
        damageMin: 14,
        damageMax: 22,
    },
};

// Yt-MejKot slam (seq 2637, 0.76s natural): the held pose right after the fast swing (frame 8,
// 53%) is the contact hold.
export const YT_MEJKOT_MELEE: AbilityDefinition = {
    id: "yt_mejkot_melee",
    name: "Yt-MejKot Slam",
    impactSeconds: 0.4,
    channelSeconds: 0,
    animationSeconds: 0.76,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2.4 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 5, maxDamage: 9, reach: 48 },
};

// Uses the HEAL cooldown group (not ATTACK) so the pulse recurs on its own 6s timer independently
// of Yt-MejKot's melee swings. castSeqId is provisional (2639, from the same animation block as
// its idle/walk/death/melee seqs 2636-2638/2637) pending visual confirmation with the anim viewer.
export const YT_MEJKOT_HEAL_SEQ_ID = 2639;

// Seq 2639 (0.76s natural) has no single standout hold - it's a fairly uniform raise into a
// slightly longer close, so the release point is a judgment call rather than a frame-data pick:
// ~55% of the sequence, same as Jad's mage blast below.
export const YT_MEJKOT_HEAL_PULSE: AbilityDefinition = {
    id: "yt_mejkot_heal_pulse",
    name: "Yt-MejKot Heal Pulse",
    impactSeconds: 0.42,
    channelSeconds: 0,
    animationSeconds: 0.76,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.HEAL],
    locks: [{ group: CooldownGroup.HEAL, seconds: 6 }],
    castSeqId: YT_MEJKOT_HEAL_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.HEAL_ALLIES,
        radiusTiles: 4,
        amount: 15,
        hitEffect: { kind: VisualEffectKind.TZHAAR_HEAL, seqId: TZHAAR_HEAL_SEQ_ID, height: 120 },
    },
};

// Elder maul special attack (obj 21003): a wide overhead smash in front of the caster, verified
// against the cache with a throwaway script (seq 7514, in the same animation block as the elder
// maul's normal attack, seq 7516).
export const MAUL_SMASH_CAST_SEQ_ID = 11124;
const MAUL_SMASH_RECHARGE_SECONDS = 10;

// Played at half natural speed for a weightier overhead smash (seq 11124, 1.78s natural -> 3.56s
// played). The fast, short frame right after the raise (frame 10, 55%) is the downswing snapping
// through into impact; the remaining ~1.6s is recovery, covered by the ATTACK lock rather than a
// blocking windup, so the hit lands as the maul comes down instead of after it's already back up.
export const MAUL_SMASH: AbilityDefinition = {
    id: "maul_smash",
    name: "Maul Smash",
    impactSeconds: 1.96,
    channelSeconds: 0,
    animationSeconds: 1.78,
    castSpeed: 0.5,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: MAUL_SMASH_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1.6 }],
    castSeqId: MAUL_SMASH_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.CONE_MELEE,
        damageMultiplier: 2,
        angleRadians: (2 * Math.PI) / 3,
        reach: 3 * 128,
        hitEffect: {
            kind: VisualEffectKind.MAUL_SMASH_HIT,
            seqId: MAUL_SMASH_HIT_SEQ_ID,
            height: 0,
        },
    },
};

// TzTok-Jad's three attacks, verified from the cache (see EnemyType.ts's TZTOK_JAD comment for how
// the cast seq ids were picked). Cycled in a fixed pattern (see EnemyType.BossPattern) rather than
// picked by priority, so each ability's own ATTACK lock just needs to cover its own recovery
// (impactSeconds + this lock == the old windup + the old shared 2.5s recharge, see this file's
// enemy-abilities comment above ENEMY_MELEE for the current castSpeed-1 derivation) before the
// pattern's next entry becomes eligible, not to sequence the attacks itself.

export const JAD_MELEE_BITE_CAST_SEQ_ID = 2655;

// Jad's bite (seq 2655, 1.44s natural): the jaw-closed hold (frame 8, 54%, the longer of its two
// holds) is the bite connecting.
export const JAD_MELEE_BITE: AbilityDefinition = {
    id: "jad_melee_bite",
    name: "TzTok-Jad Bite",
    impactSeconds: 0.78,
    channelSeconds: 0,
    animationSeconds: 1.44,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2.92 }],
    castSeqId: JAD_MELEE_BITE_CAST_SEQ_ID,
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 20, maxDamage: 35, reach: 48 },
};

export const JAD_RANGED_STOMP_CAST_SEQ_ID = 2652;

// Jad's stomp (seq 2652, 1.1s natural): frames accelerate into a quick 2-tick frame (frame 8, 69%)
// right as the rock launches.
export const JAD_RANGED_STOMP: AbilityDefinition = {
    id: "jad_ranged_stomp",
    name: "TzTok-Jad Stomp",
    impactSeconds: 0.76,
    channelSeconds: 0,
    animationSeconds: 1.1,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.14 }],
    castSeqId: JAD_RANGED_STOMP_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.PROJECTILE,
        spec: JAD_RANGED_ROCK_SPEC,
        damageMin: 30,
        damageMax: 45,
    },
};

export const JAD_MAGE_BLAST_CAST_SEQ_ID = 2656;

// Jad's mage blast (seq 2656, 3.1s natural, uniform frame lengths - no distinct hold to read): the
// contact frame is unclear from the frame data, so this uses ~55% of the sequence per the general
// rule of thumb for a build-up with no standout hold.
export const JAD_MAGE_BLAST: AbilityDefinition = {
    id: "jad_mage_blast",
    name: "TzTok-Jad Mage Blast",
    impactSeconds: 1.71,
    channelSeconds: 0,
    animationSeconds: 3.1,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.29 }],
    castSeqId: JAD_MAGE_BLAST_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.PROJECTILE,
        spec: JAD_MAGE_BLAST_SPEC,
        damageMin: 25,
        damageMax: 40,
    },
};

// Yt-HurKot: same heal pulse as Yt-MejKot but bigger, reusing the shared heal cast seq (see
// EnemyType.ts's YT_HURKOT comment).
export const YT_HURKOT_HEAL_PULSE: AbilityDefinition = {
    id: "yt_hurkot_heal_pulse",
    name: "Yt-HurKot Heal Pulse",
    impactSeconds: 0.42,
    channelSeconds: 0,
    animationSeconds: 0.76,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.HEAL],
    locks: [{ group: CooldownGroup.HEAL, seconds: 6 }],
    castSeqId: YT_MEJKOT_HEAL_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.HEAL_ALLIES,
        radiusTiles: 4,
        amount: 30,
        hitEffect: { kind: VisualEffectKind.TZHAAR_HEAL, seqId: TZHAAR_HEAL_SEQ_ID, height: 120 },
    },
};

export function buildPlayerAbilityBar(style: WeaponStyle): readonly AbilityDefinition[] {
    switch (style) {
        case WeaponStyle.MELEE:
            return [SCIMITAR_SLASH, CLEAVE, MAUL_SMASH, HEALING_POTION];
        case WeaponStyle.MAGIC:
            return [MAGIC_BOLT, ICE_BARRAGE, HEALING_POTION];
        case WeaponStyle.RANGED:
            return [BOW_SHOT, VOLLEY, POWER_SHOT, HEALING_POTION];
    }
}
