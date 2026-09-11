import { RS_TO_RADIANS } from "../../rs/MathConstants";
import { Combatant, Faction } from "./Combatant";

export function directionToRotation(directionX: number, directionY: number): number {
    return ((Math.atan2(directionX, directionY) / (Math.PI * 2)) * 2048 + 1024) & 2047;
}

export function pitchRadiansToRotationUnits(pitchRadians: number): number {
    return Math.round(pitchRadians / RS_TO_RADIANS) & 2047;
}

export type FlightPoint = {
    readonly x: number;
    readonly y: number;
};

export type FlightOrigin = {
    readonly x: number;
    readonly y: number;
    readonly height: number;
};

export type FlightState = FlightOrigin & {
    readonly verticalVelocity: number;
    readonly secondsToArrival: number;
};

export type FlightStep = {
    readonly state: FlightState;
    readonly rotation: number;
    readonly pitch: number;
    readonly arrived: boolean;
};

// The OSRS client's projectile model: the horizontal velocity is whatever covers the remaining
// distance in the remaining time, the initial vertical velocity is fixed by the launch angle, and
// the vertical acceleration is re-solved every step so the shot always meets endHeight exactly at
// arrival, even when the target point moves between steps.
export function launchFlight(
    start: FlightOrigin,
    target: FlightPoint,
    launchAngleRadians: number,
    travelSeconds: number,
): FlightState {
    if (travelSeconds <= 0) {
        throw new Error(`Flight travel time must be positive, got ${travelSeconds}`);
    }
    const speed = Math.hypot(target.x - start.x, target.y - start.y) / travelSeconds;
    return {
        x: start.x,
        y: start.y,
        height: start.height,
        verticalVelocity: speed * Math.tan(launchAngleRadians),
        secondsToArrival: travelSeconds,
    };
}

export function stepFlight(
    state: FlightState,
    target: FlightPoint,
    endHeight: number,
    dtSeconds: number,
): FlightStep {
    const remaining = state.secondsToArrival;
    const velocityX = (target.x - state.x) / remaining;
    const velocityY = (target.y - state.y) / remaining;
    const speed = Math.hypot(velocityX, velocityY);
    const acceleration =
        (2 * (endHeight - state.height - state.verticalVelocity * remaining)) /
        (remaining * remaining);
    const rotation = directionToRotation(velocityX, velocityY);
    const arrived = remaining <= dtSeconds;
    const elapsed = arrived ? remaining : dtSeconds;
    const verticalVelocity = state.verticalVelocity + acceleration * elapsed;
    const pitch = pitchRadiansToRotationUnits(Math.atan2(verticalVelocity, speed));

    if (arrived) {
        return {
            state: {
                x: target.x,
                y: target.y,
                height: endHeight,
                verticalVelocity,
                secondsToArrival: 0,
            },
            rotation,
            pitch,
            arrived,
        };
    }
    return {
        state: {
            x: state.x + velocityX * elapsed,
            y: state.y + velocityY * elapsed,
            height:
                state.height +
                state.verticalVelocity * elapsed +
                0.5 * acceleration * elapsed * elapsed,
            verticalVelocity,
            secondsToArrival: remaining - elapsed,
        },
        rotation,
        pitch,
        arrived,
    };
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
