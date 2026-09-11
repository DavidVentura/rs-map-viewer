import { AbilityDefinition, AbilityEffectKind, ResolvedAbility, resolveAbility } from "./Ability";
import { ARROW_SPEC } from "./Projectile";
import { BOW_SHOT, CLEAVE, HEALING_POTION, ICE_BARRAGE, VOLLEY } from "./abilities";
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

    it("scales a projectile ability's spec damage by the damage multiplier", () => {
        const modifiers = DAMAGE_UP.apply(DEFAULT_ABILITY_MODIFIERS);
        const definition = applyModifiers(resolve(BOW_SHOT), modifiers);
        expect(definition.effect.kind).toBe(AbilityEffectKind.PROJECTILE);
        if (definition.effect.kind === AbilityEffectKind.PROJECTILE) {
            expect(definition.effect.spec.damage).toBeCloseTo(ARROW_SPEC.damage * 1.2);
        }
    });

    it("widens Cleave's cone angle without touching its damage multiplier", () => {
        const modifiers = WIDER_CLEAVE.apply(DEFAULT_ABILITY_MODIFIERS);
        const definition = applyModifiers(resolve(CLEAVE), modifiers);
        expect(definition.effect.kind).toBe(AbilityEffectKind.CONE_MELEE);
        if (definition.effect.kind === AbilityEffectKind.CONE_MELEE) {
            expect(definition.effect.angleRadians).toBeCloseTo(
                CLEAVE.effect.kind === AbilityEffectKind.CONE_MELEE
                    ? CLEAVE.effect.angleRadians + (25 * Math.PI) / 180
                    : 0,
            );
            expect(definition.effect.damageMultiplier).toBe(
                CLEAVE.effect.kind === AbilityEffectKind.CONE_MELEE
                    ? CLEAVE.effect.damageMultiplier
                    : 0,
            );
        }
    });

    it("adds extra arrows to Volley's spread count", () => {
        const modifiers = MORE_ARROWS.apply(DEFAULT_ABILITY_MODIFIERS);
        const definition = applyModifiers(resolve(VOLLEY), modifiers);
        expect(definition.effect.kind).toBe(AbilityEffectKind.MULTI_PROJECTILE);
        if (definition.effect.kind === AbilityEffectKind.MULTI_PROJECTILE) {
            expect(definition.effect.count).toBe(
                VOLLEY.effect.kind === AbilityEffectKind.MULTI_PROJECTILE
                    ? VOLLEY.effect.count + 2
                    : 0,
            );
        }
    });

    it("extends Ice Barrage's freeze duration", () => {
        const modifiers = LONGER_FREEZE.apply(DEFAULT_ABILITY_MODIFIERS);
        const definition = applyModifiers(resolve(ICE_BARRAGE), modifiers);
        expect(definition.effect.kind).toBe(AbilityEffectKind.AREA);
        if (definition.effect.kind === AbilityEffectKind.AREA) {
            expect(definition.effect.freezeSeconds).toBeCloseTo(
                ICE_BARRAGE.effect.kind === AbilityEffectKind.AREA
                    ? ICE_BARRAGE.effect.freezeSeconds + 1.5
                    : 0,
            );
        }
    });

    it("grants an extra potion charge only to heal-effect abilities", () => {
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
