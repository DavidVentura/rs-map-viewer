import { WeaponStyle } from "./Ability";

export enum EnergySiphonState {
    HOSTILE = 0,
    REVERSED = 1,
    // Thrown out of the Warden and not yet on its tile.
    IN_FLIGHT = 2,
}

export type EnergySiphon =
    | { readonly state: EnergySiphonState.IN_FLIGHT; readonly landsAtSeconds: number }
    | { readonly state: EnergySiphonState.HOSTILE }
    | { readonly state: EnergySiphonState.REVERSED };

export const HOSTILE_ENERGY_SIPHON: EnergySiphon = { state: EnergySiphonState.HOSTILE };

export function settleEnergySiphon(siphon: EnergySiphon, timeSeconds: number): EnergySiphon {
    if (siphon.state !== EnergySiphonState.IN_FLIGHT || timeSeconds < siphon.landsAtSeconds) {
        return siphon;
    }
    return HOSTILE_ENERGY_SIPHON;
}

// Every siphon flies back into the Warden once its intermission resolves, however it resolved, and
// each one the player reversed strikes the Warden with an even share of the reversal damage as it
// arrives, so a partly reversed set still pays out its part.
export function energySiphonRecallStrikes(
    siphons: readonly EnergySiphon[],
    reversalDamage: number,
): readonly number[] {
    return siphons
        .filter((siphon) => siphon.state === EnergySiphonState.REVERSED)
        .map(() => reversalDamage / siphons.length);
}

export enum EnergySiphonImpactKind {
    PLAYER_BASIC_ATTACK = 0,
    PLAYER_SKILL = 1,
    PROJECTILE = 2,
    AREA_EFFECT = 3,
}

export type EnergySiphonImpact =
    | {
          readonly kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK;
          readonly style: WeaponStyle;
      }
    | { readonly kind: EnergySiphonImpactKind.PLAYER_SKILL }
    | { readonly kind: EnergySiphonImpactKind.PROJECTILE }
    | { readonly kind: EnergySiphonImpactKind.AREA_EFFECT };

export enum EnergySiphonImpactResult {
    REVERSED = 0,
    REJECTED = 1,
}

export type ResolvedEnergySiphonImpact = {
    readonly siphon: EnergySiphon;
    readonly result: EnergySiphonImpactResult;
};

export function canTargetEnergySiphon(siphon: EnergySiphon, impact: EnergySiphonImpact): boolean {
    return (
        siphon.state === EnergySiphonState.HOSTILE &&
        impact.kind === EnergySiphonImpactKind.PLAYER_BASIC_ATTACK &&
        impact.style === WeaponStyle.MELEE
    );
}

export function resolveEnergySiphonImpact(
    siphon: EnergySiphon,
    impact: EnergySiphonImpact,
): ResolvedEnergySiphonImpact {
    if (!canTargetEnergySiphon(siphon, impact)) {
        return { siphon, result: EnergySiphonImpactResult.REJECTED };
    }
    return {
        siphon: { state: EnergySiphonState.REVERSED },
        result: EnergySiphonImpactResult.REVERSED,
    };
}
