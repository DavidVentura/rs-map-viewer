export interface SteeringBody {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly hitRadius: number;
}

export const DEFAULT_SEPARATION_MARGIN = 32;

export function computeSeparation(
    self: SteeringBody,
    neighbours: readonly SteeringBody[],
    margin: number = DEFAULT_SEPARATION_MARGIN,
): { x: number; y: number } {
    let pushX = 0;
    let pushY = 0;
    for (const neighbour of neighbours) {
        if (neighbour.id === self.id) {
            continue;
        }
        const dx = self.x - neighbour.x;
        const dy = self.y - neighbour.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = self.hitRadius + neighbour.hitRadius + margin;
        if (distance >= minDistance) {
            continue;
        }
        const overlap = minDistance - distance;
        const direction =
            distance > 0
                ? { x: dx / distance, y: dy / distance }
                : fallbackDirection(self.id, neighbour.id);
        pushX += direction.x * overlap;
        pushY += direction.y * overlap;
    }
    return normalize(pushX, pushY);
}

export function steerChase(
    chaseDirX: number,
    chaseDirY: number,
    touchingPlayer: boolean,
    self: SteeringBody,
    neighbours: readonly SteeringBody[],
    margin: number = DEFAULT_SEPARATION_MARGIN,
): { x: number; y: number } {
    const separation = computeSeparation(self, neighbours, margin);
    if (touchingPlayer) {
        const lateral = removeForwardComponent(separation.x, separation.y, chaseDirX, chaseDirY);
        return normalize(lateral.x, lateral.y);
    }
    return normalize(chaseDirX + separation.x, chaseDirY + separation.y);
}

function removeForwardComponent(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
): { x: number; y: number } {
    const dot = x * dirX + y * dirY;
    if (dot <= 0) {
        return { x, y };
    }
    return { x: x - dot * dirX, y: y - dot * dirY };
}

function fallbackDirection(selfId: number, neighbourId: number): { x: number; y: number } {
    return selfId > neighbourId ? { x: 1, y: 0 } : { x: -1, y: 0 };
}

function normalize(x: number, y: number): { x: number; y: number } {
    const length = Math.hypot(x, y);
    if (length === 0) {
        return { x: 0, y: 0 };
    }
    return { x: x / length, y: y / length };
}
