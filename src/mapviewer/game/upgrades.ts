import { AbilityDefinition, AbilityEffectKind } from "./Ability";
import { RandomSource } from "./abilityRules";

export type AbilityModifiers = {
    readonly damageMultiplier: number;
    readonly cooldownMultiplier: number;
    readonly windupMultiplier: number;
    readonly coneAngleBonusRadians: number;
    readonly extraVolleyArrows: number;
    readonly freezeSecondsBonus: number;
    readonly potionMaxChargesBonus: number;
    readonly maxHealthBonus: number;
    readonly maxManaBonus: number;
    readonly moveSpeedMultiplier: number;
};

export const DEFAULT_ABILITY_MODIFIERS: AbilityModifiers = {
    damageMultiplier: 1,
    cooldownMultiplier: 1,
    windupMultiplier: 1,
    coneAngleBonusRadians: 0,
    extraVolleyArrows: 0,
    freezeSecondsBonus: 0,
    potionMaxChargesBonus: 0,
    maxHealthBonus: 0,
    maxManaBonus: 0,
    moveSpeedMultiplier: 1,
};

function isIdentityModifiers(modifiers: AbilityModifiers): boolean {
    return (Object.keys(DEFAULT_ABILITY_MODIFIERS) as (keyof AbilityModifiers)[]).every(
        (key) => modifiers[key] === DEFAULT_ABILITY_MODIFIERS[key],
    );
}

function potionChargeBonus(definition: AbilityDefinition, modifiers: AbilityModifiers): number {
    return definition.effect.kind === AbilityEffectKind.HEAL ? modifiers.potionMaxChargesBonus : 0;
}

function applyEffectModifiers(
    effect: AbilityDefinition["effect"],
    modifiers: AbilityModifiers,
): AbilityDefinition["effect"] {
    switch (effect.kind) {
        case AbilityEffectKind.PROJECTILE:
            return {
                ...effect,
                spec: { ...effect.spec, damage: effect.spec.damage * modifiers.damageMultiplier },
            };
        case AbilityEffectKind.HEAL:
            return effect;
        case AbilityEffectKind.MELEE:
            return {
                ...effect,
                minDamage: effect.minDamage * modifiers.damageMultiplier,
                maxDamage: effect.maxDamage * modifiers.damageMultiplier,
            };
        case AbilityEffectKind.CONE_MELEE:
            return {
                ...effect,
                damageMultiplier: effect.damageMultiplier * modifiers.damageMultiplier,
                angleRadians: effect.angleRadians + modifiers.coneAngleBonusRadians,
            };
        case AbilityEffectKind.AREA:
            return {
                ...effect,
                damageMin: effect.damageMin * modifiers.damageMultiplier,
                damageMax: effect.damageMax * modifiers.damageMultiplier,
                freezeSeconds: effect.freezeSeconds + modifiers.freezeSecondsBonus,
            };
        case AbilityEffectKind.MULTI_PROJECTILE:
            return {
                ...effect,
                spec: { ...effect.spec, damage: effect.spec.damage * modifiers.damageMultiplier },
                count: effect.count + modifiers.extraVolleyArrows,
            };
        case AbilityEffectKind.GROUND_STRIKE:
            return {
                ...effect,
                damageMin: effect.damageMin * modifiers.damageMultiplier,
                damageMax: effect.damageMax * modifiers.damageMultiplier,
            };
        case AbilityEffectKind.HEAL_ALLIES:
            return effect;
    }
}

// Pure derivation of an ability's effective definition from the player's accumulated upgrades.
// abilities.ts stays untouched: this is the only place stacking upgrades changes numbers, so it
// must be called wherever an ability's numbers matter (Player.abilityBar, effect resolution).
export function applyModifiers(
    definition: AbilityDefinition,
    modifiers: AbilityModifiers,
): AbilityDefinition {
    if (isIdentityModifiers(modifiers)) {
        return definition;
    }
    return {
        ...definition,
        windupSeconds: definition.windupSeconds * modifiers.windupMultiplier,
        rechargeSeconds: definition.rechargeSeconds * modifiers.cooldownMultiplier,
        maxCharges: definition.maxCharges + potionChargeBonus(definition, modifiers),
        effect: applyEffectModifiers(definition.effect, modifiers),
    };
}

export enum UpgradeId {
    DAMAGE_UP = "damage_up",
    SWIFT_STRIKES = "swift_strikes",
    QUICK_HANDS = "quick_hands",
    WIDER_CLEAVE = "wider_cleave",
    MORE_ARROWS = "more_arrows",
    LONGER_FREEZE = "longer_freeze",
    POTION_CHARGE = "potion_charge",
    VITALITY = "vitality",
    ARCANE_RESERVES = "arcane_reserves",
    FLEET_FOOTED = "fleet_footed",
}

export type Upgrade = {
    readonly id: UpgradeId;
    readonly name: string;
    readonly description: string;
    readonly apply: (modifiers: AbilityModifiers) => AbilityModifiers;
};

export const DAMAGE_UP: Upgrade = {
    id: UpgradeId.DAMAGE_UP,
    name: "Sharpened Edge",
    description: "+20% damage on every attack",
    apply: (modifiers) => ({ ...modifiers, damageMultiplier: modifiers.damageMultiplier * 1.2 }),
};

export const SWIFT_STRIKES: Upgrade = {
    id: UpgradeId.SWIFT_STRIKES,
    name: "Swift Strikes",
    description: "15% shorter special ability cooldowns",
    apply: (modifiers) => ({
        ...modifiers,
        cooldownMultiplier: modifiers.cooldownMultiplier * 0.85,
    }),
};

export const QUICK_HANDS: Upgrade = {
    id: UpgradeId.QUICK_HANDS,
    name: "Quick Hands",
    description: "15% faster ability wind-up",
    apply: (modifiers) => ({ ...modifiers, windupMultiplier: modifiers.windupMultiplier * 0.85 }),
};

export const WIDER_CLEAVE: Upgrade = {
    id: UpgradeId.WIDER_CLEAVE,
    name: "Sweeping Cleave",
    description: "Cleave's arc is 25 degrees wider",
    apply: (modifiers) => ({
        ...modifiers,
        coneAngleBonusRadians: modifiers.coneAngleBonusRadians + (25 * Math.PI) / 180,
    }),
};

export const MORE_ARROWS: Upgrade = {
    id: UpgradeId.MORE_ARROWS,
    name: "Quiver Stack",
    description: "Volley fires 2 more arrows",
    apply: (modifiers) => ({ ...modifiers, extraVolleyArrows: modifiers.extraVolleyArrows + 2 }),
};

export const LONGER_FREEZE: Upgrade = {
    id: UpgradeId.LONGER_FREEZE,
    name: "Deep Frost",
    description: "Ice Barrage freezes for 1.5s longer",
    apply: (modifiers) => ({
        ...modifiers,
        freezeSecondsBonus: modifiers.freezeSecondsBonus + 1.5,
    }),
};

export const POTION_CHARGE: Upgrade = {
    id: UpgradeId.POTION_CHARGE,
    name: "Extra Vial",
    description: "+1 max healing potion charge",
    apply: (modifiers) => ({
        ...modifiers,
        potionMaxChargesBonus: modifiers.potionMaxChargesBonus + 1,
    }),
};

export const VITALITY: Upgrade = {
    id: UpgradeId.VITALITY,
    name: "Vitality",
    description: "+20 max health",
    apply: (modifiers) => ({ ...modifiers, maxHealthBonus: modifiers.maxHealthBonus + 20 }),
};

export const ARCANE_RESERVES: Upgrade = {
    id: UpgradeId.ARCANE_RESERVES,
    name: "Arcane Reserves",
    description: "+20 max mana",
    apply: (modifiers) => ({ ...modifiers, maxManaBonus: modifiers.maxManaBonus + 20 }),
};

export const FLEET_FOOTED: Upgrade = {
    id: UpgradeId.FLEET_FOOTED,
    name: "Fleet Footed",
    description: "15% faster movement speed",
    apply: (modifiers) => ({
        ...modifiers,
        moveSpeedMultiplier: modifiers.moveSpeedMultiplier * 1.15,
    }),
};

export const UPGRADE_POOL: readonly Upgrade[] = [
    DAMAGE_UP,
    SWIFT_STRIKES,
    QUICK_HANDS,
    WIDER_CLEAVE,
    MORE_ARROWS,
    LONGER_FREEZE,
    POTION_CHARGE,
    VITALITY,
    ARCANE_RESERVES,
    FLEET_FOOTED,
];

// Draws up to `count` distinct upgrades from the pool using the injected random source, so the
// offer is reproducible under a fixed/test RandomSource and never repeats within one pick.
export function drawUpgradeOffer(
    pool: readonly Upgrade[],
    count: number,
    random: RandomSource,
): Upgrade[] {
    const remaining = [...pool];
    const offer: Upgrade[] = [];
    const pickCount = Math.min(count, remaining.length);
    for (let i = 0; i < pickCount; i++) {
        const index = Math.floor(random() * remaining.length);
        offer.push(remaining[index]);
        remaining.splice(index, 1);
    }
    return offer;
}

function formatPercentDelta(multiplier: number): string {
    const percent = Math.round((multiplier - 1) * 100);
    return `${percent >= 0 ? "+" : ""}${percent}%`;
}

// Small HUD summary of the player's accumulated modifiers, e.g. "+20% dmg, +1 arrow". Kept here
// alongside AbilityModifiers so hud/ stays presentation-only and doesn't know what each field means.
export function summarizeModifiers(modifiers: AbilityModifiers): string | undefined {
    const parts: string[] = [];
    if (modifiers.damageMultiplier !== 1) {
        parts.push(`${formatPercentDelta(modifiers.damageMultiplier)} dmg`);
    }
    if (modifiers.cooldownMultiplier !== 1) {
        parts.push(`${formatPercentDelta(1 / modifiers.cooldownMultiplier)} atk speed`);
    }
    if (modifiers.windupMultiplier !== 1) {
        parts.push(`${formatPercentDelta(1 / modifiers.windupMultiplier)} cast speed`);
    }
    if (modifiers.moveSpeedMultiplier !== 1) {
        parts.push(`${formatPercentDelta(modifiers.moveSpeedMultiplier)} speed`);
    }
    if (modifiers.extraVolleyArrows !== 0) {
        parts.push(
            `+${modifiers.extraVolleyArrows} arrow${modifiers.extraVolleyArrows === 1 ? "" : "s"}`,
        );
    }
    if (modifiers.coneAngleBonusRadians !== 0) {
        parts.push(`+${Math.round((modifiers.coneAngleBonusRadians * 180) / Math.PI)}° cleave`);
    }
    if (modifiers.freezeSecondsBonus !== 0) {
        parts.push(`+${modifiers.freezeSecondsBonus}s freeze`);
    }
    if (modifiers.potionMaxChargesBonus !== 0) {
        parts.push(`+${modifiers.potionMaxChargesBonus} potion`);
    }
    if (modifiers.maxHealthBonus !== 0) {
        parts.push(`+${modifiers.maxHealthBonus} hp`);
    }
    if (modifiers.maxManaBonus !== 0) {
        parts.push(`+${modifiers.maxManaBonus} mp`);
    }
    return parts.length > 0 ? parts.join(", ") : undefined;
}
