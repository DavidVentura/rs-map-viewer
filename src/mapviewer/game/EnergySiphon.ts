import { WeaponStyle } from "./Ability";

export enum EnergySiphonState {
    HOSTILE = 0,
    REVERSED = 1,
}

export type EnergySiphon = {
    readonly state: EnergySiphonState;
};

export type EnergySiphonActor = EnergySiphon & {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly level: number;
    readonly rotation: number;
};

export const HOSTILE_ENERGY_SIPHON: EnergySiphon = { state: EnergySiphonState.HOSTILE };

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
