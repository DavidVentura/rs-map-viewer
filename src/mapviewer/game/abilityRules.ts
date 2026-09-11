import { AbilityDefinition, CooldownGroup, CooldownLock } from "./Ability";

export type GroupCooldowns = ReadonlyMap<CooldownGroup, number>;

export function areGroupsUnlocked(
    groups: readonly CooldownGroup[],
    groupCooldownUntil: GroupCooldowns,
    time: number,
): boolean {
    return groups.every((group) => (groupCooldownUntil.get(group) ?? 0) <= time);
}

export function lockGroups(
    locks: readonly CooldownLock[],
    groupCooldownUntil: GroupCooldowns,
    extraSeconds: number,
    time: number,
): Map<CooldownGroup, number> {
    const next = new Map(groupCooldownUntil);
    for (const lock of locks) {
        const unlockAt = time + extraSeconds + lock.seconds;
        next.set(lock.group, Math.max(next.get(lock.group) ?? 0, unlockAt));
    }
    return next;
}

export type ChargeState = {
    readonly level: number;
    readonly time: number;
};

export function initialChargeState(maxCharges: number): ChargeState {
    return { level: maxCharges, time: 0 };
}

export function currentChargeLevel(
    state: ChargeState,
    maxCharges: number,
    rechargeSeconds: number,
    time: number,
): number {
    if (rechargeSeconds <= 0) {
        return maxCharges;
    }
    const elapsedSeconds = Math.max(0, time - state.time);
    return Math.min(maxCharges, state.level + elapsedSeconds / rechargeSeconds);
}

export function chargesAvailable(
    state: ChargeState,
    maxCharges: number,
    rechargeSeconds: number,
    time: number,
): number {
    return Math.floor(currentChargeLevel(state, maxCharges, rechargeSeconds, time));
}

export function consumeCharge(
    state: ChargeState,
    maxCharges: number,
    rechargeSeconds: number,
    time: number,
): ChargeState {
    return { level: currentChargeLevel(state, maxCharges, rechargeSeconds, time) - 1, time };
}

// FREE is the debug god mode: mana and charges are ignored so skills can be spammed while tuning
// their feel. The busy gate and the group locks still apply: they are the attack cadence, and
// without them a held key would restart the swing at every impact instead of attacking at the
// weapon's maximum rate.
export enum CastCosts {
    CHARGED = 0,
    FREE = 1,
}

export type AbilityGateState = {
    readonly busyUntil?: number;
    readonly groupCooldownUntil: GroupCooldowns;
    readonly chargeState: ChargeState;
    readonly mana: number;
};

export function canUseAbility(
    definition: AbilityDefinition,
    state: AbilityGateState,
    time: number,
    costs: CastCosts = CastCosts.CHARGED,
): boolean {
    if (state.busyUntil !== undefined && time < state.busyUntil) {
        return false;
    }
    if (!areGroupsUnlocked(definition.requires, state.groupCooldownUntil, time)) {
        return false;
    }
    if (costs === CastCosts.FREE) {
        return true;
    }
    if (state.mana < definition.manaCost) {
        return false;
    }
    return (
        chargesAvailable(
            state.chargeState,
            definition.maxCharges,
            definition.rechargeSeconds,
            time,
        ) > 0
    );
}

export type RandomSource = () => number;

export function rollDamage(min: number, max: number, random: RandomSource): number {
    return Math.round(min + random() * (max - min));
}

export function isWithinMeleeReach(
    distance: number,
    reach: number,
    casterHitRadius: number,
    targetHitRadius: number,
): boolean {
    return distance <= reach + casterHitRadius + targetHitRadius;
}

export function computeCooldownFraction(
    state: ChargeState,
    maxCharges: number,
    rechargeSeconds: number,
    time: number,
): number {
    if (rechargeSeconds <= 0 || chargesAvailable(state, maxCharges, rechargeSeconds, time) > 0) {
        return 0;
    }
    const level = currentChargeLevel(state, maxCharges, rechargeSeconds, time);
    return 1 - (level - Math.floor(level));
}

export type AbilitySlotReadiness = {
    readonly cooldownFraction: number;
    readonly charges: number;
    readonly maxCharges: number;
    readonly manaBlocked: boolean;
};

export function computeSlotReadiness(
    definition: AbilityDefinition,
    chargeState: ChargeState,
    mana: number,
    time: number,
    costs: CastCosts = CastCosts.CHARGED,
): AbilitySlotReadiness {
    if (costs === CastCosts.FREE) {
        return {
            cooldownFraction: 0,
            charges: definition.maxCharges,
            maxCharges: definition.maxCharges,
            manaBlocked: false,
        };
    }
    return {
        cooldownFraction: computeCooldownFraction(
            chargeState,
            definition.maxCharges,
            definition.rechargeSeconds,
            time,
        ),
        charges: chargesAvailable(
            chargeState,
            definition.maxCharges,
            definition.rechargeSeconds,
            time,
        ),
        maxCharges: definition.maxCharges,
        manaBlocked: mana < definition.manaCost,
    };
}
