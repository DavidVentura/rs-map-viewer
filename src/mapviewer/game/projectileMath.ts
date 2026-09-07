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

// SYMMETRIC climbs out of the start and lands at the same baseline, apex at the midpoint (a shot
// fired from ground/body height, like an arrow). DESCENDING starts already at the apex and falls
// from there to the baseline, apex at launch (a shot lobbed from something already elevated, like a
// fireball leaving a boss's raised mouth) — physically the back half of the same parabola, launched
// with zero vertical velocity.
export type ProjectileArcShape = "SYMMETRIC" | "DESCENDING";

function computeArcPeakHeight(referenceDistance: number, arc: ProjectileArcProfile): number {
    return Math.min(arc.baseHeight + referenceDistance * arc.heightPerDistance, arc.maxHeight);
}

export function computeArcOffset(
    distanceTraveled: number,
    referenceDistance: number,
    arc: ProjectileArcProfile,
    shape: ProjectileArcShape,
): number {
    if (referenceDistance <= 0) {
        return 0;
    }
    const progress = Math.min(distanceTraveled / referenceDistance, 1);
    const peakHeight = computeArcPeakHeight(referenceDistance, arc);
    return shape === "SYMMETRIC"
        ? peakHeight * 4 * progress * (1 - progress)
        : peakHeight * (1 - progress * progress);
}

// Tangent angle of the arc's height-over-distance curve, in radians: positive (nose up), negative
// (nose down). For SYMMETRIC that's nose up climbing out of the start, zero at the apex, nose down
// diving into the landing point; for DESCENDING it starts at zero (level, leaving the apex flat) and
// goes increasingly nose down toward the landing point.
export function computeProjectilePitch(
    distanceTraveled: number,
    referenceDistance: number,
    arc: ProjectileArcProfile,
    shape: ProjectileArcShape,
): number {
    if (referenceDistance <= 0) {
        return 0;
    }
    const progress = Math.min(distanceTraveled / referenceDistance, 1);
    const peakHeight = computeArcPeakHeight(referenceDistance, arc);
    const slope =
        shape === "SYMMETRIC"
            ? (peakHeight * 4 * (1 - 2 * progress)) / referenceDistance
            : (-2 * peakHeight * progress) / referenceDistance;
    return Math.atan(slope);
}

export function pitchRadiansToRotationUnits(pitchRadians: number): number {
    return Math.round(pitchRadians / RS_TO_RADIANS) & 2047;
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

// Point-radius hit test for a projectile that lands at a fixed point rather than sweeping its
// path, e.g. an arcing arrow that only checks for a target once it reaches its aimed landing spot.
export function findLandingHit<T extends Combatant>(
    landingX: number,
    landingY: number,
    hitRadius: number,
    level: number,
    sourceFaction: Faction,
    combatants: readonly T[],
): T | undefined {
    let closest: { combatant: T; distanceSquared: number } | undefined;
    for (const combatant of combatants) {
        if (
            combatant.level !== level ||
            combatant.faction === sourceFaction ||
            combatant.health <= 0
        ) {
            continue;
        }
        const deltaX = combatant.x - landingX;
        const deltaY = combatant.y - landingY;
        const radius = hitRadius + combatant.hitRadius;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared > radius * radius) {
            continue;
        }
        if (!closest || distanceSquared < closest.distanceSquared) {
            closest = { combatant, distanceSquared };
        }
    }
    return closest?.combatant;
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
