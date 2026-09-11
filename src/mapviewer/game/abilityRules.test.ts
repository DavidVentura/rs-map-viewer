import { CooldownGroup } from "./Ability";
import { HEALING_POTION } from "./abilities";
import {
    CastCosts,
    areGroupsUnlocked,
    canUseAbility,
    chargesAvailable,
    computeCooldownFraction,
    computeSlotReadiness,
    consumeCharge,
    initialChargeState,
    isWithinMeleeReach,
    lockGroups,
    rollDamage,
} from "./abilityRules";

const BASE_DEFINITION = {
    id: "test",
    name: "Test",
    castSeqId: 1,
    contactFrame: 0,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
};

describe("areGroupsUnlocked / lockGroups", () => {
    it("is unlocked when no cooldown has been recorded for the group", () => {
        expect(areGroupsUnlocked([CooldownGroup.ATTACK], new Map(), 0)).toBe(true);
    });

    it("locks a group for the requested duration from the given time", () => {
        const locked = lockGroups([{ group: CooldownGroup.ATTACK, seconds: 1 }], new Map(), 0, 10);
        expect(areGroupsUnlocked([CooldownGroup.ATTACK], locked, 10.999)).toBe(false);
        expect(areGroupsUnlocked([CooldownGroup.ATTACK], locked, 11)).toBe(true);
    });

    it("shares a lock across abilities that reference the same group", () => {
        const afterBow = lockGroups([{ group: CooldownGroup.ATTACK, seconds: 5 }], new Map(), 0, 0);
        expect(areGroupsUnlocked([CooldownGroup.ATTACK], afterBow, 1)).toBe(false);
    });

    it("never shortens an existing lock", () => {
        const longLock = lockGroups(
            [{ group: CooldownGroup.ATTACK, seconds: 10 }],
            new Map(),
            0,
            0,
        );
        const shortLock = lockGroups([{ group: CooldownGroup.ATTACK, seconds: 1 }], longLock, 0, 0);
        expect(shortLock.get(CooldownGroup.ATTACK)).toBe(10);
    });
});

describe("charges", () => {
    it("behaves like a plain cooldown when maxCharges is 1", () => {
        let state = initialChargeState(1);
        state = consumeCharge(state, 1, 2, 0);
        expect(chargesAvailable(state, 1, 2, 1)).toBe(0);
        expect(chargesAvailable(state, 1, 2, 2)).toBe(1);
    });

    it("banks multiple charges and regenerates them independently over time", () => {
        let state = initialChargeState(3);
        state = consumeCharge(state, 3, 10, 0);
        state = consumeCharge(state, 3, 10, 0);
        expect(chargesAvailable(state, 3, 10, 0)).toBe(1);
        expect(chargesAvailable(state, 3, 10, 10)).toBe(2);
        expect(chargesAvailable(state, 3, 10, 20)).toBe(3);
        expect(chargesAvailable(state, 3, 10, 1000)).toBe(3);
    });
});

describe("canUseAbility", () => {
    it("blocks while the caster is busy with a pending cast", () => {
        const usable = canUseAbility(
            { ...BASE_DEFINITION, effect: undefined as any },
            {
                busyUntil: 5,
                groupCooldownUntil: new Map(),
                chargeState: initialChargeState(1),
                mana: 0,
            },
            4,
        );
        expect(usable).toBe(false);
    });

    it("blocks when the caster does not have enough mana", () => {
        const usable = canUseAbility(
            { ...BASE_DEFINITION, manaCost: 10, effect: undefined as any },
            {
                groupCooldownUntil: new Map(),
                chargeState: initialChargeState(1),
                mana: 5,
            },
            0,
        );
        expect(usable).toBe(false);
    });

    it("blocks while any required group is still on cooldown", () => {
        const groupCooldownUntil = new Map([[CooldownGroup.ATTACK, 5]]);
        const usable = canUseAbility(
            {
                ...BASE_DEFINITION,
                requires: [CooldownGroup.ATTACK],
                effect: undefined as any,
            },
            { groupCooldownUntil, chargeState: initialChargeState(1), mana: 0 },
            4,
        );
        expect(usable).toBe(false);
    });

    it("stays usable when it only locks a group it does not require", () => {
        const groupCooldownUntil = new Map([[CooldownGroup.ATTACK, 5]]);
        const usable = canUseAbility(
            {
                ...BASE_DEFINITION,
                locks: [{ group: CooldownGroup.ATTACK, seconds: 1 }],
                effect: undefined as any,
            },
            { groupCooldownUntil, chargeState: initialChargeState(1), mana: 0 },
            4,
        );
        expect(usable).toBe(true);
    });

    it("blocks when no charges are available", () => {
        const usable = canUseAbility(
            { ...BASE_DEFINITION, maxCharges: 1, rechargeSeconds: 10, effect: undefined as any },
            {
                groupCooldownUntil: new Map(),
                chargeState: consumeCharge(initialChargeState(1), 1, 10, 0),
                mana: 0,
            },
            1,
        );
        expect(usable).toBe(false);
    });

    it("allows use once every gate is clear", () => {
        const usable = canUseAbility(
            { ...BASE_DEFINITION, effect: undefined as any },
            { groupCooldownUntil: new Map(), chargeState: initialChargeState(1), mana: 0 },
            0,
        );
        expect(usable).toBe(true);
    });
});

describe("rollDamage", () => {
    it("returns the minimum when the random source returns 0", () => {
        expect(rollDamage(2, 10, () => 0)).toBe(2);
    });

    it("returns the maximum when the random source returns just under 1", () => {
        expect(rollDamage(2, 10, () => 0.999999)).toBe(10);
    });

    it("stays within the requested bounds across the random range", () => {
        for (let i = 0; i <= 10; i++) {
            const amount = rollDamage(5, 15, () => i / 10);
            expect(amount).toBeGreaterThanOrEqual(5);
            expect(amount).toBeLessThanOrEqual(15);
        }
    });
});

describe("isWithinMeleeReach", () => {
    it("accounts for both hit radii on top of the ability's reach", () => {
        expect(isWithinMeleeReach(176, 48, 64, 64)).toBe(true);
        expect(isWithinMeleeReach(177, 48, 64, 64)).toBe(false);
    });
});

describe("computeCooldownFraction", () => {
    it("is zero once a charge is available", () => {
        const state = initialChargeState(1);
        expect(computeCooldownFraction(state, 1, 2, 0)).toBe(0);
    });

    it("counts down toward zero as the recharge elapses", () => {
        const state = consumeCharge(initialChargeState(1), 1, 2, 0);
        expect(computeCooldownFraction(state, 1, 2, 0)).toBe(1);
        expect(computeCooldownFraction(state, 1, 2, 1)).toBeCloseTo(0.5);
        expect(computeCooldownFraction(state, 1, 2, 2)).toBe(0);
    });
});

describe("computeSlotReadiness", () => {
    const definition = {
        ...BASE_DEFINITION,
        manaCost: 10,
        effect: HEALING_POTION.effect,
    };

    it("reports mana-blocked alongside cooldown/charges", () => {
        const state = initialChargeState(1);
        const readiness = computeSlotReadiness(definition, state, 5, 0);
        expect(readiness.manaBlocked).toBe(true);
        expect(readiness.charges).toBe(1);
        expect(readiness.maxCharges).toBe(1);
        expect(readiness.cooldownFraction).toBe(0);
    });
});

describe("free casting (god mode)", () => {
    const definition = {
        ...BASE_DEFINITION,
        manaCost: 50,
        requires: [CooldownGroup.ATTACK],
        effect: HEALING_POTION.effect,
    };
    const spent = {
        busyUntil: undefined,
        groupCooldownUntil: new Map(),
        chargeState: consumeCharge(initialChargeState(1), 1, 100, 0),
        mana: 0,
    };

    it("ignores mana and charges", () => {
        expect(canUseAbility(definition, spent, 1)).toBe(false);
        expect(canUseAbility(definition, spent, 1, CastCosts.FREE)).toBe(true);
    });

    it("still waits for a cast in progress", () => {
        const busy = { ...spent, busyUntil: 5 };
        expect(canUseAbility(definition, busy, 4, CastCosts.FREE)).toBe(false);
        expect(canUseAbility(definition, busy, 5, CastCosts.FREE)).toBe(true);
    });

    it("still respects group locks so a held key attacks at the weapon's rate", () => {
        const locked = {
            ...spent,
            groupCooldownUntil: lockGroups(
                [{ group: CooldownGroup.ATTACK, seconds: 10 }],
                new Map(),
                0,
                0,
            ),
        };
        expect(canUseAbility(definition, locked, 9, CastCosts.FREE)).toBe(false);
        expect(canUseAbility(definition, locked, 10, CastCosts.FREE)).toBe(true);
    });

    it("reports every slot as ready", () => {
        const readiness = computeSlotReadiness(definition, spent.chargeState, 0, 1, CastCosts.FREE);
        expect(readiness).toEqual({
            cooldownFraction: 0,
            charges: 1,
            maxCharges: 1,
            manaBlocked: false,
        });
    });
});
