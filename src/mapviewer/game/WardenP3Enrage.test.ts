import { TILE_SIZE } from "./Terrain";
import {
    WARDEN_P3_BACK_TILE_Y,
    WARDEN_P3_FRONT_CENTRE_TILE,
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    canOccupyWardenP3ArenaTile,
    pullWardenP3ArenaTiles,
    wardenP3ArenaTile,
    wardenP3PullableTiles,
    wardenP3SolidFloorTiles,
} from "./WardenP3Arena";
import { wardenP3LightningTargets, wardenP3PulledTileSkyPoint } from "./WardenP3Enrage";

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
        floor = pullWardenP3ArenaTiles(floor, 1, random).floor;
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

describe("Wardens P3 pulled tile flights", () => {
    const sky = { tilesBehindWarden: 10, fan: 1.5 };

    it("sends every tile the same distance past the Warden's back, whichever row it left", () => {
        for (const tile of [wardenP3ArenaTile(3930, 5165), wardenP3ArenaTile(3936, 5158)]) {
            expect(wardenP3PulledTileSkyPoint(tile, sky).y).toBe(
                (WARDEN_P3_BACK_TILE_Y - 10 + 0.5) * TILE_SIZE,
            );
        }
    });

    it("fans the tiles out across the sky from the side of the floor they left", () => {
        const centreX = WARDEN_P3_FRONT_CENTRE_TILE.x;
        const skyX = (tileX: number) =>
            wardenP3PulledTileSkyPoint(wardenP3ArenaTile(tileX, 5165), sky).x / TILE_SIZE - 0.5;

        expect(skyX(centreX)).toBe(centreX);
        expect(skyX(centreX - 4)).toBe(centreX - 6);
        expect(skyX(centreX + 10)).toBe(centreX + 15);
    });
});
