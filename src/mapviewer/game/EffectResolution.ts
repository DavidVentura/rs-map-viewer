import { clamp } from "../../util/MathUtil";
import {
    AbilityEffect,
    AbilityTarget,
    AbilityTargetKind,
    CircleCenter,
    CircleDelivery,
    ConeDelivery,
    DelayedCircleDelivery,
    DeliveryKind,
    TargetDelivery,
    abilityTargetPoint,
} from "./Ability";
import { Combatant } from "./Combatant";
import { Affects, combatantsInCircle, matchesAffects } from "./Effect";
import { TILE_SIZE } from "./Terrain";
import { isWithinMeleeReach } from "./abilityRules";
import { isPointInCone } from "./projectileMath";

// The deliveries that pick their affected set at cast impact, as opposed to PROJECTILE (picked on
// arrival) and DELAYED_CIRCLE (picked once the telegraph elapses).
export type DirectDelivery = TargetDelivery | ConeDelivery | CircleDelivery;

export function affectedCombatants<T extends Combatant>(
    caster: Combatant,
    delivery: DirectDelivery,
    affects: Affects,
    target: AbilityTarget,
    combatants: readonly T[],
): T[] {
    const candidates = combatants.filter((combatant) => matchesAffects(caster, affects, combatant));
    switch (delivery.kind) {
        case DeliveryKind.TARGET: {
            if (target.kind !== AbilityTargetKind.COMBATANT) {
                return [];
            }
            const aimed = target.combatant;
            const distance = Math.hypot(aimed.x - caster.x, aimed.y - caster.y);
            if (
                aimed.level !== caster.level ||
                aimed.health <= 0 ||
                !isWithinMeleeReach(distance, delivery.reach, caster.hitRadius, aimed.hitRadius)
            ) {
                return [];
            }
            return candidates.filter((combatant) => combatant === aimed);
        }
        case DeliveryKind.CONE:
            return candidates.filter(
                (combatant) =>
                    combatant.level === caster.level &&
                    combatant.health > 0 &&
                    isPointInCone(
                        caster.x,
                        caster.y,
                        caster.rotation,
                        delivery.angleRadians,
                        delivery.reach + caster.hitRadius + combatant.hitRadius,
                        combatant.x,
                        combatant.y,
                    ),
            );
        case DeliveryKind.CIRCLE: {
            const center =
                delivery.center === CircleCenter.CASTER ? caster : abilityTargetPoint(target);
            return combatantsInCircle(
                { x: center.x, y: center.y, level: caster.level },
                delivery.radiusTiles * TILE_SIZE,
                candidates,
            );
        }
    }
}

export type PendingDelayedDelivery = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
    readonly caster: Combatant;
    readonly effect: AbilityEffect<DelayedCircleDelivery>;
    readonly startSeconds: number;
    readonly strikeAtSeconds: number;
};

export function delayedDeliveryProgress(
    pending: Pick<PendingDelayedDelivery, "startSeconds" | "strikeAtSeconds">,
    timeSeconds: number,
): number {
    const totalSeconds = pending.strikeAtSeconds - pending.startSeconds;
    if (totalSeconds <= 0) {
        return 1;
    }
    return clamp((timeSeconds - pending.startSeconds) / totalSeconds, 0, 1);
}
