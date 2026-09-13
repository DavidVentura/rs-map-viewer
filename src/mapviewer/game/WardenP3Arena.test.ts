import { Terrain } from "./Terrain";
import {
    WARDEN_P3_ARENA_ROW_COUNT,
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaTileOccupancy,
    canOccupyWardenP3ArenaTile,
    destroyFurthestWardenP3ArenaRow,
    wardenP3ArenaRow,
    wardenP3ArenaTerrain,
    wardenP3ArenaTile,
    wardenP3DestroyedRowDistances,
    wardenP3FloorSlamTiles,
    wardenP3RowForTile,
    wardenP3RowTileY,
    wardenP3RowTiles,
    wardenP3TileOccupancy,
} from "./WardenP3Arena";
import { WardenSlamTarget } from "./WardenP3SlamTarget";

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

    it("removes rows from the furthest edge and makes them unavailable for occupancy", () => {
        const removed = destroyFurthestWardenP3ArenaRow(WARDEN_P3_INITIAL_ARENA_FLOOR);
        expect(removed).toBeDefined();
        if (!removed) {
            throw new Error("Expected the furthest Wardens P3 row to be removable");
        }
        expect(removed.row.distanceFromWarden).toBe(9);
        expect(wardenP3RowTiles(removed.row)).toHaveLength(21);
        expect(wardenP3TileOccupancy(removed.floor, wardenP3ArenaTile(3926, 5165))).toBe(
            WardenP3ArenaTileOccupancy.DESTROYED_FLOOR,
        );
        expect(canOccupyWardenP3ArenaTile(removed.floor, wardenP3ArenaTile(3936, 5157))).toBe(true);
        expect(canOccupyWardenP3ArenaTile(removed.floor, wardenP3ArenaTile(3936, 5165))).toBe(
            false,
        );
    });

    it("keeps the Warden-adjacent row until enrage has no removable floor left", () => {
        let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
        for (let i = 0; i < 8; i++) {
            const removed = destroyFurthestWardenP3ArenaRow(floor);
            if (!removed) {
                throw new Error("Expected a removable Wardens P3 row");
            }
            floor = removed.floor;
        }

        expect(canOccupyWardenP3ArenaTile(floor, wardenP3ArenaTile(3936, 5157))).toBe(true);
        expect(wardenP3TileOccupancy(floor, wardenP3ArenaTile(3936, 5158))).toBe(
            WardenP3ArenaTileOccupancy.DESTROYED_FLOOR,
        );
        expect(destroyFurthestWardenP3ArenaRow(floor)).toBeUndefined();
    });

    it("lists destroyed rows by distance from the Warden for rendering", () => {
        expect(wardenP3DestroyedRowDistances(WARDEN_P3_INITIAL_ARENA_FLOOR)).toEqual([]);

        const removed = destroyFurthestWardenP3ArenaRow(WARDEN_P3_INITIAL_ARENA_FLOOR)!;
        expect(wardenP3DestroyedRowDistances(removed.floor)).toEqual([9]);

        const removedTwice = destroyFurthestWardenP3ArenaRow(removed.floor)!;
        expect(wardenP3DestroyedRowDistances(removedTwice.floor)).toEqual([8, 9]);
    });

    it("composes a Terrain that rejects destroyed rows while keeping the base terrain's rules", () => {
        const removed = destroyFurthestWardenP3ArenaRow(WARDEN_P3_INITIAL_ARENA_FLOOR)!;
        const terrain = wardenP3ArenaTerrain(ALWAYS_OPEN_TERRAIN, removed.floor);

        expect(terrain.canOccupy(0, 3936 * 128, 5165 * 128)).toBe(false);
        expect(terrain.canOccupy(0, 3936 * 128, 5157 * 128)).toBe(true);
        // Outside the arena's rows entirely: falls through to the base terrain.
        expect(terrain.canOccupy(0, 0, 0)).toBe(true);
        // A different level is untouched by arena floor removal.
        expect(terrain.canOccupy(1, 3936 * 128, 5165 * 128)).toBe(true);

        const blockedBase: Terrain = { ...ALWAYS_OPEN_TERRAIN, canOccupy: () => false };
        expect(
            wardenP3ArenaTerrain(blockedBase, removed.floor).canOccupy(0, 3936 * 128, 5157 * 128),
        ).toBe(false);
    });
});
