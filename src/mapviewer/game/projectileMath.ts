import { RS_TO_RADIANS } from "../../rs/MathConstants";
import { Combatant, Faction } from "./Combatant";

export type ProjectileArcProfile = {
    baseHeight: number;
    heightPerDistance: number;
    maxHeight: number;
};

export function directionToRotation(directionX: number, directionY: number): number {
    return ((Math.atan2(directionX, directionY) / (Math.PI * 2)) * 2048 + 1024) & 2047;
}

export function reaimTowardTarget(
    directionX: number,
    directionY: number,
    fromX: number,
    fromY: number,
    targetX: number,
    targetY: number,
): { x: number; y: number } {
    const deltaX = targetX - fromX;
    const deltaY = targetY - fromY;
    const length = Math.hypot(deltaX, deltaY);
    if (length === 0) {
        return { x: directionX, y: directionY };
    }
    return { x: deltaX / length, y: deltaY / length };
}

export function computeArcOffset(
    distanceTraveled: number,
    referenceDistance: number,
    arc: ProjectileArcProfile,
): number {
    if (referenceDistance <= 0) {
        return 0;
    }
    const progress = Math.min(distanceTraveled / referenceDistance, 1);
    const peakHeight = Math.min(
        arc.baseHeight + referenceDistance * arc.heightPerDistance,
        arc.maxHeight,
    );
    return peakHeight * 4 * progress * (1 - progress);
}

export function sweepCircleHitFraction(
    prevX: number,
    prevY: number,
    nextX: number,
    nextY: number,
    circleX: number,
    circleY: number,
    radius: number,
): number | undefined {
    const deltaX = nextX - prevX;
    const deltaY = nextY - prevY;
    const offsetX = prevX - circleX;
    const offsetY = prevY - circleY;

    const a = deltaX * deltaX + deltaY * deltaY;
    const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
    if (c <= 0) {
        return 0;
    }
    if (a === 0) {
        return undefined;
    }

    const b = 2 * (offsetX * deltaX + offsetY * deltaY);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
        return undefined;
    }

    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    return t >= 0 && t <= 1 ? t : undefined;
}

export function findSweepHit<T extends Combatant>(
    prevX: number,
    prevY: number,
    nextX: number,
    nextY: number,
    projectileRadius: number,
    level: number,
    sourceFaction: Faction,
    combatants: readonly T[],
    excluded?: ReadonlySet<T>,
): { combatant: T; fraction: number } | undefined {
    let closest: { combatant: T; fraction: number } | undefined;
    for (const combatant of combatants) {
        if (
            combatant.level !== level ||
            combatant.faction === sourceFaction ||
            combatant.health <= 0 ||
            excluded?.has(combatant)
        ) {
            continue;
        }
        const fraction = sweepCircleHitFraction(
            prevX,
            prevY,
            nextX,
            nextY,
            combatant.x,
            combatant.y,
            projectileRadius + combatant.hitRadius,
        );
        if (fraction === undefined) {
            continue;
        }
        if (!closest || fraction < closest.fraction) {
            closest = { combatant, fraction };
        }
    }
    return closest;
}

export function rotationToDirection(rotation: number): { x: number; y: number } {
    const theta = (rotation - 1024) * RS_TO_RADIANS;
    return { x: Math.sin(theta), y: Math.cos(theta) };
}

export function rotationAngleDifference(a: number, b: number): number {
    const diff = Math.abs(a - b) & 2047;
    return diff > 1024 ? 2048 - diff : diff;
}

export function isPointInCone(
    originX: number,
    originY: number,
    facingRotation: number,
    totalAngleRadians: number,
    reach: number,
    pointX: number,
    pointY: number,
): boolean {
    const dx = pointX - originX;
    const dy = pointY - originY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0 || distance > reach) {
        return false;
    }
    const targetRotation = directionToRotation(dx, dy);
    const angleDifferenceRadians =
        rotationAngleDifference(facingRotation, targetRotation) * RS_TO_RADIANS;
    return angleDifferenceRadians <= totalAngleRadians / 2;
}

export function isWithinTileArea(
    centerX: number,
    centerY: number,
    radiusTiles: number,
    pointX: number,
    pointY: number,
): boolean {
    const tileDx = Math.floor(pointX / 128) - Math.floor(centerX / 128);
    const tileDy = Math.floor(pointY / 128) - Math.floor(centerY / 128);
    return Math.max(Math.abs(tileDx), Math.abs(tileDy)) <= radiusTiles;
}

export function generateSpreadDirections(
    baseRotation: number,
    spreadAngleRadians: number,
    count: number,
): number[] {
    if (count <= 1) {
        return [baseRotation & 2047];
    }
    const spreadUnits = spreadAngleRadians / RS_TO_RADIANS;
    const step = spreadUnits / (count - 1);
    const start = baseRotation - spreadUnits / 2;
    return Array.from({ length: count }, (_, i) => Math.round(start + step * i) & 2047);
}
