import {
    AbilityDefinition,
    AbilityEffect,
    Delivery,
    DeliveryKind,
    ResolvedAbility,
} from "./Ability";
import { Payload, PayloadKind } from "./Effect";
import { RandomSource } from "./abilityRules";

export type AbilityModifiers = {
    readonly damageMultiplier: number;
    readonly cooldownMultiplier: number;
    readonly castTimeMultiplier: number;
    readonly manaCostMultiplier: number;
    readonly coneAngleBonusRadians: number;
    readonly extraVolleyArrows: number;
    readonly freezeSecondsBonus: number;
    readonly potionMaxChargesBonus: number;
    readonly maxHealthBonus: number;
    readonly maxManaBonus: number;
    readonly moveSpeedMultiplier: number;
    // Flat damage added on top of damageMultiplier, e.g. equipped arrows. Applied to every DAMAGE
    // payload; callers gate it to 0 for styles/specs it shouldn't touch (see
    // Equipment.equipmentAbilityModifiers) rather than this transform special-casing sources.
    readonly flatDamageBonus: number;
};

export const DEFAULT_ABILITY_MODIFIERS: AbilityModifiers = {
    damageMultiplier: 1,
    cooldownMultiplier: 1,
    castTimeMultiplier: 1,
    manaCostMultiplier: 1,
    coneAngleBonusRadians: 0,
    extraVolleyArrows: 0,
    freezeSecondsBonus: 0,
    potionMaxChargesBonus: 0,
    maxHealthBonus: 0,
    maxManaBonus: 0,
    moveSpeedMultiplier: 1,
    flatDamageBonus: 0,
};

// Folds two independently-accumulated AbilityModifiers into one (e.g. upgrade-stacked modifiers
// and equipment-derived modifiers), combining each field the same way stacking another instance of
// it already would: multiplicative fields multiply, additive fields add. The result composes
// through the same single applyModifiers transform below, so equipment never gets its own copy of
// that transform.
export function composeModifiers(a: AbilityModifiers, b: AbilityModifiers): AbilityModifiers {
    return {
        damageMultiplier: a.damageMultiplier * b.damageMultiplier,
        cooldownMultiplier: a.cooldownMultiplier * b.cooldownMultiplier,
        castTimeMultiplier: a.castTimeMultiplier * b.castTimeMultiplier,
        manaCostMultiplier: a.manaCostMultiplier * b.manaCostMultiplier,
        coneAngleBonusRadians: a.coneAngleBonusRadians + b.coneAngleBonusRadians,
        extraVolleyArrows: a.extraVolleyArrows + b.extraVolleyArrows,
        freezeSecondsBonus: a.freezeSecondsBonus + b.freezeSecondsBonus,
        potionMaxChargesBonus: a.potionMaxChargesBonus + b.potionMaxChargesBonus,
        maxHealthBonus: a.maxHealthBonus + b.maxHealthBonus,
        maxManaBonus: a.maxManaBonus + b.maxManaBonus,
        moveSpeedMultiplier: a.moveSpeedMultiplier * b.moveSpeedMultiplier,
        flatDamageBonus: a.flatDamageBonus + b.flatDamageBonus,
    };
}

function isIdentityModifiers(modifiers: AbilityModifiers): boolean {
    return (Object.keys(DEFAULT_ABILITY_MODIFIERS) as (keyof AbilityModifiers)[]).every(
        (key) => modifiers[key] === DEFAULT_ABILITY_MODIFIERS[key],
    );
}

function potionChargeBonus(definition: AbilityDefinition, modifiers: AbilityModifiers): number {
    const heals = definition.effect.payloads.some((payload) => payload.kind === PayloadKind.HEAL);
    return heals ? modifiers.potionMaxChargesBonus : 0;
}

function applyPayloadModifiers(payload: Payload, modifiers: AbilityModifiers): Payload {
    switch (payload.kind) {
        case PayloadKind.DAMAGE:
            return {
                kind: PayloadKind.DAMAGE,
                roll: {
                    min: payload.roll.min * modifiers.damageMultiplier + modifiers.flatDamageBonus,
                    max: payload.roll.max * modifiers.damageMultiplier + modifiers.flatDamageBonus,
                },
            };
        case PayloadKind.FREEZE:
            return {
                kind: PayloadKind.FREEZE,
                seconds: payload.seconds + modifiers.freezeSecondsBonus,
            };
        case PayloadKind.HEAL:
            return payload;
    }
}

function applyDeliveryModifiers(delivery: Delivery, modifiers: AbilityModifiers): Delivery {
    switch (delivery.kind) {
        case DeliveryKind.CONE:
            return {
                ...delivery,
                angleRadians: delivery.angleRadians + modifiers.coneAngleBonusRadians,
            };
        case DeliveryKind.PROJECTILE:
            // Extra arrows widen an existing volley; a single aimed or piercing shot stays single.
            return delivery.count > 1
                ? { ...delivery, count: delivery.count + modifiers.extraVolleyArrows }
                : delivery;
        case DeliveryKind.TARGET:
        case DeliveryKind.CIRCLE:
        case DeliveryKind.DELAYED_CIRCLE:
            return delivery;
    }
}

function applyEffectModifiers(effect: AbilityEffect, modifiers: AbilityModifiers): AbilityEffect {
    return {
        ...effect,
        delivery: applyDeliveryModifiers(effect.delivery, modifiers),
        payloads: effect.payloads.map((payload) => applyPayloadModifiers(payload, modifiers)),
    };
}

// Pure derivation of an ability's effective definition from the player's accumulated upgrades.
// abilities.ts stays untouched: this is the only place stacking upgrades changes numbers, so it
// must be called wherever an ability's numbers matter (Player.abilityBar, effect resolution).
export function applyModifiers(
    ability: ResolvedAbility,
    modifiers: AbilityModifiers,
): ResolvedAbility {
    if (isIdentityModifiers(modifiers)) {
        return ability;
    }
    return {
        ...ability,
        // The resolved timing is wall-clock at castSpeed, so it scales with the cast time while
        // castSpeed scales inversely: the contact frame stays lined up with the new impactSeconds.
        timing: {
            impactSeconds: ability.timing.impactSeconds * modifiers.castTimeMultiplier,
            animationSeconds: ability.timing.animationSeconds * modifiers.castTimeMultiplier,
        },
        castSpeed: ability.castSpeed / modifiers.castTimeMultiplier,
        rechargeSeconds: ability.rechargeSeconds * modifiers.cooldownMultiplier,
        manaCost: ability.manaCost * modifiers.manaCostMultiplier,
        maxCharges: ability.maxCharges + potionChargeBonus(ability, modifiers),
        effect: applyEffectModifiers(ability.effect, modifiers),
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
    apply: (modifiers) => ({
        ...modifiers,
        castTimeMultiplier: modifiers.castTimeMultiplier * 0.85,
    }),
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
    if (modifiers.castTimeMultiplier !== 1) {
        parts.push(`${formatPercentDelta(1 / modifiers.castTimeMultiplier)} cast speed`);
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
