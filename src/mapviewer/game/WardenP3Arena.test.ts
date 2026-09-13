import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WARDEN_P3_PLATFORM_HEIGHT,
    WARDEN_P3_PLATFORM_WIDTH,
    WardenP3ArenaTileOccupancy,
    WardenP3FloorSlam,
    canOccupyWardenP3ArenaTile,
    destroyFurthestWardenP3ArenaRow,
    wardenP3ArenaRow,
    wardenP3ArenaTile,
    wardenP3FloorSlamTiles,
    wardenP3FloorSlamWave,
    wardenP3RowForTile,
    wardenP3RowTileY,
    wardenP3RowTiles,
    wardenP3TileOccupancy,
} from "./WardenP3Arena";

describe("Wardens P3 arena", () => {
    it("uses the authored 29 by 28 level-zero platform", () => {
        expect(WARDEN_P3_PLATFORM_WIDTH).toBe(29);
        expect(WARDEN_P3_PLATFORM_HEIGHT).toBe(28);
        expect(wardenP3ArenaTile(3922, 5139)).toEqual({ x: 3922, y: 5139, level: 0 });
        expect(wardenP3ArenaTile(3950, 5166)).toEqual({ x: 3950, y: 5166, level: 0 });
    });

    it("maps the playable rows from the Warden toward the near platform edge", () => {
        expect(wardenP3RowTileY(wardenP3ArenaRow(1))).toBe(5157);
        expect(wardenP3RowTileY(wardenP3ArenaRow(10))).toBe(5166);
        expect(wardenP3RowForTile(wardenP3ArenaTile(3936, 5157))).toEqual({
            distanceFromWarden: 1,
        });
        expect(wardenP3RowForTile(wardenP3ArenaTile(3936, 5166))).toEqual({
            distanceFromWarden: 10,
        });
        expect(wardenP3RowForTile(wardenP3ArenaTile(3936, 5156))).toBeUndefined();
    });

    it("maps the Warden's right and left to opposite floor halves with a centre safe line", () => {
        const right = wardenP3FloorSlamTiles(WardenP3FloorSlam.RIGHT);
        const left = wardenP3FloorSlamTiles(WardenP3FloorSlam.LEFT);
        const centre = wardenP3FloorSlamTiles(WardenP3FloorSlam.CENTRE);

        expect(right).toHaveLength(15 * 10);
        expect(left).toHaveLength(15 * 10);
        expect(centre).toHaveLength(26 * 10);
        expect(right.some((tile) => tile.x === 3936)).toBe(true);
        expect(left.some((tile) => tile.x === 3936)).toBe(true);
        expect(centre.some((tile) => tile.x === 3936)).toBe(false);
        expect(right.some((tile) => tile.x === 3950 && tile.y === 5166)).toBe(true);
        expect(left.some((tile) => tile.x === 3922 && tile.y === 5157)).toBe(true);
    });

    it("propagates a mirrored L-shaped floor slam to the far edge over 1.2 seconds", () => {
        const wave = wardenP3FloorSlamWave(WardenP3FloorSlam.RIGHT);
        const near = wave.filter(({ tile }) => tile.y === 5157);
        const far = wave.filter(({ tile }) => tile.y === 5166);

        expect(
            near.filter(({ damaging }) => damaging).every(({ delaySeconds }) => delaySeconds === 0),
        ).toBe(true);
        expect(far.some(({ delaySeconds }) => delaySeconds === 1.2)).toBe(true);
        expect(
            wave.some(
                ({ tile, delaySeconds }) => tile.x === 3950 && tile.y === 5157 && delaySeconds > 0,
            ),
        ).toBe(true);

        const left = wardenP3FloorSlamWave(WardenP3FloorSlam.LEFT);
        expect(
            left.some(
                ({ tile, delaySeconds }) => tile.x === 3922 && tile.y === 5157 && delaySeconds > 0,
            ),
        ).toBe(true);
    });

    it("removes rows from the furthest edge and makes them unavailable for occupancy", () => {
        const removed = destroyFurthestWardenP3ArenaRow(WARDEN_P3_INITIAL_ARENA_FLOOR);
        expect(removed).toBeDefined();
        if (!removed) {
            throw new Error("Expected the furthest Wardens P3 row to be removable");
        }
        expect(removed.row).toEqual({ distanceFromWarden: 10 });
        expect(wardenP3RowTiles(removed.row)).toHaveLength(29);
        expect(wardenP3TileOccupancy(removed.floor, wardenP3ArenaTile(3922, 5166))).toBe(
            WardenP3ArenaTileOccupancy.DESTROYED_FLOOR,
        );
        expect(canOccupyWardenP3ArenaTile(removed.floor, wardenP3ArenaTile(3936, 5157))).toBe(true);
        expect(canOccupyWardenP3ArenaTile(removed.floor, wardenP3ArenaTile(3936, 5166))).toBe(
            false,
        );
    });

    it("keeps the Warden-adjacent row until enrage has no removable floor left", () => {
        let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
        for (let i = 0; i < 9; i++) {
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
});
