import { TransformableGroundDecorations } from "./LocTransform";
import { TILE_SIZE, Terrain } from "./Terrain";
import type { WardenP3Tile } from "./WardenP3Director";
import { WardenSlamTarget } from "./WardenP3SlamTarget";
import { RandomSource } from "./abilityRules";

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

declare const arenaFloorBrand: unique symbol;

// The enrage pulls the floor in chunks of tiles from the furthest row inward and finishes a row
// before starting the next, so the pulled floor is always the rows beyond the edge row, gone whole,
// plus whichever edge row tiles are already pulled. Only this module builds one, so no other shape
// of removed floor can exist.
export type WardenP3ArenaFloor = {
    readonly clearedRowCount: number;
    readonly pulledEdgeTileXs: ReadonlySet<number>;
    readonly [arenaFloorBrand]: true;
};

export type WardenP3PulledTiles = {
    readonly floor: WardenP3ArenaFloor;
    readonly tiles: readonly WardenP3ArenaTile[];
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

// The row of the Warden's back edge, the far side from the floor.
export const WARDEN_P3_BACK_TILE_Y = WARDEN_P3_SPAWN_TILE.y - WARDEN_P3_NPC_HALF_SIZE;

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

function arenaFloor(
    clearedRowCount: number,
    pulledEdgeTileXs: ReadonlySet<number>,
): WardenP3ArenaFloor {
    return { clearedRowCount, pulledEdgeTileXs } as WardenP3ArenaFloor;
}

export const WARDEN_P3_INITIAL_ARENA_FLOOR: WardenP3ArenaFloor = arenaFloor(0, new Set());

const CENTRE_X = WARDEN_P3_FRONT_CENTRE_TILE.x;
const ARENA_ROW_COUNT = WARDEN_P3_FLOOR_ROWS.length;
// The Warden-adjacent row is never pulled.
const MAX_CLEARED_ROW_COUNT = ARENA_ROW_COUNT - 1;

function assertFiniteInteger(value: number, description: string): void {
    if (!Number.isInteger(value)) {
        throw new RangeError(`${description} must be an integer`);
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

export const WARDEN_P3_FLOOR_TILES: readonly WardenP3ArenaTile[] =
    WARDEN_P3_FLOOR_ROWS.flatMap(wardenP3RowTiles);

// Deterministic per-tile noise in [-1, 1).
export function wardenP3TileNoise(tile: WardenP3ArenaTile, salt: number): number {
    let hash = Math.imul(tile.x, 0x27d4eb2d) ^ Math.imul(tile.y, 0x165667b1) ^ salt;
    hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    hash ^= hash >>> 16;
    return ((hash >>> 0) / 0x100000000) * 2 - 1;
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

function edgeRowDistance(floor: WardenP3ArenaFloor): number {
    return ARENA_ROW_COUNT - floor.clearedRowCount;
}

export function wardenP3TileOccupancy(
    floor: WardenP3ArenaFloor,
    tile: WardenP3ArenaTile,
): WardenP3ArenaTileOccupancy {
    const row = wardenP3RowForTile(tile);
    if (!row) {
        return WardenP3ArenaTileOccupancy.OUTSIDE_FLOOR;
    }
    const edgeDistance = edgeRowDistance(floor);
    if (
        row.distanceFromWarden > edgeDistance ||
        (row.distanceFromWarden === edgeDistance && floor.pulledEdgeTileXs.has(tile.x))
    ) {
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

// Rows nearest the Warden first, west to east within a row.
export function wardenP3SolidFloorTiles(floor: WardenP3ArenaFloor): readonly WardenP3ArenaTile[] {
    return WARDEN_P3_FLOOR_TILES.filter((tile) => canOccupyWardenP3ArenaTile(floor, tile));
}

// The edge row's remaining tiles; none once only the Warden-adjacent row is left.
export function wardenP3PullableTiles(floor: WardenP3ArenaFloor): readonly WardenP3ArenaTile[] {
    if (floor.clearedRowCount === MAX_CLEARED_ROW_COUNT) {
        return [];
    }
    return wardenP3RowTiles(wardenP3ArenaRow(edgeRowDistance(floor))).filter(
        (tile) => !floor.pulledEdgeTileXs.has(tile.x),
    );
}

// A partial Fisher-Yates shuffle: count distinct tiles drawn uniformly from pool, or all of it when
// it holds fewer.
export function drawDistinctWardenP3Tiles(
    pool: readonly WardenP3ArenaTile[],
    count: number,
    random: RandomSource,
): readonly WardenP3ArenaTile[] {
    if (!Number.isInteger(count) || count < 0) {
        throw new RangeError("The number of tiles to draw must be a non-negative integer");
    }
    const shuffled = [...pool];
    const drawCount = Math.min(count, shuffled.length);
    for (let index = 0; index < drawCount; index++) {
        const swapIndex = index + Math.floor(random() * (shuffled.length - index));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled.slice(0, drawCount);
}

// How many tiles the next pull takes: a row goes in chunksPerRow chunks as even as its width
// allows, the larger ones first, so a chunk's size follows from how much of the edge row is gone.
export function wardenP3NextPullCount(floor: WardenP3ArenaFloor, chunksPerRow: number): number {
    if (!Number.isInteger(chunksPerRow) || chunksPerRow < 1) {
        throw new RangeError("A row must be pulled in a positive whole number of chunks");
    }
    if (wardenP3PullableTiles(floor).length === 0) {
        throw new Error("Only the Warden-adjacent row is left, and it is never pulled");
    }
    const width = wardenP3RowTiles(wardenP3ArenaRow(edgeRowDistance(floor))).length;
    const pulled = floor.pulledEdgeTileXs.size;
    const smallChunk = Math.floor(width / chunksPerRow);
    const largeChunkCount = width % chunksPerRow;
    let chunkEnd = 0;
    for (let chunk = 0; chunk < chunksPerRow; chunk++) {
        chunkEnd += smallChunk + (chunk < largeChunkCount ? 1 : 0);
        if (chunkEnd > pulled) {
            return chunkEnd - pulled;
        }
    }
    throw new Error(`The edge row has ${pulled} of its ${width} tiles pulled and some left`);
}

// Pulls count random tiles of the edge row; its last tile clears the row, so the next pull starts
// on the row inside it.
export function pullWardenP3ArenaTiles(
    floor: WardenP3ArenaFloor,
    count: number,
    random: RandomSource,
): WardenP3PulledTiles {
    const pullable = wardenP3PullableTiles(floor);
    if (pullable.length === 0) {
        throw new Error("Only the Warden-adjacent row is left, and it is never pulled");
    }
    if (!Number.isInteger(count) || count < 1 || count > pullable.length) {
        throw new RangeError(
            `A pull takes between 1 and the edge row's ${pullable.length} tiles, not ${count}`,
        );
    }
    const tiles = drawDistinctWardenP3Tiles(pullable, count, random);
    if (tiles.length === pullable.length) {
        return { tiles, floor: arenaFloor(floor.clearedRowCount + 1, new Set()) };
    }
    return {
        tiles,
        floor: arenaFloor(
            floor.clearedRowCount,
            new Set([...floor.pulledEdgeTileXs, ...tiles.map((tile) => tile.x)]),
        ),
    };
}

function isOccupied(
    occupied: readonly WardenP3Tile[],
    level: number,
    x: number,
    y: number,
): boolean {
    return occupied.some((tile) => tile.level === level && tile.x === x && tile.y === y);
}

// Where a player is thrown when the floor goes from under them or a siphon lands on them: the
// closest solid tile nothing stands on, the one nearer the Warden on a tie, since the floor is
// pulled from the outside in.
export function nearestOpenWardenP3Tile(
    floor: WardenP3ArenaFloor,
    occupied: readonly WardenP3Tile[],
    from: WardenP3ArenaTile,
): WardenP3ArenaTile {
    const distanceSquared = (tile: WardenP3ArenaTile) =>
        (tile.x - from.x) * (tile.x - from.x) + (tile.y - from.y) * (tile.y - from.y);
    const open = wardenP3SolidFloorTiles(floor).filter(
        (tile) => !isOccupied(occupied, tile.level, tile.x, tile.y),
    );
    if (open.length === 0) {
        throw new Error("Every solid Wardens P3 floor tile is occupied");
    }
    return open.reduce((nearest, candidate) =>
        distanceSquared(candidate) < distanceSquared(nearest) ? candidate : nearest,
    );
}

// Composes the sim's base Terrain with the arena's floor state and whatever stands on it, so every
// movement path that consults Terrain.canOccupy (pathing, chase steering, click-to-walk, the
// player's own movement) rejects pulled and occupied tiles the same way it rejects any other
// blocked tile.
export function wardenP3ArenaTerrain(
    base: Terrain,
    floor: WardenP3ArenaFloor,
    occupied: readonly WardenP3Tile[],
): Terrain {
    return {
        isLoaded: (level, x, y) => base.isLoaded(level, x, y),
        getWallFlag: (level, tileX, tileY) => base.getWallFlag(level, tileX, tileY),
        getHeight: (level, x, y) => base.getHeight(level, x, y),
        canOccupy: (level, x, y) => {
            if (!base.canOccupy(level, x, y)) {
                return false;
            }
            const tileX = Math.floor(x / TILE_SIZE);
            const tileY = Math.floor(y / TILE_SIZE);
            if (isOccupied(occupied, level, tileX, tileY)) {
                return false;
            }
            if (level !== WARDEN_P3_LEVEL) {
                return true;
            }
            return (
                wardenP3TileOccupancy(floor, wardenP3ArenaTile(tileX, tileY)) !==
                WardenP3ArenaTileOccupancy.DESTROYED_FLOOR
            );
        },
    };
}

export const WARDEN_P3_ARENA_ROW_COUNT = ARENA_ROW_COUNT;

// The floor's ground decorations sit on the map square's level 1 while the fight's actors stand on
// level 0 (see WARDEN_P3_LEVEL), hence the separate level.
// 2228 SPOTANIM_WARDENS_TILES01 is the tile the Warden pulls, drawn as a slab: 45648's top with
// sides and a bottom.
export const WARDEN_P3_FLOOR_DECORATIONS: TransformableGroundDecorations = {
    level: 1,
    locIds: [45646, 45647, 45648],
    tiles: WARDEN_P3_FLOOR_TILES,
    slabSpotAnimId: 2228,
};
