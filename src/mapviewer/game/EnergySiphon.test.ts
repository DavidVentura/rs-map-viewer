import { WeaponStyle } from "./Ability";
import {
    EnergySiphonImpactKind,
    EnergySiphonImpactResult,
    EnergySiphonState,
    HOSTILE_ENERGY_SIPHON,
    canTargetEnergySiphon,
    resolveEnergySiphonImpact,
} from "./EnergySiphon";

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
        const reversed = { state: EnergySiphonState.REVERSED };
        const meleeBasic = {
            kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK,
            style: WeaponStyle.MELEE,
        } as const;

        expect(canTargetEnergySiphon(reversed, meleeBasic)).toBe(false);
        expect(resolveEnergySiphonImpact(reversed, meleeBasic)).toEqual({
            siphon: reversed,
            result: EnergySiphonImpactResult.REJECTED,
        });
    });
});
