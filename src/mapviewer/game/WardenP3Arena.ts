import type { WardenP3SiphonLayout as SiphonLayout } from "./WardenP3SiphonLayout";

export { validateWardenP3SiphonLayout } from "./WardenP3SiphonLayout";
export type { WardenP3SiphonLayout } from "./WardenP3SiphonLayout";

export enum WardenP3FloorSlam {
    RIGHT = "right",
    LEFT = "left",
    CENTRE = "centre",
}

export enum WardenP3ArenaTileOccupancy {
    OUTSIDE_PLATFORM = "outside_platform",
    SOLID_FLOOR = "solid_floor",
    DESTROYED_FLOOR = "destroyed_floor",
}

export type WardenP3ArenaTile = {
    readonly x: number;
    readonly y: number;
    readonly level: 0;
};

export type WardenP3ArenaRow = {
    readonly distanceFromWarden: number;
};

export type WardenP3ArenaFloor = {
    readonly destroyedRowCount: number;
};

export const WARDEN_P3_PLATFORM = {
    minimumX: 3922,
    maximumX: 3950,
    minimumY: 5139,
    maximumY: 5166,
    level: 0,
} as const;

export const WARDEN_P3_WARDEN_TILE = {
    x: 3936,
    y: 5156,
    level: 0,
} as const;

export const WARDEN_P3_INITIAL_ARENA_FLOOR: WardenP3ArenaFloor = {
    destroyedRowCount: 0,
};

export const WARDEN_P3_SLAM_TRAVEL_SECONDS = 1.2;
export const WARDEN_P3_SLAM_ACTIVE_SECONDS = 0.32;

export const WARDEN_P3_SOLO_SIPHON_LAYOUT: SiphonLayout = {
    spawns: [
        { x: 3929, y: 5159, level: 0, rotation: 0 },
        { x: 3943, y: 5159, level: 0, rotation: 0 },
        { x: 3929, y: 5164, level: 0, rotation: 0 },
        { x: 3943, y: 5164, level: 0, rotation: 0 },
    ],
    deadlineSeconds: 15,
};

const PLATFORM_WIDTH = WARDEN_P3_PLATFORM.maximumX - WARDEN_P3_PLATFORM.minimumX + 1;
const PLATFORM_HEIGHT = WARDEN_P3_PLATFORM.maximumY - WARDEN_P3_PLATFORM.minimumY + 1;
const CENTRE_X = (WARDEN_P3_PLATFORM.minimumX + WARDEN_P3_PLATFORM.maximumX) / 2;
const ARENA_ROW_COUNT = WARDEN_P3_PLATFORM.maximumY - WARDEN_P3_WARDEN_TILE.y;
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
    return { x, y, level: WARDEN_P3_PLATFORM.level };
}

export function isWardenP3PlatformTile(tile: WardenP3ArenaTile): boolean {
    return (
        tile.x >= WARDEN_P3_PLATFORM.minimumX &&
        tile.x <= WARDEN_P3_PLATFORM.maximumX &&
        tile.y >= WARDEN_P3_PLATFORM.minimumY &&
        tile.y <= WARDEN_P3_PLATFORM.maximumY
    );
}

export function wardenP3ArenaRow(distanceFromWarden: number): WardenP3ArenaRow {
    assertFiniteInteger(distanceFromWarden, "Warden P3 row distance");
    if (distanceFromWarden < 1 || distanceFromWarden > ARENA_ROW_COUNT) {
        throw new RangeError(`Warden P3 row distance must be within 1..${ARENA_ROW_COUNT}`);
    }
    return { distanceFromWarden };
}

export function wardenP3RowTileY(row: WardenP3ArenaRow): number {
    return WARDEN_P3_WARDEN_TILE.y + row.distanceFromWarden;
}

export function wardenP3RowForTile(tile: WardenP3ArenaTile): WardenP3ArenaRow | undefined {
    if (!isWardenP3PlatformTile(tile)) {
        return undefined;
    }
    const distanceFromWarden = tile.y - WARDEN_P3_WARDEN_TILE.y;
    if (distanceFromWarden < 1 || distanceFromWarden > ARENA_ROW_COUNT) {
        return undefined;
    }
    return wardenP3ArenaRow(distanceFromWarden);
}

export function wardenP3FloorSlamTiles(target: WardenP3FloorSlam): readonly WardenP3ArenaTile[] {
    if (target === WardenP3FloorSlam.CENTRE) {
        return [
            ...platformTiles(
                WARDEN_P3_PLATFORM.minimumX,
                CENTRE_X - 2,
                WARDEN_P3_WARDEN_TILE.y + 1,
                WARDEN_P3_PLATFORM.maximumY,
            ),
            ...platformTiles(
                CENTRE_X + 2,
                WARDEN_P3_PLATFORM.maximumX,
                WARDEN_P3_WARDEN_TILE.y + 1,
                WARDEN_P3_PLATFORM.maximumY,
            ),
        ];
    }
    const xRange = slamXRange(target);
    return platformTiles(
        xRange.minimum,
        xRange.maximum,
        WARDEN_P3_WARDEN_TILE.y + 1,
        WARDEN_P3_PLATFORM.maximumY,
    );
}

export type WardenP3FloorSlamWaveTile = {
    readonly tile: WardenP3ArenaTile;
    readonly delaySeconds: number;
    readonly damaging: boolean;
};

export function wardenP3FloorSlamWave(
    target: WardenP3FloorSlam,
): readonly WardenP3FloorSlamWaveTile[] {
    const secondsPerRow = WARDEN_P3_SLAM_TRAVEL_SECONDS / (ARENA_ROW_COUNT - 1);
    const wave: WardenP3FloorSlamWaveTile[] = [];
    for (let distance = 1; distance <= ARENA_ROW_COUNT; distance++) {
        const y = WARDEN_P3_WARDEN_TILE.y + distance;
        const delaySeconds = (distance - 1) * secondsPerRow;
        const horizontal = wardenP3FloorSlamTiles(target).filter((tile) => tile.y === y);
        for (const tile of horizontal) {
            wave.push({ tile, delaySeconds, damaging: true });
        }
        if (target === WardenP3FloorSlam.CENTRE) {
            continue;
        }
        const edgeX =
            target === WardenP3FloorSlam.LEFT
                ? WARDEN_P3_PLATFORM.minimumX
                : WARDEN_P3_PLATFORM.maximumX;
        for (let edgeY = WARDEN_P3_WARDEN_TILE.y + 1; edgeY < y; edgeY++) {
            wave.push({ tile: wardenP3ArenaTile(edgeX, edgeY), delaySeconds, damaging: false });
        }
    }
    return wave;
}

export function wardenP3RowTiles(row: WardenP3ArenaRow): readonly WardenP3ArenaTile[] {
    return platformTiles(
        WARDEN_P3_PLATFORM.minimumX,
        WARDEN_P3_PLATFORM.maximumX,
        wardenP3RowTileY(row),
        wardenP3RowTileY(row),
    );
}

export function wardenP3TileOccupancy(
    floor: WardenP3ArenaFloor,
    tile: WardenP3ArenaTile,
): WardenP3ArenaTileOccupancy {
    assertDestroyedRowCount(floor);
    const row = wardenP3RowForTile(tile);
    if (!row) {
        return WardenP3ArenaTileOccupancy.OUTSIDE_PLATFORM;
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

function slamXRange(target: WardenP3FloorSlam): {
    readonly minimum: number;
    readonly maximum: number;
} {
    switch (target) {
        case WardenP3FloorSlam.RIGHT:
            return { minimum: CENTRE_X, maximum: WARDEN_P3_PLATFORM.maximumX };
        case WardenP3FloorSlam.LEFT:
            return { minimum: WARDEN_P3_PLATFORM.minimumX, maximum: CENTRE_X };
        case WardenP3FloorSlam.CENTRE:
            throw new Error("Centre slam range is disjoint");
    }
}

function platformTiles(
    minimumX: number,
    maximumX: number,
    minimumY: number,
    maximumY: number,
): WardenP3ArenaTile[] {
    const tiles: WardenP3ArenaTile[] = [];
    for (let y = minimumY; y <= maximumY; y++) {
        for (let x = minimumX; x <= maximumX; x++) {
            tiles.push(wardenP3ArenaTile(x, y));
        }
    }
    return tiles;
}

export const WARDEN_P3_PLATFORM_WIDTH = PLATFORM_WIDTH;
export const WARDEN_P3_PLATFORM_HEIGHT = PLATFORM_HEIGHT;
export const WARDEN_P3_ARENA_ROW_COUNT = ARENA_ROW_COUNT;
