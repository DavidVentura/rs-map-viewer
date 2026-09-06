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

export const STANCE_SWITCH: AbilityDefinition = {
    id: "stance_switch",
    name: "Change Stance",
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

export const PLAYER_ABILITY_BAR: readonly AbilityDefinition[] = [
    BOW_SHOT,
    MAGIC_BOLT,
    HEALING_POTION,
    STANCE_SWITCH,
];
