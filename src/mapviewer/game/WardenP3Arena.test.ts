import { Terrain } from "./Terrain";
import {
    WARDEN_P3_ARENA_ROW_COUNT,
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    WardenP3ArenaTile,
    WardenP3ArenaTileOccupancy,
    canOccupyWardenP3ArenaTile,
    nearestSolidWardenP3Tile,
    pullWardenP3ArenaTile,
    wardenP3ArenaRow,
    wardenP3ArenaTerrain,
    wardenP3ArenaTile,
    wardenP3FloorSlamTiles,
    wardenP3PullableTiles,
    wardenP3RowForTile,
    wardenP3RowTileY,
    wardenP3RowTiles,
    wardenP3SolidFloorTiles,
    wardenP3TileOccupancy,
} from "./WardenP3Arena";
import { WardenSlamTarget } from "./WardenP3SlamTarget";

function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

// Pulls every pullable tile, returning each pull in order.
function pullWholeFloor(random: () => number): {
    readonly pulls: readonly WardenP3ArenaTile[];
    readonly floor: WardenP3ArenaFloor;
} {
    const pulls: WardenP3ArenaTile[] = [];
    let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
    while (wardenP3PullableTiles(floor).length > 0) {
        const pull = pullWardenP3ArenaTile(floor, random);
        expect(wardenP3TileOccupancy(floor, pull.tile)).toBe(
            WardenP3ArenaTileOccupancy.SOLID_FLOOR,
        );
        expect(wardenP3TileOccupancy(pull.floor, pull.tile)).toBe(
            WardenP3ArenaTileOccupancy.DESTROYED_FLOOR,
        );
        pulls.push(pull.tile);
        floor = pull.floor;
    }
    return { pulls, floor };
}

function pullTiles(count: number, random: () => number): WardenP3ArenaFloor {
    let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
    for (let index = 0; index < count; index++) {
        floor = pullWardenP3ArenaTile(floor, random).floor;
    }
    return floor;
}

const ALWAYS_OPEN_TERRAIN: Terrain = {
    isLoaded: () => true,
    canOccupy: () => true,
    getWallFlag: () => 0,
    getHeight: () => 0,
};

describe("Wardens P3 arena", () => {
    it("uses the real 9-row trapezoid floor read from the cache", () => {
        expect(WARDEN_P3_ARENA_ROW_COUNT).toBe(9);
        expect(wardenP3RowTiles(wardenP3ArenaRow(1))).toHaveLength(9);
        expect(wardenP3RowTiles(wardenP3ArenaRow(9))).toHaveLength(21);
        expect(wardenP3ArenaTile(3932, 5157)).toEqual({ x: 3932, y: 5157, level: 0 });
        expect(wardenP3ArenaTile(3926, 5165)).toEqual({ x: 3926, y: 5165, level: 0 });
    });

    it("maps the playable rows from the Warden toward the near platform edge", () => {
        expect(wardenP3RowTileY(wardenP3ArenaRow(1))).toBe(5157);
        expect(wardenP3RowTileY(wardenP3ArenaRow(9))).toBe(5165);
        expect(wardenP3RowForTile(wardenP3ArenaTile(3936, 5157))?.distanceFromWarden).toBe(1);
        expect(wardenP3RowForTile(wardenP3ArenaTile(3936, 5165))?.distanceFromWarden).toBe(9);
        expect(wardenP3RowForTile(wardenP3ArenaTile(3936, 5156))).toBeUndefined();
    });

    it("treats tiles outside the trapezoid's narrower rows as off the floor", () => {
        expect(wardenP3RowForTile(wardenP3ArenaTile(3926, 5157))).toBeUndefined();
        expect(wardenP3RowForTile(wardenP3ArenaTile(3932, 5157))).toBeDefined();
        expect(wardenP3RowForTile(wardenP3ArenaTile(3926, 5163))).toBeDefined();
    });

    it("maps the Warden's right and left to opposite floor halves with a centre safe line", () => {
        const right = wardenP3FloorSlamTiles(WardenSlamTarget.RIGHT);
        const left = wardenP3FloorSlamTiles(WardenSlamTarget.LEFT);
        const centre = wardenP3FloorSlamTiles(WardenSlamTarget.CENTRE);

        expect(right.every((tile) => tile.x >= 3936)).toBe(true);
        expect(left.every((tile) => tile.x <= 3936)).toBe(true);
        expect(right.some((tile) => tile.x === 3936)).toBe(true);
        expect(left.some((tile) => tile.x === 3936)).toBe(true);
        expect(centre.some((tile) => tile.x === 3936)).toBe(false);
        expect(right.some((tile) => tile.x === 3946 && tile.y === 5165)).toBe(true);
        expect(left.some((tile) => tile.x === 3932 && tile.y === 5157)).toBe(true);
    });

    it("pulls single tiles from the furthest remaining row only, finishing each row before the next", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const { pulls } = pullWholeFloor(seededRandom(seed));

            let pullIndex = 0;
            for (let distance = WARDEN_P3_ARENA_ROW_COUNT; distance > 1; distance--) {
                const rowTiles = wardenP3RowTiles(wardenP3ArenaRow(distance));
                const rowPulls = pulls.slice(pullIndex, pullIndex + rowTiles.length);
                expect(new Set(rowPulls.map((tile) => tile.x)).size).toBe(rowTiles.length);
                expect(
                    rowPulls.every(
                        (tile) => wardenP3RowForTile(tile)?.distanceFromWarden === distance,
                    ),
                ).toBe(true);
                pullIndex += rowTiles.length;
            }
            expect(pullIndex).toBe(pulls.length);
        }
    });

    it("pulls a row's tiles in a random order rather than a fixed sweep", () => {
        const rowNine = (seed: number) =>
            pullWholeFloor(seededRandom(seed))
                .pulls.slice(0, 21)
                .map((tile) => tile.x);
        expect(rowNine(1)).not.toEqual(rowNine(2));
        expect(rowNine(3)).toEqual(rowNine(3));
    });

    it("never pulls the Warden-adjacent row", () => {
        const { floor } = pullWholeFloor(seededRandom(7));

        expect(wardenP3PullableTiles(floor)).toEqual([]);
        expect(() => pullWardenP3ArenaTile(floor, seededRandom(7))).toThrow();
        expect(wardenP3SolidFloorTiles(floor)).toEqual(wardenP3RowTiles(wardenP3ArenaRow(1)));
        expect(wardenP3TileOccupancy(floor, wardenP3ArenaTile(3936, 5158))).toBe(
            WardenP3ArenaTileOccupancy.DESTROYED_FLOOR,
        );
    });

    it("throws a player on a pulled tile onto the nearest solid tile, nearer the Warden on a tie", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const random = seededRandom(seed);
            let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
            for (let pull = 0; pull < 60; pull++) {
                const pulled = pullWardenP3ArenaTile(floor, random);
                floor = pulled.floor;
                const refuge = nearestSolidWardenP3Tile(floor, pulled.tile);
                const distance = (tile: WardenP3ArenaTile) =>
                    Math.hypot(tile.x - pulled.tile.x, tile.y - pulled.tile.y);

                expect(canOccupyWardenP3ArenaTile(floor, refuge)).toBe(true);
                for (const tile of wardenP3SolidFloorTiles(floor)) {
                    expect(distance(tile)).toBeGreaterThanOrEqual(distance(refuge));
                }
            }
        }

        // Row 9 gone and row 8 pulled from its west end: the tile beside it and the tile inside it
        // tie at one tile away.
        const floor = pullTiles(wardenP3RowTiles(wardenP3ArenaRow(9)).length + 1, () => 0);
        const pulled = wardenP3ArenaTile(3926, 5164);
        expect(canOccupyWardenP3ArenaTile(floor, pulled)).toBe(false);
        expect(nearestSolidWardenP3Tile(floor, pulled)).toEqual(wardenP3ArenaTile(3926, 5163));
    });

    it("composes a Terrain that rejects pulled tiles while keeping the base terrain's rules", () => {
        const pulled = pullWardenP3ArenaTile(WARDEN_P3_INITIAL_ARENA_FLOOR, () => 0);
        expect(pulled.tile).toEqual(wardenP3ArenaTile(3926, 5165));
        const terrain = wardenP3ArenaTerrain(ALWAYS_OPEN_TERRAIN, pulled.floor);

        expect(terrain.canOccupy(0, 3926 * 128, 5165 * 128)).toBe(false);
        expect(terrain.canOccupy(0, 3927 * 128, 5165 * 128)).toBe(true);
        expect(terrain.canOccupy(0, 3936 * 128, 5157 * 128)).toBe(true);
        // Outside the arena's rows entirely: falls through to the base terrain.
        expect(terrain.canOccupy(0, 0, 0)).toBe(true);
        // A different level is untouched by arena floor removal.
        expect(terrain.canOccupy(1, 3926 * 128, 5165 * 128)).toBe(true);

        const blockedBase: Terrain = { ...ALWAYS_OPEN_TERRAIN, canOccupy: () => false };
        expect(
            wardenP3ArenaTerrain(blockedBase, pulled.floor).canOccupy(0, 3936 * 128, 5157 * 128),
        ).toBe(false);
    });
});
