import { AbilityDefinition, AbilityEffectKind, CooldownGroup, Stance } from "./Ability";
import { ARROW_SPEC, MAGIC_SPEC } from "./Projectile";

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
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.6 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 4, maxDamage: 9, reach: 48 },
};

export function getStanceAttack(stance: Stance): AbilityDefinition {
    switch (stance) {
        case Stance.RANGED:
            return BOW_SHOT;
        case Stance.MAGIC:
            return MAGIC_BOLT;
        case Stance.MELEE:
            return SCIMITAR_SLASH;
    }
}

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
    effect: { kind: AbilityEffectKind.HEAL, amount: 30 },
};

export const SWITCH_TO_BOW: AbilityDefinition = {
    id: "switch_to_bow",
    name: "Ready Bow",
    windupSeconds: 0,
    channelSeconds: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: { kind: AbilityEffectKind.STANCE, stance: Stance.RANGED },
};

export const SWITCH_TO_STAFF: AbilityDefinition = {
    id: "switch_to_staff",
    name: "Ready Staff",
    windupSeconds: 0,
    channelSeconds: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: { kind: AbilityEffectKind.STANCE, stance: Stance.MAGIC },
};

export const SWITCH_TO_SCIMITAR: AbilityDefinition = {
    id: "switch_to_scimitar",
    name: "Ready Scimitar",
    windupSeconds: 0,
    channelSeconds: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: { kind: AbilityEffectKind.STANCE, stance: Stance.MELEE },
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

export function buildPlayerAbilityBar(stance: Stance): readonly AbilityDefinition[] {
    return [
        getStanceAttack(stance),
        HEALING_POTION,
        SWITCH_TO_BOW,
        SWITCH_TO_STAFF,
        SWITCH_TO_SCIMITAR,
    ];
}
