import {
    AbilityDefinition,
    AbilityEffect,
    DeliveryKind,
    ResolvedAbility,
    resolveAbility,
} from "./Ability";
import { Affects, DamageRoll, PayloadKind, damagePayload } from "./Effect";
import { ARROW_SPEC } from "./Projectile";
import {
    BOW_SHOT,
    CLEAVE,
    HEALING_POTION,
    ICE_BARRAGE,
    POWER_SHOT,
    SCIMITAR_SLASH,
    VOLLEY,
} from "./abilities";
import { stubSequenceLoaders } from "./testLoaders";
import {
    DAMAGE_UP,
    DEFAULT_ABILITY_MODIFIERS,
    LONGER_FREEZE,
    MORE_ARROWS,
    POTION_CHARGE,
    QUICK_HANDS,
    UPGRADE_POOL,
    WIDER_CLEAVE,
    applyModifiers,
    drawUpgradeOffer,
} from "./upgrades";

const { seqTypeLoader, seqFrameLoader } = stubSequenceLoaders();

function resolve(definition: AbilityDefinition): ResolvedAbility {
    return resolveAbility(definition, seqTypeLoader, seqFrameLoader);
}

function damageRoll(effect: AbilityEffect): DamageRoll {
    const payload = effect.payloads.find((candidate) => candidate.kind === PayloadKind.DAMAGE);
    if (!payload || payload.kind !== PayloadKind.DAMAGE) {
        throw new Error("expected a DAMAGE payload");
    }
    return payload.roll;
}

function freezeSeconds(effect: AbilityEffect): number {
    const payload = effect.payloads.find((candidate) => candidate.kind === PayloadKind.FREEZE);
    if (!payload || payload.kind !== PayloadKind.FREEZE) {
        throw new Error("expected a FREEZE payload");
    }
    return payload.seconds;
}

function projectileCount(effect: AbilityEffect): number {
    if (effect.delivery.kind !== DeliveryKind.PROJECTILE) {
        throw new Error("expected a PROJECTILE delivery");
    }
    return effect.delivery.count;
}

function coneAngle(effect: AbilityEffect): number {
    if (effect.delivery.kind !== DeliveryKind.CONE) {
        throw new Error("expected a CONE delivery");
    }
    return effect.delivery.angleRadians;
}

describe("Upgrade.apply", () => {
    it("changes only the fields it targets, leaving the rest at their defaults", () => {
        const result = DAMAGE_UP.apply(DEFAULT_ABILITY_MODIFIERS);
        expect(result).toEqual({ ...DEFAULT_ABILITY_MODIFIERS, damageMultiplier: 1.2 });
    });

    it("composes when stacked, multiplying the same field again", () => {
        const stacked = [DAMAGE_UP, DAMAGE_UP].reduce(
            (modifiers, upgrade) => upgrade.apply(modifiers),
            DEFAULT_ABILITY_MODIFIERS,
        );
        expect(stacked.damageMultiplier).toBeCloseTo(1.2 * 1.2);
    });

    it("composes across different upgrades without interfering with each other's fields", () => {
        const stacked = [DAMAGE_UP, WIDER_CLEAVE, MORE_ARROWS].reduce(
            (modifiers, upgrade) => upgrade.apply(modifiers),
            DEFAULT_ABILITY_MODIFIERS,
        );
        expect(stacked.damageMultiplier).toBeCloseTo(1.2);
        expect(stacked.coneAngleBonusRadians).toBeCloseTo((25 * Math.PI) / 180);
        expect(stacked.extraVolleyArrows).toBe(2);
    });
});

describe("applyModifiers", () => {
    it("returns the same ability reference under identity modifiers", () => {
        const bow = resolve(BOW_SHOT);
        expect(applyModifiers(bow, DEFAULT_ABILITY_MODIFIERS)).toBe(bow);
    });

    it("scales the resolved cast timing with the cast time and castSpeed inversely, keeping the contact frame lined up", () => {
        const bow = resolve(BOW_SHOT);
        const modifiers = QUICK_HANDS.apply(DEFAULT_ABILITY_MODIFIERS);
        const quick = applyModifiers(bow, modifiers);
        expect(quick.timing.impactSeconds).toBeCloseTo(bow.timing.impactSeconds * 0.85);
        expect(quick.timing.animationSeconds).toBeCloseTo(bow.timing.animationSeconds * 0.85);
        expect(quick.castSpeed).toBeCloseTo(bow.castSpeed / 0.85);
        expect(quick.timing.impactSeconds * quick.castSpeed).toBeCloseTo(
            bow.timing.impactSeconds * bow.castSpeed,
        );
    });

    it("scales every DAMAGE payload by the multiplier and adds the flat bonus, whatever the delivery", () => {
        const modifiers = {
            ...DAMAGE_UP.apply(DEFAULT_ABILITY_MODIFIERS),
            flatDamageBonus: 3,
        };
        const bow = damageRoll(applyModifiers(resolve(BOW_SHOT), modifiers).effect);
        expect(bow).toEqual({ min: 8 * 1.2 + 3, max: 8 * 1.2 + 3 });
        const slash = damageRoll(applyModifiers(resolve(SCIMITAR_SLASH), modifiers).effect);
        const base = damageRoll(SCIMITAR_SLASH.effect);
        expect(slash.min).toBeCloseTo(base.min * 1.2 + 3);
        expect(slash.max).toBeCloseTo(base.max * 1.2 + 3);
        const cleave = damageRoll(applyModifiers(resolve(CLEAVE), modifiers).effect);
        expect(cleave.min).toBeCloseTo(base.min * 2 * 1.2 + 3);
        expect(cleave.max).toBeCloseTo(base.max * 2 * 1.2 + 3);
    });

    it("leaves HEAL payloads and the projectile spec untouched by damage modifiers", () => {
        const modifiers = DAMAGE_UP.apply(DEFAULT_ABILITY_MODIFIERS);
        expect(applyModifiers(resolve(HEALING_POTION), modifiers).effect.payloads).toEqual(
            HEALING_POTION.effect.payloads,
        );
        const bow = applyModifiers(resolve(BOW_SHOT), modifiers).effect;
        expect(bow.delivery.kind === DeliveryKind.PROJECTILE && bow.delivery.spec).toBe(ARROW_SPEC);
    });

    it("widens Cleave's cone angle without touching its damage", () => {
        const modifiers = WIDER_CLEAVE.apply(DEFAULT_ABILITY_MODIFIERS);
        const definition = applyModifiers(resolve(CLEAVE), modifiers);
        expect(coneAngle(definition.effect)).toBeCloseTo(
            coneAngle(CLEAVE.effect) + (25 * Math.PI) / 180,
        );
        expect(damageRoll(definition.effect)).toEqual(damageRoll(CLEAVE.effect));
    });

    it("adds extra arrows to Volley's spread but never to a single shot", () => {
        const modifiers = MORE_ARROWS.apply(DEFAULT_ABILITY_MODIFIERS);
        expect(projectileCount(applyModifiers(resolve(VOLLEY), modifiers).effect)).toBe(
            projectileCount(VOLLEY.effect) + 2,
        );
        expect(projectileCount(applyModifiers(resolve(BOW_SHOT), modifiers).effect)).toBe(1);
        expect(projectileCount(applyModifiers(resolve(POWER_SHOT), modifiers).effect)).toBe(1);
    });

    it("extends Ice Barrage's freeze duration", () => {
        const modifiers = LONGER_FREEZE.apply(DEFAULT_ABILITY_MODIFIERS);
        const definition = applyModifiers(resolve(ICE_BARRAGE), modifiers);
        expect(freezeSeconds(definition.effect)).toBeCloseTo(
            freezeSeconds(ICE_BARRAGE.effect) + 1.5,
        );
    });

    it("keeps the delivery, affects and hit effect of a modified ability", () => {
        const modifiers = LONGER_FREEZE.apply(DAMAGE_UP.apply(DEFAULT_ABILITY_MODIFIERS));
        const definition = applyModifiers(resolve(ICE_BARRAGE), modifiers);
        expect(definition.effect.delivery).toEqual(ICE_BARRAGE.effect.delivery);
        expect(definition.effect.affects).toBe(Affects.HOSTILE);
        expect(definition.effect.hitEffect).toEqual(ICE_BARRAGE.effect.hitEffect);
        expect(definition.effect.payloads).toEqual([
            damagePayload(12 * 1.2),
            { kind: PayloadKind.FREEZE, seconds: 4.5 },
        ]);
    });

    it("grants an extra potion charge only to abilities with a HEAL payload", () => {
        const modifiers = POTION_CHARGE.apply(DEFAULT_ABILITY_MODIFIERS);
        expect(applyModifiers(resolve(HEALING_POTION), modifiers).maxCharges).toBe(
            HEALING_POTION.maxCharges + 1,
        );
        expect(applyModifiers(resolve(BOW_SHOT), modifiers).maxCharges).toBe(BOW_SHOT.maxCharges);
    });
});

describe("drawUpgradeOffer", () => {
    it("never repeats an upgrade within a single offer", () => {
        for (let i = 0; i < 200; i++) {
            const offer = drawUpgradeOffer(UPGRADE_POOL, 3, Math.random);
            const ids = new Set(offer.map((upgrade) => upgrade.id));
            expect(ids.size).toBe(offer.length);
            expect(offer.length).toBe(3);
        }
    });

    it("is deterministic for a fixed random source", () => {
        const offer = drawUpgradeOffer(UPGRADE_POOL, 3, () => 0);
        expect(offer).toEqual([UPGRADE_POOL[0], UPGRADE_POOL[1], UPGRADE_POOL[2]]);
    });

    it("clamps the offer to the pool size when asked for more than is available", () => {
        const offer = drawUpgradeOffer(UPGRADE_POOL, UPGRADE_POOL.length + 5, Math.random);
        expect(offer.length).toBe(UPGRADE_POOL.length);
        expect(new Set(offer.map((upgrade) => upgrade.id)).size).toBe(UPGRADE_POOL.length);
    });
});
