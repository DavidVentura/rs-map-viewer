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
import { RandomSource, isWithinMeleeReach } from "./abilityRules";
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

// Each tile a cone covers gets its own ground graphic, staggered by its distance from the caster so
// the impact ripples outward, and jittered off the tile centre so the copies don't read as a grid.
export const CONE_TILE_STAGGER_SECONDS = 0.05;
export const CONE_TILE_MAX_JITTER = TILE_SIZE / 3;

export type ConeTileSpawn = {
    readonly x: number;
    readonly y: number;
    readonly delaySeconds: number;
};

// The tiles whose centres lie in the cone, the caster's own tile excluded, nearest first.
export function coneTileSpawns(
    originX: number,
    originY: number,
    facingRotation: number,
    delivery: ConeDelivery,
    random: RandomSource,
): ConeTileSpawn[] {
    const originTileX = Math.floor(originX / TILE_SIZE);
    const originTileY = Math.floor(originY / TILE_SIZE);
    const reachTiles = Math.ceil(delivery.reach / TILE_SIZE);
    const covered: { centerX: number; centerY: number; distanceTiles: number }[] = [];
    for (let tileY = originTileY - reachTiles; tileY <= originTileY + reachTiles; tileY++) {
        for (let tileX = originTileX - reachTiles; tileX <= originTileX + reachTiles; tileX++) {
            if (tileX === originTileX && tileY === originTileY) {
                continue;
            }
            const centerX = (tileX + 0.5) * TILE_SIZE;
            const centerY = (tileY + 0.5) * TILE_SIZE;
            const inCone = isPointInCone(
                originX,
                originY,
                facingRotation,
                delivery.angleRadians,
                delivery.reach,
                centerX,
                centerY,
            );
            if (!inCone) {
                continue;
            }
            const distanceTiles = Math.hypot(centerX - originX, centerY - originY) / TILE_SIZE;
            covered.push({ centerX, centerY, distanceTiles });
        }
    }
    covered.sort((a, b) => a.distanceTiles - b.distanceTiles);
    return covered.map((tile) => {
        const jitterAngle = random() * Math.PI * 2;
        const jitterRadius = random() * CONE_TILE_MAX_JITTER;
        return {
            x: tile.centerX + Math.sin(jitterAngle) * jitterRadius,
            y: tile.centerY + Math.cos(jitterAngle) * jitterRadius,
            delaySeconds: tile.distanceTiles * CONE_TILE_STAGGER_SECONDS,
        };
    });
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
