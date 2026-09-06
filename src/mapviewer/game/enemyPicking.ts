export type ScreenPoint = {
    readonly x: number;
    readonly y: number;
};

export type ScreenRect = {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
};

export type EnemyScreenCandidate = {
    readonly id: number;
    readonly rect: ScreenRect;
};

export function distanceToRect(point: ScreenPoint, rect: ScreenRect): number {
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    return Math.hypot(dx, dy);
}

export function pickEnemyNear(
    cursor: ScreenPoint,
    candidates: readonly EnemyScreenCandidate[],
    radiusPx: number,
): number | undefined {
    let bestId: number | undefined;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        const distance = distanceToRect(cursor, candidate.rect);
        if (distance > radiusPx || distance >= bestDistance) {
            continue;
        }
        bestId = candidate.id;
        bestDistance = distance;
    }
    return bestId;
}
