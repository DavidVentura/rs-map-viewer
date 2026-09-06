import { AbilityDefinition, AbilityEffectKind, CooldownGroup, WeaponStyle } from "./Ability";
import { ARROW_SPEC, MAGIC_SPEC, POWER_SHOT_SPEC } from "./Projectile";
import { ICE_BARRAGE_HIT_SEQ_ID, VisualEffectKind } from "./VisualEffect";

export const ICE_BARRAGE_CAST_SEQ_ID = 1979;
export const CLEAVE_CAST_SEQ_ID = 1203;
export const HEALING_POTION_CAST_SEQ_ID = 829;
export const IMBUED_HEART_SWITCH_SEQ_ID = 7660;
export const DRAGON_BATTLEAXE_SWITCH_SEQ_ID = 1056;

export const STYLE_SWITCH_SEQ_IDS: Partial<Record<WeaponStyle, number>> = {
    [WeaponStyle.MAGIC]: IMBUED_HEART_SWITCH_SEQ_ID,
    [WeaponStyle.MELEE]: DRAGON_BATTLEAXE_SWITCH_SEQ_ID,
};

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
        spec: ARROW_SPEC,
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
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1.2 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 2, maxDamage: 6, reach: 48 },
};

export function buildPlayerAbilityBar(style: WeaponStyle): readonly AbilityDefinition[] {
    switch (style) {
        case WeaponStyle.MELEE:
            return [SCIMITAR_SLASH, CLEAVE, HEALING_POTION];
        case WeaponStyle.MAGIC:
            return [MAGIC_BOLT, ICE_BARRAGE, HEALING_POTION];
        case WeaponStyle.RANGED:
            return [BOW_SHOT, VOLLEY, POWER_SHOT, HEALING_POTION];
    }
}
