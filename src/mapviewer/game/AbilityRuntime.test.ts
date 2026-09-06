import { AbilityDefinition, AbilityEffectKind, CooldownGroup } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";

const INSTANT_ATTACK: AbilityDefinition = {
    id: "instant_attack",
    name: "Instant Attack",
    windupSeconds: 0,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1 }],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 1, maxDamage: 1, reach: 0 },
};

const TELEGRAPHED_SHOT: AbilityDefinition = {
    id: "telegraphed_shot",
    name: "Telegraphed Shot",
    windupSeconds: 0.5,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0.5,
    requires: [],
    locks: [],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 1, maxDamage: 1, reach: 0 },
};

const COSTLY_SPELL: AbilityDefinition = {
    ...INSTANT_ATTACK,
    id: "costly_spell",
    manaCost: 20,
    requires: [],
    locks: [],
};

const CHANNELED_ABILITY: AbilityDefinition = {
    id: "channeled_ability",
    name: "Channeled Ability",
    windupSeconds: 0,
    channelSeconds: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: { kind: AbilityEffectKind.HEAL, amount: 0 },
};

describe("AbilityRuntime cooldown groups", () => {
    it("is usable immediately after construction", () => {
        const runtime = new AbilityRuntime();
        expect(runtime.canUse(INSTANT_ATTACK, 0, 0)).toBe(true);
    });

    it("locks the ability's own group for the declared duration after use", () => {
        const runtime = new AbilityRuntime();
        runtime.use(INSTANT_ATTACK, { x: 0, y: 0 }, 0);
        expect(runtime.canUse(INSTANT_ATTACK, 0, 0.999)).toBe(false);
        expect(runtime.canUse(INSTANT_ATTACK, 0, 1)).toBe(true);
    });
});

describe("AbilityRuntime mana gating", () => {
    it("blocks casting when mana is insufficient", () => {
        const runtime = new AbilityRuntime();
        expect(runtime.canUse(COSTLY_SPELL, 10, 0)).toBe(false);
        expect(runtime.canUse(COSTLY_SPELL, 20, 0)).toBe(true);
    });
});

describe("AbilityRuntime wind-up timing", () => {
    it("resolves the cast only once the wind-up has elapsed", () => {
        const runtime = new AbilityRuntime();
        runtime.use(TELEGRAPHED_SHOT, { x: 1, y: 2 }, 0);
        expect(runtime.takeReadyCast(0.1)).toBeUndefined();
        expect(runtime.takeReadyCast(0.499)).toBeUndefined();
        const cast = runtime.takeReadyCast(0.5);
        expect(cast?.definition).toBe(TELEGRAPHED_SHOT);
        expect(cast?.target).toEqual({ x: 1, y: 2 });
    });

    it("consumes the pending cast so it cannot resolve twice", () => {
        const runtime = new AbilityRuntime();
        runtime.use(TELEGRAPHED_SHOT, { x: 0, y: 0 }, 0);
        expect(runtime.takeReadyCast(0.5)).toBeDefined();
        expect(runtime.takeReadyCast(0.5)).toBeUndefined();
    });

    it("blocks movement/other ability use for the whole wind-up, then frees it up", () => {
        const runtime = new AbilityRuntime();
        runtime.use(TELEGRAPHED_SHOT, { x: 0, y: 0 }, 0);
        expect(runtime.isBusy(0.1)).toBe(true);
        expect(runtime.canUse(TELEGRAPHED_SHOT, 0, 0.1)).toBe(false);
        expect(runtime.isBusy(0.5)).toBe(false);
    });

    it("keeps the ability itself on cooldown via its own charge recharge after the wind-up ends", () => {
        const slowRecharge: AbilityDefinition = { ...TELEGRAPHED_SHOT, rechargeSeconds: 2 };
        const runtime = new AbilityRuntime();
        runtime.use(slowRecharge, { x: 0, y: 0 }, 0);
        expect(runtime.isBusy(0.5)).toBe(false);
        expect(runtime.canUse(slowRecharge, 0, 0.5)).toBe(false);
        expect(runtime.canUse(slowRecharge, 0, 2)).toBe(true);
    });
});

describe("AbilityRuntime channeling", () => {
    it("reports channeling only while a channel ability's commit window is active", () => {
        const runtime = new AbilityRuntime();
        runtime.use(CHANNELED_ABILITY, { x: 0, y: 0 }, 0);
        expect(runtime.isChanneling(0)).toBe(true);
        expect(runtime.isChanneling(0.999)).toBe(true);
        expect(runtime.isChanneling(1)).toBe(false);
    });

    it("blocks all other abilities while channeling", () => {
        const runtime = new AbilityRuntime();
        runtime.use(CHANNELED_ABILITY, { x: 0, y: 0 }, 0);
        expect(runtime.canUse(INSTANT_ATTACK, 0, 0.5)).toBe(false);
        expect(runtime.canUse(INSTANT_ATTACK, 0, 1)).toBe(true);
    });

    it("does not report channeling for a non-channel ability's wind-up", () => {
        const runtime = new AbilityRuntime();
        runtime.use(TELEGRAPHED_SHOT, { x: 0, y: 0 }, 0);
        expect(runtime.isBusy(0.1)).toBe(true);
        expect(runtime.isChanneling(0.1)).toBe(false);
    });
});
