import { TransformableGroundDecorations } from "./LocTransform";
import { TILE_SIZE, Terrain } from "./Terrain";
import type { WardenP3SiphonLayout as SiphonLayout } from "./WardenP3SiphonLayout";
import { WardenSlamTarget } from "./WardenP3SlamTarget";

export { validateWardenP3SiphonLayout } from "./WardenP3SiphonLayout";
export type { WardenP3SiphonLayout } from "./WardenP3SiphonLayout";
export { WardenSlamTarget } from "./WardenP3SlamTarget";

export enum WardenP3ArenaTileOccupancy {
    OUTSIDE_FLOOR = "outside_floor",
    SOLID_FLOOR = "solid_floor",
    DESTROYED_FLOOR = "destroyed_floor",
}

export const WARDEN_P3_LEVEL = 0;

export type WardenP3ArenaTile = {
    readonly x: number;
    readonly y: number;
    readonly level: 0;
};

export type WardenP3ArenaRow = {
    readonly distanceFromWarden: number;
    readonly minimumX: number;
    readonly maximumX: number;
};

export type WardenP3ArenaFloor = {
    readonly destroyedRowCount: number;
};

export const WARDEN_P3_FRONT_CENTRE_TILE = {
    x: 3936,
    y: 5156,
    level: WARDEN_P3_LEVEL,
} as const;

// Tumeken's Warden is a size-5 NPC.
const WARDEN_P3_NPC_HALF_SIZE = 2;

export const WARDEN_P3_SPAWN_TILE = {
    x: WARDEN_P3_FRONT_CENTRE_TILE.x,
    y: WARDEN_P3_FRONT_CENTRE_TILE.y - WARDEN_P3_NPC_HALF_SIZE,
    level: WARDEN_P3_LEVEL,
} as const;

// Read tile-by-tile from the cache's ground decoration locs (45646/45647/45648, level 1, map
// square 61,80).
const WARDEN_P3_FLOOR_ROWS: readonly WardenP3ArenaRow[] = [
    { distanceFromWarden: 1, minimumX: 3932, maximumX: 3940 },
    { distanceFromWarden: 2, minimumX: 3931, maximumX: 3941 },
    { distanceFromWarden: 3, minimumX: 3930, maximumX: 3942 },
    { distanceFromWarden: 4, minimumX: 3929, maximumX: 3943 },
    { distanceFromWarden: 5, minimumX: 3928, maximumX: 3944 },
    { distanceFromWarden: 6, minimumX: 3927, maximumX: 3945 },
    { distanceFromWarden: 7, minimumX: 3926, maximumX: 3946 },
    { distanceFromWarden: 8, minimumX: 3926, maximumX: 3946 },
    { distanceFromWarden: 9, minimumX: 3926, maximumX: 3946 },
];

export const WARDEN_P3_INITIAL_ARENA_FLOOR: WardenP3ArenaFloor = {
    destroyedRowCount: 0,
};

export const WARDEN_P3_SOLO_SIPHON_LAYOUT: SiphonLayout = {
    spawns: [
        { x: 3929, y: 5159, level: 0, rotation: 0 },
        { x: 3943, y: 5159, level: 0, rotation: 0 },
        { x: 3929, y: 5164, level: 0, rotation: 0 },
        { x: 3943, y: 5164, level: 0, rotation: 0 },
    ],
    deadlineSeconds: 15,
};

const CENTRE_X = WARDEN_P3_FRONT_CENTRE_TILE.x;
const ARENA_ROW_COUNT = WARDEN_P3_FLOOR_ROWS.length;
const MAX_DESTROYED_ROW_COUNT = ARENA_ROW_COUNT - 1;

function assertFiniteInteger(value: number, description: string): void {
    if (!Number.isInteger(value)) {
        throw new RangeError(`${description} must be an integer`);
    }
}

function assertDestroyedRowCount(floor: WardenP3ArenaFloor): void {
    const { destroyedRowCount } = floor;
    if (!Number.isInteger(destroyedRowCount)) {
        throw new RangeError("destroyedRowCount must be an integer");
    }
    if (destroyedRowCount < 0 || destroyedRowCount > MAX_DESTROYED_ROW_COUNT) {
        throw new RangeError(`destroyedRowCount must be within 0..${MAX_DESTROYED_ROW_COUNT}`);
    }
}

export function wardenP3ArenaTile(x: number, y: number): WardenP3ArenaTile {
    assertFiniteInteger(x, "Warden P3 tile x");
    assertFiniteInteger(y, "Warden P3 tile y");
    return { x, y, level: WARDEN_P3_LEVEL };
}

export function wardenP3ArenaRow(distanceFromWarden: number): WardenP3ArenaRow {
    assertFiniteInteger(distanceFromWarden, "Warden P3 row distance");
    const row = WARDEN_P3_FLOOR_ROWS.find(
        (candidate) => candidate.distanceFromWarden === distanceFromWarden,
    );
    if (!row) {
        throw new RangeError(`Warden P3 row distance must be within 1..${ARENA_ROW_COUNT}`);
    }
    return row;
}

export function wardenP3RowTileY(row: WardenP3ArenaRow): number {
    return WARDEN_P3_FRONT_CENTRE_TILE.y + row.distanceFromWarden;
}

export function wardenP3RowForTile(tile: WardenP3ArenaTile): WardenP3ArenaRow | undefined {
    const row = WARDEN_P3_FLOOR_ROWS.find((candidate) => wardenP3RowTileY(candidate) === tile.y);
    if (!row || tile.x < row.minimumX || tile.x > row.maximumX) {
        return undefined;
    }
    return row;
}

export function wardenP3RowTiles(row: WardenP3ArenaRow): readonly WardenP3ArenaTile[] {
    const y = wardenP3RowTileY(row);
    const tiles: WardenP3ArenaTile[] = [];
    for (let x = row.minimumX; x <= row.maximumX; x++) {
        tiles.push(wardenP3ArenaTile(x, y));
    }
    return tiles;
}

function tileMatchesSlamTarget(x: number, target: WardenSlamTarget): boolean {
    switch (target) {
        case WardenSlamTarget.RIGHT:
            return x >= CENTRE_X;
        case WardenSlamTarget.LEFT:
            return x <= CENTRE_X;
        case WardenSlamTarget.CENTRE:
            return x !== CENTRE_X;
    }
}

export function wardenP3FloorSlamTiles(target: WardenSlamTarget): readonly WardenP3ArenaTile[] {
    return WARDEN_P3_FLOOR_ROWS.flatMap((row) =>
        wardenP3RowTiles(row).filter((tile) => tileMatchesSlamTarget(tile.x, target)),
    );
}

export function wardenP3TileOccupancy(
    floor: WardenP3ArenaFloor,
    tile: WardenP3ArenaTile,
): WardenP3ArenaTileOccupancy {
    assertDestroyedRowCount(floor);
    const row = wardenP3RowForTile(tile);
    if (!row) {
        return WardenP3ArenaTileOccupancy.OUTSIDE_FLOOR;
    }
    if (row.distanceFromWarden > ARENA_ROW_COUNT - floor.destroyedRowCount) {
        return WardenP3ArenaTileOccupancy.DESTROYED_FLOOR;
    }
    return WardenP3ArenaTileOccupancy.SOLID_FLOOR;
}

export function canOccupyWardenP3ArenaTile(
    floor: WardenP3ArenaFloor,
    tile: WardenP3ArenaTile,
): boolean {
    return wardenP3TileOccupancy(floor, tile) === WardenP3ArenaTileOccupancy.SOLID_FLOOR;
}

// The rendering layer (WebGLMapViewerRenderer) hides floor decoration locs by distanceFromWarden
// rather than tracking a WardenP3ArenaFloor itself.
export function wardenP3DestroyedRowDistances(floor: WardenP3ArenaFloor): readonly number[] {
    assertDestroyedRowCount(floor);
    const distances: number[] = [];
    for (
        let distance = ARENA_ROW_COUNT - floor.destroyedRowCount + 1;
        distance <= ARENA_ROW_COUNT;
        distance++
    ) {
        distances.push(distance);
    }
    return distances;
}

// Composes the sim's base Terrain with the arena's floor state, so every movement path that
// consults Terrain.canOccupy (pathing, chase steering, click-to-walk, the player's own movement)
// rejects destroyed rows the same way it rejects any other blocked tile.
export function wardenP3ArenaTerrain(base: Terrain, floor: WardenP3ArenaFloor): Terrain {
    return {
        isLoaded: (level, x, y) => base.isLoaded(level, x, y),
        getWallFlag: (level, tileX, tileY) => base.getWallFlag(level, tileX, tileY),
        getHeight: (level, x, y) => base.getHeight(level, x, y),
        canOccupy: (level, x, y) => {
            if (!base.canOccupy(level, x, y)) {
                return false;
            }
            if (level !== WARDEN_P3_LEVEL) {
                return true;
            }
            const tile = wardenP3ArenaTile(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
            return (
                wardenP3TileOccupancy(floor, tile) !== WardenP3ArenaTileOccupancy.DESTROYED_FLOOR
            );
        },
    };
}

export type WardenP3DestroyedRow = {
    readonly floor: WardenP3ArenaFloor;
    readonly row: WardenP3ArenaRow;
};

export function destroyFurthestWardenP3ArenaRow(
    floor: WardenP3ArenaFloor,
): WardenP3DestroyedRow | undefined {
    assertDestroyedRowCount(floor);
    if (floor.destroyedRowCount === MAX_DESTROYED_ROW_COUNT) {
        return undefined;
    }
    const row = wardenP3ArenaRow(ARENA_ROW_COUNT - floor.destroyedRowCount);
    return {
        row,
        floor: { destroyedRowCount: floor.destroyedRowCount + 1 },
    };
}

export const WARDEN_P3_ARENA_ROW_COUNT = ARENA_ROW_COUNT;

// The floor's ground decorations sit on the map square's level 1 while the fight's actors stand on
// level 0 (see WARDEN_P3_LEVEL), hence the separate level.
export const WARDEN_P3_FLOOR_DECORATIONS: TransformableGroundDecorations = {
    level: 1,
    locIds: [45646, 45647, 45648],
    tiles: WARDEN_P3_FLOOR_ROWS.flatMap(wardenP3RowTiles),
};
