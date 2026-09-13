import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    canOccupyWardenP3ArenaTile,
    pullWardenP3ArenaTile,
    wardenP3PullableTiles,
    wardenP3SolidFloorTiles,
} from "./WardenP3Arena";
import { wardenP3LightningTargets } from "./WardenP3Enrage";

function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function pulledFloor(pullCount: number): WardenP3ArenaFloor {
    const random = seededRandom(1);
    let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
    for (let pull = 0; pull < pullCount && wardenP3PullableTiles(floor).length > 0; pull++) {
        floor = pullWardenP3ArenaTile(floor, random).floor;
    }
    return floor;
}

describe("Wardens P3 enrage lightning", () => {
    it("strikes distinct tiles of the remaining solid floor only", () => {
        const floor = pulledFloor(30);
        for (let seed = 1; seed <= 20; seed++) {
            const targets = wardenP3LightningTargets(floor, 6, seededRandom(seed));

            expect(targets).toHaveLength(6);
            expect(new Set(targets.map((tile) => `${tile.x},${tile.y}`)).size).toBe(6);
            for (const tile of targets) {
                expect(canOccupyWardenP3ArenaTile(floor, tile)).toBe(true);
            }
        }
    });

    it("reaches every solid tile over many volleys rather than tracking the player", () => {
        const struck = new Set<string>();
        const random = seededRandom(11);
        for (let volley = 0; volley < 400; volley++) {
            for (const tile of wardenP3LightningTargets(WARDEN_P3_INITIAL_ARENA_FLOOR, 6, random)) {
                struck.add(`${tile.x},${tile.y}`);
            }
        }
        expect(struck.size).toBe(wardenP3SolidFloorTiles(WARDEN_P3_INITIAL_ARENA_FLOOR).length);
    });

    it("strikes every remaining tile when there is less floor than bolts", () => {
        const floor = pulledFloor(Infinity);
        const solid = wardenP3SolidFloorTiles(floor);

        const targets = wardenP3LightningTargets(floor, solid.length + 5, seededRandom(3));

        expect(targets).toHaveLength(solid.length);
    });
});
