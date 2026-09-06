import { CollisionFlag } from "../../rs/pathfinder/flag/CollisionFlag";
import { Terrain } from "./Terrain";

const MAX_STEP_UNITS = 16;

export function resolveMovement(
    terrain: Terrain,
    level: number,
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
): { x: number; y: number } {
    const steps = Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / MAX_STEP_UNITS);
    if (steps === 0) {
        return { x, y };
    }

    let currentX = x;
    let currentY = y;
    for (let step = 0; step < steps; step++) {
        currentX = moveAxis(terrain, level, currentX, currentY, deltaX / steps, true);
        currentY = moveAxis(terrain, level, currentX, currentY, deltaY / steps, false);
    }
    return { x: currentX, y: currentY };
}

function moveAxis(
    terrain: Terrain,
    level: number,
    x: number,
    y: number,
    delta: number,
    isX: boolean,
): number {
    const next = isX ? x + delta : y + delta;
    if (!terrain.canOccupy(level, isX ? next : x, isX ? y : next)) {
        return isX ? x : y;
    }

    const currentTileX = x >> 7;
    const currentTileY = y >> 7;
    const nextTileX = (isX ? next : x) >> 7;
    const nextTileY = (isX ? y : next) >> 7;
    if (currentTileX === nextTileX && currentTileY === nextTileY) {
        return next;
    }

    const sourceFlag = terrain.getWallFlag(level, currentTileX, currentTileY);
    const targetFlag = terrain.getWallFlag(level, nextTileX, nextTileY);
    const blocked =
        (isX &&
            delta > 0 &&
            ((sourceFlag & CollisionFlag.WALL_EAST) !== 0 ||
                (targetFlag & CollisionFlag.WALL_WEST) !== 0)) ||
        (isX &&
            delta < 0 &&
            ((sourceFlag & CollisionFlag.WALL_WEST) !== 0 ||
                (targetFlag & CollisionFlag.WALL_EAST) !== 0)) ||
        (!isX &&
            delta > 0 &&
            ((sourceFlag & CollisionFlag.WALL_NORTH) !== 0 ||
                (targetFlag & CollisionFlag.WALL_SOUTH) !== 0)) ||
        (!isX &&
            delta < 0 &&
            ((sourceFlag & CollisionFlag.WALL_SOUTH) !== 0 ||
                (targetFlag & CollisionFlag.WALL_NORTH) !== 0));
    return blocked ? (isX ? x : y) : next;
}
