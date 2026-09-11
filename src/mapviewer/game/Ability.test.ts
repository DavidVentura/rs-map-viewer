import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import {
    AbilityDefinition,
    AbilityTargetKind,
    AimMode,
    DeliveryKind,
    aimAtCombatant,
    aimModeFor,
    liveAbilityTarget,
    resolveAbility,
    resolveCastTiming,
} from "./Ability";
import { Combatant, Faction } from "./Combatant";
import { Affects, damagePayload } from "./Effect";
import { ARROW_SPEC, JAD_RANGED_ROCK_SPEC, POWER_SHOT_SPEC } from "./Projectile";
import { CLEAVE, HEALING_POTION, ICE_BARRAGE, SCIMITAR_SLASH } from "./abilities";

const seqFrameLoader = {} as SeqFrameLoader;

// Seq 426 (the bow shot) as it is in the cache: the release frame 5 starts 31 ticks in.
const bowLoader = {
    load: () => ({
        frameIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        getFrameLength: (_loader: SeqFrameLoader, frame: number) =>
            [4, 4, 4, 4, 15, 10, 5, 4, 4, 4][frame],
    }),
} as unknown as SeqTypeLoader;

const BOW_LIKE: AbilityDefinition = {
    id: "bow_like",
    name: "Bow Like",
    castSeqId: 426,
    contactFrame: 5,
    castSpeed: 2,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: {
        delivery: { kind: DeliveryKind.TARGET, reach: 0 },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(1)],
    },
};

describe("resolveCastTiming", () => {
    it("lands impact when the contact frame starts and the animation at the sequence end, both at castSpeed", () => {
        const timing = resolveCastTiming(BOW_LIKE, bowLoader, seqFrameLoader);
        expect(timing.impactSeconds).toBeCloseTo(0.62 / 2);
        expect(timing.animationSeconds).toBeCloseTo(1.16 / 2);
    });

    it("plays at natural speed when castSpeed is 1", () => {
        const timing = resolveCastTiming({ ...BOW_LIKE, castSpeed: 1 }, bowLoader, seqFrameLoader);
        expect(timing.impactSeconds).toBeCloseTo(0.62);
        expect(timing.animationSeconds).toBeCloseTo(1.16);
    });

    it("refuses a contact frame the sequence does not have", () => {
        expect(() =>
            resolveCastTiming({ ...BOW_LIKE, contactFrame: 10 }, bowLoader, seqFrameLoader),
        ).toThrow();
    });
});

describe("resolveAbility", () => {
    it("keeps the definition's fields and attaches the resolved timing", () => {
        const resolved = resolveAbility(BOW_LIKE, bowLoader, seqFrameLoader);
        expect(resolved).toMatchObject(BOW_LIKE);
        expect(resolved.timing.impactSeconds).toBeCloseTo(0.31);
    });
});

function makeCombatant(level: number, health: number): Combatant {
    return {
        x: 100,
        y: 200,
        rotation: 0,
        level,
        faction: Faction.ENEMY,
        hitRadius: 16,
        projectileLaunchHeight: 40,
        health,
        maxHealth: 10,
    };
}

describe("aimModeFor", () => {
    it("aims line skills (free-flight projectiles and cones) at the ground point only", () => {
        expect(aimModeFor(CLEAVE.effect.delivery)).toBe(AimMode.POINT_ONLY);
        expect(
            aimModeFor({
                kind: DeliveryKind.PROJECTILE,
                spec: POWER_SHOT_SPEC,
                count: 1,
                spreadAngleRadians: 0,
            }),
        ).toBe(AimMode.POINT_ONLY);
    });

    it("lets everything else prefer the hovered combatant", () => {
        expect(aimModeFor(SCIMITAR_SLASH.effect.delivery)).toBe(AimMode.COMBATANT_OR_POINT);
        expect(aimModeFor(ICE_BARRAGE.effect.delivery)).toBe(AimMode.COMBATANT_OR_POINT);
        expect(aimModeFor(HEALING_POTION.effect.delivery)).toBe(AimMode.COMBATANT_OR_POINT);
        for (const spec of [ARROW_SPEC, JAD_RANGED_ROCK_SPEC]) {
            expect(
                aimModeFor({
                    kind: DeliveryKind.PROJECTILE,
                    spec,
                    count: 1,
                    spreadAngleRadians: 0,
                }),
            ).toBe(AimMode.COMBATANT_OR_POINT);
        }
    });
});

describe("aimAtCombatant", () => {
    it("aims a point-only delivery at the ground under the combatant", () => {
        const combatant = makeCombatant(0, 10);
        expect(aimAtCombatant(CLEAVE.effect.delivery, combatant)).toEqual({
            kind: AbilityTargetKind.POINT,
            x: 100,
            y: 200,
        });
        expect(aimAtCombatant(SCIMITAR_SLASH.effect.delivery, combatant)).toEqual({
            kind: AbilityTargetKind.COMBATANT,
            combatant,
        });
    });
});

describe("liveAbilityTarget", () => {
    it("keeps a live, same-level aimed combatant", () => {
        const combatant = makeCombatant(0, 10);
        const target = { kind: AbilityTargetKind.COMBATANT, combatant } as const;
        expect(liveAbilityTarget(target, 0)).toBe(target);
    });

    it("degrades a dead or off-level aimed combatant to the point it stands on", () => {
        const expected = { kind: AbilityTargetKind.POINT, x: 100, y: 200 };
        expect(
            liveAbilityTarget(
                { kind: AbilityTargetKind.COMBATANT, combatant: makeCombatant(0, 0) },
                0,
            ),
        ).toEqual(expected);
        expect(
            liveAbilityTarget(
                { kind: AbilityTargetKind.COMBATANT, combatant: makeCombatant(1, 10) },
                0,
            ),
        ).toEqual(expected);
    });
});
