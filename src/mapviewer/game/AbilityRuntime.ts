import { AbilityDefinition, AbilityTarget, CooldownGroup } from "./Ability";
import {
    ChargeState,
    canUseAbility,
    consumeCharge,
    initialChargeState,
    lockGroups,
} from "./abilityRules";

export type PendingCast = {
    readonly definition: AbilityDefinition;
    readonly target: AbilityTarget;
    readonly readyAt: number;
};

export class AbilityRuntime {
    private groupCooldownUntil = new Map<CooldownGroup, number>();
    private chargeStateById = new Map<string, ChargeState>();
    private pendingCast?: PendingCast;

    canUse(definition: AbilityDefinition, mana: number, time: number): boolean {
        return canUseAbility(
            definition,
            {
                busyUntil: this.pendingCast?.readyAt,
                groupCooldownUntil: this.groupCooldownUntil,
                chargeState: this.chargeStateFor(definition),
                mana,
            },
            time,
        );
    }

    isBusy(time: number): boolean {
        return this.pendingCast !== undefined && time < this.pendingCast.readyAt;
    }

    isChanneling(time: number): boolean {
        return this.isBusy(time) && this.pendingCast!.definition.channelSeconds > 0;
    }

    use(definition: AbilityDefinition, target: AbilityTarget, time: number): void {
        const commitSeconds = definition.windupSeconds + definition.channelSeconds;
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
    }

    takeReadyCast(time: number): PendingCast | undefined {
        if (!this.pendingCast || time < this.pendingCast.readyAt) {
            return undefined;
        }
        const cast = this.pendingCast;
        this.pendingCast = undefined;
        return cast;
    }

    private chargeStateFor(definition: AbilityDefinition): ChargeState {
        return this.chargeStateById.get(definition.id) ?? initialChargeState(definition.maxCharges);
    }
}
