import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    canOccupyWardenP3ArenaTile,
    destroyFurthestWardenP3ArenaRow,
    wardenP3ArenaTile,
} from "./WardenP3Arena";
import { WardenP3Tile } from "./WardenP3Director";
import { babaPhantomRockTargets } from "./WardenP3Phantoms";

function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function floorWithDestroyedRows(count: number): WardenP3ArenaFloor {
    let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
    for (let index = 0; index < count; index++) {
        floor = destroyFurthestWardenP3ArenaRow(floor)!.floor;
    }
    return floor;
}

const tileKey = (tile: WardenP3Tile): string => `${tile.x},${tile.y},${tile.level}`;

describe("Ba-Ba phantom rock targets", () => {
    it("drops the first rock on the player's tile and the rest on distinct solid floor", () => {
        const floor = floorWithDestroyedRows(4);
        const playerTile = wardenP3ArenaTile(3936, 5160);
        for (let seed = 1; seed <= 20; seed++) {
            const targets = babaPhantomRockTargets(floor, playerTile, 6, seededRandom(seed));

            expect(targets).toHaveLength(7);
            expect(targets[0]).toEqual(playerTile);
            const scattered = targets.slice(1);
            expect(new Set(targets.map(tileKey)).size).toBe(targets.length);
            for (const tile of scattered) {
                expect(canOccupyWardenP3ArenaTile(floor, wardenP3ArenaTile(tile.x, tile.y))).toBe(
                    true,
                );
            }
        }
    });

    it("strikes every remaining tile when there is less floor than rocks", () => {
        const floor = floorWithDestroyedRows(8);
        const playerTile = wardenP3ArenaTile(3936, 5157);

        const targets = babaPhantomRockTargets(floor, playerTile, 50, seededRandom(7));

        // Only the Warden-adjacent row survives, 3932..3940.
        expect(targets).toHaveLength(9);
        expect(targets[0]).toEqual(playerTile);
    });

    it("picks the same tiles for the same random sequence", () => {
        const playerTile = wardenP3ArenaTile(3930, 5162);
        const first = babaPhantomRockTargets(
            WARDEN_P3_INITIAL_ARENA_FLOOR,
            playerTile,
            6,
            seededRandom(3),
        );
        const second = babaPhantomRockTargets(
            WARDEN_P3_INITIAL_ARENA_FLOOR,
            playerTile,
            6,
            seededRandom(3),
        );
        expect(second).toEqual(first);
    });
});
