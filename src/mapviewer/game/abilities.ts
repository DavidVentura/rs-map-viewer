import { AbilityDefinition, AbilityEffectKind, CooldownGroup, WeaponStyle } from "./Ability";
import {
    ARROW_SPEC,
    JAD_MAGE_BLAST_SPEC,
    JAD_RANGED_ROCK_SPEC,
    MAGIC_SPEC,
    POWER_SHOT_SPEC,
    VOLLEY_ARROW_SPEC,
} from "./Projectile";
import { ICE_BARRAGE_HIT_SEQ_ID, TZHAAR_HEAL_SEQ_ID, VisualEffectKind } from "./VisualEffect";

export const ICE_BARRAGE_CAST_SEQ_ID = 1979;
export const CLEAVE_CAST_SEQ_ID = 1203;
export const HEALING_POTION_CAST_SEQ_ID = 829;

export const BOW_SHOT: AbilityDefinition = {
    id: "bow_shot",
    name: "Bow Shot",
    windupSeconds: 0.2,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.2 }],
    effect: { kind: AbilityEffectKind.PROJECTILE, spec: ARROW_SPEC },
};

export const MAGIC_BOLT: AbilityDefinition = {
    id: "magic_bolt",
    name: "Magic Bolt",
    windupSeconds: 0.3,
    channelSeconds: 0,
    manaCost: 10,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.3 }],
    effect: { kind: AbilityEffectKind.PROJECTILE, spec: MAGIC_SPEC },
};

export const SCIMITAR_SLASH: AbilityDefinition = {
    id: "scimitar_slash",
    name: "Scimitar Slash",
    windupSeconds: 0.3,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.2 }],
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

export const CLEAVE: AbilityDefinition = {
    id: "cleave",
    name: "Cleave",
    windupSeconds: 0.6,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.2 }],
    castSeqId: CLEAVE_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.CONE_MELEE,
        damageMultiplier: 2,
        angleRadians: Math.PI / 2,
        reach: 2.5 * 128,
    },
};

export const ICE_BARRAGE: AbilityDefinition = {
    id: "ice_barrage",
    name: "Ice Barrage",
    windupSeconds: 1.2,
    channelSeconds: 0,
    manaCost: 30,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.3 }],
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

export const VOLLEY: AbilityDefinition = {
    id: "volley",
    name: "Volley",
    windupSeconds: 0.6,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.2 }],
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
    windupSeconds: 0.6,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.2 }],
    effect: { kind: AbilityEffectKind.PROJECTILE, spec: POWER_SHOT_SPEC },
};

export const HEALING_POTION: AbilityDefinition = {
    id: "healing_potion",
    name: "Healing Potion",
    windupSeconds: 1,
    channelSeconds: 0,
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

export const ENEMY_MELEE: AbilityDefinition = {
    id: "enemy_melee",
    name: "Enemy Melee",
    windupSeconds: 0.6,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1.8 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 2, maxDamage: 5, reach: 48 },
};

// Tok-Xil's kiting band tops out at 7 tiles; the strike's cast range matches that band so it can
// always fire once in range, without needing a second number to keep in sync.
export const TOK_XIL_GROUND_STRIKE: AbilityDefinition = {
    id: "tok_xil_ground_strike",
    name: "Tok-Xil Ground Strike",
    windupSeconds: 0.4,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1.2 }],
    effect: {
        kind: AbilityEffectKind.GROUND_STRIKE,
        radiusTiles: 0.5,
        telegraphSeconds: 0.6,
        damageMin: 4,
        damageMax: 8,
        range: 11 * 128,
    },
};

// Ket-Zek's casting band tops out at 10 tiles, matching the strike's cast range for the same
// reason as Tok-Xil above.
export const KET_ZEK_GROUND_STRIKE: AbilityDefinition = {
    id: "ket_zek_ground_strike",
    name: "Ket-Zek Ground Strike",
    windupSeconds: 1.2,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.5 }],
    effect: {
        kind: AbilityEffectKind.GROUND_STRIKE,
        radiusTiles: 1,
        telegraphSeconds: 1.4,
        damageMin: 14,
        damageMax: 22,
        range: 10 * 128,
    },
};

export const YT_MEJKOT_MELEE: AbilityDefinition = {
    id: "yt_mejkot_melee",
    name: "Yt-MejKot Slam",
    windupSeconds: 0.8,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 5, maxDamage: 9, reach: 48 },
};

// Uses the HEAL cooldown group (not ATTACK) so the pulse recurs on its own 6s timer independently
// of Yt-MejKot's melee swings. castSeqId is provisional (2639, from the same animation block as
// its idle/walk/death/melee seqs 2636-2638/2637) pending visual confirmation with the anim viewer.
export const YT_MEJKOT_HEAL_SEQ_ID = 2639;

export const YT_MEJKOT_HEAL_PULSE: AbilityDefinition = {
    id: "yt_mejkot_heal_pulse",
    name: "Yt-MejKot Heal Pulse",
    windupSeconds: 0.4,
    channelSeconds: 0,
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

export const MAUL_SMASH: AbilityDefinition = {
    id: "maul_smash",
    name: "Maul Smash",
    windupSeconds: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: MAUL_SMASH_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.2 }],
    castSeqId: MAUL_SMASH_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.CONE_MELEE,
        damageMultiplier: 2,
        angleRadians: (2 * Math.PI) / 3,
        reach: 3 * 128,
    },
};

// TzTok-Jad's three attacks, verified from the cache (see EnemyType.ts's TZTOK_JAD comment for how
// the cast seq ids were picked). Cycled in a fixed pattern (see EnemyType.BossPattern) rather than
// picked by priority, so each ability's own lock just needs to cover the recovery pause before the
// pattern's next entry becomes eligible, not to sequence the attacks itself.
const JAD_ATTACK_RECHARGE_SECONDS = 2.5;

export const JAD_MELEE_BITE_CAST_SEQ_ID = 2655;

export const JAD_MELEE_BITE: AbilityDefinition = {
    id: "jad_melee_bite",
    name: "TzTok-Jad Bite",
    windupSeconds: 1.2,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: JAD_ATTACK_RECHARGE_SECONDS }],
    castSeqId: JAD_MELEE_BITE_CAST_SEQ_ID,
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 20, maxDamage: 35, reach: 48 },
};

export const JAD_RANGED_STOMP_CAST_SEQ_ID = 2652;

export const JAD_RANGED_STOMP: AbilityDefinition = {
    id: "jad_ranged_stomp",
    name: "TzTok-Jad Stomp",
    windupSeconds: 1.4,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: JAD_ATTACK_RECHARGE_SECONDS }],
    castSeqId: JAD_RANGED_STOMP_CAST_SEQ_ID,
    effect: {
        kind: AbilityEffectKind.PROJECTILE,
        spec: JAD_RANGED_ROCK_SPEC,
        damageMin: 30,
        damageMax: 45,
    },
};

export const JAD_MAGE_BLAST_CAST_SEQ_ID = 2656;

export const JAD_MAGE_BLAST: AbilityDefinition = {
    id: "jad_mage_blast",
    name: "TzTok-Jad Mage Blast",
    windupSeconds: 1.5,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: JAD_ATTACK_RECHARGE_SECONDS + 1 }],
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
    windupSeconds: 0.4,
    channelSeconds: 0,
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
