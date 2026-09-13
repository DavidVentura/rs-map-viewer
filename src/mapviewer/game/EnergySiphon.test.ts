import { WeaponStyle } from "./Ability";
import {
    EnergySiphon,
    EnergySiphonImpactKind,
    EnergySiphonImpactResult,
    EnergySiphonState,
    HOSTILE_ENERGY_SIPHON,
    canTargetEnergySiphon,
    energySiphonRecallStrikes,
    resolveEnergySiphonImpact,
    settleEnergySiphon,
} from "./EnergySiphon";

const MELEE_BASIC = {
    kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK,
    style: WeaponStyle.MELEE,
} as const;

const REVERSED: EnergySiphon = { state: EnergySiphonState.REVERSED };

describe("energy siphons", () => {
    it("reverses a hostile siphon with a player basic melee attack", () => {
        const result = resolveEnergySiphonImpact(HOSTILE_ENERGY_SIPHON, {
            kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK,
            style: WeaponStyle.MELEE,
        });

        expect(result).toEqual({
            siphon: { state: EnergySiphonState.REVERSED },
            result: EnergySiphonImpactResult.REVERSED,
        });
    });

    it("rejects every other effect source without changing the siphon", () => {
        const rejectedImpacts = [
            { kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK, style: WeaponStyle.RANGED },
            { kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK, style: WeaponStyle.MAGIC },
            { kind: EnergySiphonImpactKind.PLAYER_SKILL },
            { kind: EnergySiphonImpactKind.PROJECTILE },
            { kind: EnergySiphonImpactKind.AREA_EFFECT },
        ] as const;

        for (const impact of rejectedImpacts) {
            expect(canTargetEnergySiphon(HOSTILE_ENERGY_SIPHON, impact)).toBe(false);
            expect(resolveEnergySiphonImpact(HOSTILE_ENERGY_SIPHON, impact)).toEqual({
                siphon: HOSTILE_ENERGY_SIPHON,
                result: EnergySiphonImpactResult.REJECTED,
            });
        }
    });

    it("does not let an already reversed siphon be targeted again", () => {
        expect(canTargetEnergySiphon(REVERSED, MELEE_BASIC)).toBe(false);
        expect(resolveEnergySiphonImpact(REVERSED, MELEE_BASIC)).toEqual({
            siphon: REVERSED,
            result: EnergySiphonImpactResult.REJECTED,
        });
    });

    it("cannot be reversed while in flight and lands hostile once its landing time comes", () => {
        const inFlight: EnergySiphon = { state: EnergySiphonState.IN_FLIGHT, landsAtSeconds: 2 };

        expect(resolveEnergySiphonImpact(inFlight, MELEE_BASIC)).toEqual({
            siphon: inFlight,
            result: EnergySiphonImpactResult.REJECTED,
        });
        expect(settleEnergySiphon(inFlight, 1.99)).toBe(inFlight);

        const landed = settleEnergySiphon(inFlight, 2);
        expect(landed).toEqual(HOSTILE_ENERGY_SIPHON);
        expect(resolveEnergySiphonImpact(landed, MELEE_BASIC).result).toBe(
            EnergySiphonImpactResult.REVERSED,
        );
        expect(settleEnergySiphon(REVERSED, 5)).toBe(REVERSED);
    });

    it("strikes the Warden only with the reversed siphons, each with an even share", () => {
        expect(
            energySiphonRecallStrikes(
                [REVERSED, HOSTILE_ENERGY_SIPHON, REVERSED, HOSTILE_ENERGY_SIPHON],
                8,
            ),
        ).toEqual([2, 2]);
        expect(energySiphonRecallStrikes([REVERSED, REVERSED], 8)).toEqual([4, 4]);
        expect(energySiphonRecallStrikes([HOSTILE_ENERGY_SIPHON], 8)).toEqual([]);
        expect(energySiphonRecallStrikes([], 8)).toEqual([]);
    });
});
