import {
    AbilityDefinition,
    AbilityEffect,
    AbilityTarget,
    AbilityTargetKind,
    CircleCenter,
    CooldownGroup,
    DeliveryKind,
    ResolvedAbility,
    resolveAbility,
} from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { Affects, PayloadKind, damagePayload } from "./Effect";
import { stubSequenceLoaders } from "./testLoaders";

const { seqTypeLoader, seqFrameLoader } = stubSequenceLoaders();

function resolve(definition: AbilityDefinition): ResolvedAbility {
    return resolveAbility(definition, seqTypeLoader, seqFrameLoader);
}

const TEST_MELEE: AbilityEffect = {
    delivery: { kind: DeliveryKind.TARGET, reach: 0 },
    affects: Affects.HOSTILE,
    payloads: [damagePayload(1)],
};

const TEST_SELF_HEAL: AbilityEffect = {
    delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 0, center: CircleCenter.CASTER },
    affects: Affects.SELF,
    payloads: [{ kind: PayloadKind.HEAL, amount: 0 }],
};

function point(x: number, y: number): AbilityTarget {
    return { kind: AbilityTargetKind.POINT, x, y };
}

const INSTANT_ATTACK = resolve({
    id: "instant_attack",
    name: "Instant Attack",
    castSeqId: 1,
    contactFrame: 0,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1 }],
    effect: TEST_MELEE,
});

// Contact frame 5 of the stub's 0.08s frames at castSpeed 0.8: impact lands at 0.5s.
const TELEGRAPHED_SHOT = resolve({
    id: "telegraphed_shot",
    name: "Telegraphed Shot",
    castSeqId: 1,
    contactFrame: 5,
    castSpeed: 0.8,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0.5,
    requires: [],
    locks: [],
    effect: TEST_MELEE,
});

const COSTLY_SPELL: ResolvedAbility = {
    ...INSTANT_ATTACK,
    id: "costly_spell",
    manaCost: 20,
    requires: [],
    locks: [],
};

const CHANNELED_ABILITY = resolve({
    id: "channeled_ability",
    name: "Channeled Ability",
    castSeqId: 1,
    contactFrame: 0,
    castSpeed: 1,
    channelSeconds: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: TEST_SELF_HEAL,
});

// Short animation, long ATTACK-lock recovery: models an enemy cast whose visible swing finishes
// well before the caster is allowed to act again (see Enemy.ts, which falls back to idle once
// activeCastAnimation expires while RECOVERY continues under the lock). At castSpeed 3.2 the
// stub's 1.6s sequence plays in 0.5s, with contact frame 8 landing at 0.2s.
const LONG_RECOVERY_SHORT_ANIMATION = resolve({
    id: "long_recovery_short_animation",
    name: "Long Recovery Short Animation",
    castSeqId: 1,
    contactFrame: 8,
    castSpeed: 3.2,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2 }],
    effect: TEST_MELEE,
});

describe("AbilityRuntime cooldown groups", () => {
    it("is usable immediately after construction", () => {
        const runtime = new AbilityRuntime();
        expect(runtime.canUse(INSTANT_ATTACK, 0, 0)).toBe(true);
    });

    it("locks the ability's own group for the declared duration after use", () => {
        const runtime = new AbilityRuntime();
        runtime.use(INSTANT_ATTACK, point(0, 0), 0);
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
        runtime.use(TELEGRAPHED_SHOT, point(1, 2), 0);
        expect(runtime.takeReadyCast(0.1)).toBeUndefined();
        expect(runtime.takeReadyCast(0.499)).toBeUndefined();
        const cast = runtime.takeReadyCast(0.5);
        expect(cast?.definition).toBe(TELEGRAPHED_SHOT);
        expect(cast?.target).toEqual(point(1, 2));
    });

    it("consumes the pending cast so it cannot resolve twice", () => {
        const runtime = new AbilityRuntime();
        runtime.use(TELEGRAPHED_SHOT, point(0, 0), 0);
        expect(runtime.takeReadyCast(0.5)).toBeDefined();
        expect(runtime.takeReadyCast(0.5)).toBeUndefined();
    });

    it("blocks movement/other ability use for the whole wind-up, then frees it up", () => {
        const runtime = new AbilityRuntime();
        runtime.use(TELEGRAPHED_SHOT, point(0, 0), 0);
        expect(runtime.isBusy(0.1)).toBe(true);
        expect(runtime.canUse(TELEGRAPHED_SHOT, 0, 0.1)).toBe(false);
        expect(runtime.isBusy(0.5)).toBe(false);
    });

    it("keeps the ability itself on cooldown via its own charge recharge after the wind-up ends", () => {
        const slowRecharge: ResolvedAbility = { ...TELEGRAPHED_SHOT, rechargeSeconds: 2 };
        const runtime = new AbilityRuntime();
        runtime.use(slowRecharge, point(0, 0), 0);
        expect(runtime.isBusy(0.5)).toBe(false);
        expect(runtime.canUse(slowRecharge, 0, 0.5)).toBe(false);
        expect(runtime.canUse(slowRecharge, 0, 2)).toBe(true);
    });
});

describe("AbilityRuntime channeling", () => {
    it("reports channeling only while a channel ability's commit window is active", () => {
        const runtime = new AbilityRuntime();
        runtime.use(CHANNELED_ABILITY, point(0, 0), 0);
        expect(runtime.isChanneling(0)).toBe(true);
        expect(runtime.isChanneling(0.999)).toBe(true);
        expect(runtime.isChanneling(1)).toBe(false);
    });

    it("blocks all other abilities while channeling", () => {
        const runtime = new AbilityRuntime();
        runtime.use(CHANNELED_ABILITY, point(0, 0), 0);
        expect(runtime.canUse(INSTANT_ATTACK, 0, 0.5)).toBe(false);
        expect(runtime.canUse(INSTANT_ATTACK, 0, 1)).toBe(true);
    });

    it("does not report channeling for a non-channel ability's wind-up", () => {
        const runtime = new AbilityRuntime();
        runtime.use(TELEGRAPHED_SHOT, point(0, 0), 0);
        expect(runtime.isBusy(0.1)).toBe(true);
        expect(runtime.isChanneling(0.1)).toBe(false);
    });
});

describe("AbilityRuntime cast animation", () => {
    it("keeps the cast animation active only for the resolved animationSeconds, independent of the lock", () => {
        const runtime = new AbilityRuntime();
        runtime.use(LONG_RECOVERY_SHORT_ANIMATION, point(0, 0), 10);
        expect(runtime.activeCastAnimation(10.499)?.definition).toBe(LONG_RECOVERY_SHORT_ANIMATION);
        expect(runtime.activeCastAnimation(10.5)).toBeUndefined();
    });

    it("resolves the pending cast at impactSeconds, well before the animation or the lock end", () => {
        const runtime = new AbilityRuntime();
        runtime.use(LONG_RECOVERY_SHORT_ANIMATION, point(0, 0), 10);
        expect(runtime.takeReadyCast(10.2)?.definition).toBe(LONG_RECOVERY_SHORT_ANIMATION);
        expect(runtime.activeCastAnimation(10.2)).toBeDefined();
    });

    it("keeps the ability's own group locked well after the cast animation has finished", () => {
        const runtime = new AbilityRuntime();
        runtime.use(LONG_RECOVERY_SHORT_ANIMATION, point(0, 0), 10);
        expect(runtime.activeCastAnimation(10.5)).toBeUndefined();
        expect(runtime.canUse(LONG_RECOVERY_SHORT_ANIMATION, 0, 12.199)).toBe(false);
        expect(runtime.canUse(LONG_RECOVERY_SHORT_ANIMATION, 0, 12.2)).toBe(true);
    });
});
