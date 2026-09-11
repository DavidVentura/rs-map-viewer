import { AbilityDefinition, AbilityTarget, CooldownGroup, ResolvedAbility } from "./Ability";
import {
    CastCosts,
    ChargeState,
    canUseAbility,
    consumeCharge,
    initialChargeState,
    lockGroups,
} from "./abilityRules";

export type PendingCast = {
    readonly definition: ResolvedAbility;
    readonly target: AbilityTarget;
    readonly readyAt: number;
};

// Tracks the cast animation independently of PendingCast: PendingCast is consumed at impact (see
// takeReadyCast), but the animation keeps playing through recovery past that point (see
// CastTiming.animationSeconds), so Player/Enemy need to know what to keep playing after the effect
// has already resolved.
export type ActiveCastAnimation = {
    readonly definition: ResolvedAbility;
    readonly startedAt: number;
    readonly endsAt: number;
};

export class AbilityRuntime {
    private groupCooldownUntil = new Map<CooldownGroup, number>();
    private chargeStateById = new Map<string, ChargeState>();
    private pendingCast?: PendingCast;
    private activeAnimation?: ActiveCastAnimation;

    canUse(
        definition: AbilityDefinition,
        mana: number,
        time: number,
        costs: CastCosts = CastCosts.CHARGED,
    ): boolean {
        return canUseAbility(
            definition,
            {
                busyUntil: this.pendingCast?.readyAt,
                groupCooldownUntil: this.groupCooldownUntil,
                chargeState: this.chargeStateFor(definition),
                mana,
            },
            time,
            costs,
        );
    }

    castEndsAt(): number | undefined {
        return this.pendingCast?.readyAt;
    }

    pendingDefinition(): ResolvedAbility | undefined {
        return this.pendingCast?.definition;
    }

    isBusy(time: number): boolean {
        return this.pendingCast !== undefined && time < this.pendingCast.readyAt;
    }

    isChanneling(time: number): boolean {
        return this.isBusy(time) && this.pendingCast!.definition.channelSeconds > 0;
    }

    // The cast/recovery animation to play at `time`, or undefined once it's fully played out. See
    // ActiveCastAnimation: this outlives pendingCast, which is only good until impact.
    activeCastAnimation(time: number): ActiveCastAnimation | undefined {
        if (!this.activeAnimation || time >= this.activeAnimation.endsAt) {
            return undefined;
        }
        return this.activeAnimation;
    }

    use(definition: ResolvedAbility, target: AbilityTarget, time: number): void {
        const commitSeconds = definition.timing.impactSeconds + definition.channelSeconds;
        this.groupCooldownUntil = lockGroups(
            definition.locks,
            this.groupCooldownUntil,
            commitSeconds,
            time,
        );
        this.chargeStateById.set(
            definition.id,
            consumeCharge(
                this.chargeStateFor(definition),
                definition.maxCharges,
                definition.rechargeSeconds,
                time,
            ),
        );
        this.pendingCast = { definition, target, readyAt: time + commitSeconds };
        this.activeAnimation = {
            definition,
            startedAt: time,
            endsAt: time + definition.timing.animationSeconds,
        };
    }

    takeReadyCast(time: number): PendingCast | undefined {
        if (!this.pendingCast || time < this.pendingCast.readyAt) {
            return undefined;
        }
        const cast = this.pendingCast;
        this.pendingCast = undefined;
        return cast;
    }

    chargeStateFor(definition: AbilityDefinition): ChargeState {
        return this.chargeStateById.get(definition.id) ?? initialChargeState(definition.maxCharges);
    }

    reset(): void {
        this.groupCooldownUntil = new Map();
        this.chargeStateById = new Map();
        this.pendingCast = undefined;
        this.activeAnimation = undefined;
    }
}
