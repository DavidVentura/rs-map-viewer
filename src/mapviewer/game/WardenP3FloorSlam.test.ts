import { LocTransform, REST_LOC_TRANSFORM } from "./LocTransform";
import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaTile,
    pullWardenP3ArenaTiles,
    wardenP3ArenaTile,
    wardenP3FloorSlamTiles,
    wardenP3SolidFloorTiles,
} from "./WardenP3Arena";
import {
    FloorSlam,
    floorSlamArrivalSeconds,
    floorSlamEndsAtSeconds,
    floorSlamTilesArriving,
    floorTilePose,
    wardenP3FloorTilePose,
    wardenP3SlamShockwave,
} from "./WardenP3FloorSlam";
import { WardenSlamTarget } from "./WardenP3SlamTarget";

const CENTRE_X = 3936;
const NEAREST_ROW_Y = 5157;

function slamAt(target: WardenSlamTarget, startsAtSeconds: number): FloorSlam {
    return { shockwave: wardenP3SlamShockwave(target), startsAtSeconds };
}

function chebyshev(tile: WardenP3ArenaTile, originX: number, originY: number): number {
    return Math.max(Math.abs(tile.x - originX), Math.abs(tile.y - originY));
}

function arrival(slam: FloorSlam, tile: WardenP3ArenaTile): number {
    const seconds = floorSlamArrivalSeconds(slam, tile);
    if (seconds === undefined) {
        throw new Error(`Expected the slam to cover ${tile.x},${tile.y}`);
    }
    return seconds;
}

function shown(transform: LocTransform): Extract<LocTransform, { readonly kind: "SHOWN" }> {
    if (transform.kind !== "SHOWN") {
        throw new Error("Expected a shown tile");
    }
    return transform;
}

// The pose at the highest lift of the tile's pulse, sampled finely across the whole slam.
function peakPose(slam: FloorSlam, tile: WardenP3ArenaTile) {
    const end = floorSlamEndsAtSeconds(slam);
    let peak = shown(REST_LOC_TRANSFORM);
    for (let time = slam.startsAtSeconds; time <= end; time += 0.001) {
        const pose = shown(floorTilePose([slam], tile, time));
        if (pose.lift > peak.lift) {
            peak = pose;
        }
    }
    return peak;
}

type EdgeName = "NORTH" | "EAST" | "SOUTH" | "WEST";

// A point on the tile's top, in world units from its centre.
type TopPoint = { readonly east: number; readonly north: number };

const HALF_TILE = 64;

const EDGE_CORNERS: Readonly<Record<EdgeName, readonly [TopPoint, TopPoint]>> = {
    NORTH: [
        { east: -HALF_TILE, north: HALF_TILE },
        { east: HALF_TILE, north: HALF_TILE },
    ],
    EAST: [
        { east: HALF_TILE, north: -HALF_TILE },
        { east: HALF_TILE, north: HALF_TILE },
    ],
    SOUTH: [
        { east: -HALF_TILE, north: -HALF_TILE },
        { east: HALF_TILE, north: -HALF_TILE },
    ],
    WEST: [
        { east: -HALF_TILE, north: -HALF_TILE },
        { east: -HALF_TILE, north: HALF_TILE },
    ],
};

const OPPOSITE_EDGE_NAME: Readonly<Record<EdgeName, EdgeName>> = {
    NORTH: "SOUTH",
    EAST: "WEST",
    SOUTH: "NORTH",
    WEST: "EAST",
};

// Height above rest of a point on the tile's top once posed the way the loc shader does it: north
// tilt, then east tilt, then lift, in model space where y points down and z north.
function poseHeight(pose: Extract<LocTransform, { readonly kind: "SHOWN" }>, point: TopPoint) {
    const y = -point.north * Math.sin(pose.northTilt);
    return pose.lift - (y * Math.cos(pose.eastTilt) - point.east * Math.sin(pose.eastTilt));
}

// The one edge whose corners both stay at rest height.
function hingeOf(pose: Extract<LocTransform, { readonly kind: "SHOWN" }>): EdgeName {
    const edges = Object.keys(EDGE_CORNERS) as EdgeName[];
    const hinges = edges.filter((edge) =>
        EDGE_CORNERS[edge].every((corner) => Math.abs(poseHeight(pose, corner)) < 1e-6),
    );
    if (hinges.length !== 1) {
        throw new Error(`Expected one edge at rest height, found ${hinges.join(", ") || "none"}`);
    }
    return hinges[0];
}

describe("Wardens P3 floor slam", () => {
    it("reaches each tile in Chebyshev rings from the Warden-adjacent origin", () => {
        const slam = slamAt(WardenSlamTarget.RIGHT, 2);
        const tiles = wardenP3FloorSlamTiles(WardenSlamTarget.RIGHT);

        expect(arrival(slam, wardenP3ArenaTile(CENTRE_X, NEAREST_ROW_Y))).toBe(2);
        for (const a of tiles) {
            for (const b of tiles) {
                const ringA = chebyshev(a, CENTRE_X, NEAREST_ROW_Y);
                const ringB = chebyshev(b, CENTRE_X, NEAREST_ROW_Y);
                if (ringA < ringB) {
                    expect(arrival(slam, a)).toBeLessThan(arrival(slam, b));
                } else if (ringA === ringB) {
                    expect(arrival(slam, a)).toBeCloseTo(arrival(slam, b), 9);
                }
            }
        }
    });

    it("runs a centre slam as two mirrored fronts, each tile following its nearer origin", () => {
        const slam = slamAt(WardenSlamTarget.CENTRE, 0);
        const secondsPerRing = arrival(slam, wardenP3ArenaTile(CENTRE_X - 2, NEAREST_ROW_Y));

        for (const tile of wardenP3FloorSlamTiles(WardenSlamTarget.CENTRE)) {
            const ring = Math.min(
                chebyshev(tile, CENTRE_X - 1, NEAREST_ROW_Y),
                chebyshev(tile, CENTRE_X + 1, NEAREST_ROW_Y),
            );
            expect(arrival(slam, tile)).toBeCloseTo(ring * secondsPerRing, 9);
            const mirrored = wardenP3ArenaTile(2 * CENTRE_X - tile.x, tile.y);
            expect(arrival(slam, mirrored)).toBeCloseTo(arrival(slam, tile), 9);
        }
    });

    it("mirrors a left slam's front onto a right slam's", () => {
        const right = slamAt(WardenSlamTarget.RIGHT, 0);
        const left = slamAt(WardenSlamTarget.LEFT, 0);

        for (const tile of wardenP3FloorSlamTiles(WardenSlamTarget.RIGHT)) {
            const mirrored = wardenP3ArenaTile(2 * CENTRE_X - tile.x, tile.y);
            expect(arrival(left, mirrored)).toBeCloseTo(arrival(right, tile), 9);
        }
    });

    it("tips every tile on one edge, which holds rest height while the opposite edge rises", () => {
        const slam = slamAt(WardenSlamTarget.RIGHT, 0);
        for (const tile of wardenP3FloorSlamTiles(WardenSlamTarget.RIGHT)) {
            const pose = peakPose(slam, tile);
            const hinge = hingeOf(pose);
            const [freeA, freeB] = EDGE_CORNERS[OPPOSITE_EDGE_NAME[hinge]];

            expect(pose.lift).toBeGreaterThan(0);
            expect(poseHeight(pose, freeA)).toBeCloseTo(2 * pose.lift, 6);
            expect(poseHeight(pose, freeB)).toBeCloseTo(2 * pose.lift, 6);
        }
    });

    it("hinges tiles on varied edges, mostly the one facing the front's origin", () => {
        const slam = slamAt(WardenSlamTarget.RIGHT, 0);
        const counts = new Map<string, number>();
        let facingOrigin = 0;
        let legTiles = 0;
        for (const tile of wardenP3FloorSlamTiles(WardenSlamTarget.RIGHT)) {
            const offsetX = tile.x - CENTRE_X;
            const offsetY = tile.y - NEAREST_ROW_Y;
            if (Math.abs(offsetX) === Math.abs(offsetY)) {
                continue;
            }
            const hinge = hingeOf(peakPose(slam, tile));
            const towardOrigin =
                Math.abs(offsetX) > Math.abs(offsetY)
                    ? offsetX > 0
                        ? "WEST"
                        : "EAST"
                    : offsetY > 0
                    ? "SOUTH"
                    : "NORTH";
            counts.set(hinge, (counts.get(hinge) ?? 0) + 1);
            legTiles++;
            if (hinge === towardOrigin) {
                facingOrigin++;
            }
        }

        expect(counts.size).toBeGreaterThanOrEqual(3);
        expect(facingOrigin).toBeGreaterThan(legTiles / 2);
        expect(facingOrigin).toBeLessThan(legTiles);
    });

    it("swings each tile back past flat exactly once before it rests", () => {
        const slam = slamAt(WardenSlamTarget.LEFT, 0);
        for (const tile of wardenP3FloorSlamTiles(WardenSlamTarget.LEFT)) {
            const tileArrival = floorSlamArrivalSeconds(slam, tile);
            if (tileArrival === undefined) {
                continue;
            }
            const signs: number[] = [];
            for (let time = tileArrival; time <= floorSlamEndsAtSeconds(slam); time += 0.001) {
                const sign = Math.sign(shown(floorTilePose([slam], tile, time)).lift);
                if (sign !== 0 && sign !== signs[signs.length - 1]) {
                    signs.push(sign);
                }
            }
            expect(signs).toEqual([1, -1]);
        }
    });

    it("poses a tile the same way for the same time since the slam, whenever it starts", () => {
        const early = slamAt(WardenSlamTarget.CENTRE, 0);
        const late = slamAt(WardenSlamTarget.CENTRE, 7.5);
        const again = slamAt(WardenSlamTarget.CENTRE, 0);
        for (const tile of wardenP3FloorSlamTiles(WardenSlamTarget.CENTRE)) {
            for (let time = 0; time <= floorSlamEndsAtSeconds(early); time += 0.037) {
                const pose = shown(floorTilePose([early], tile, time));
                const latePose = shown(floorTilePose([late], tile, time + 7.5));
                expect(floorTilePose([again], tile, time)).toEqual(pose);
                expect(latePose.lift).toBeCloseTo(pose.lift, 6);
                expect(latePose.northTilt).toBeCloseTo(pose.northTilt, 6);
                expect(latePose.eastTilt).toBeCloseTo(pose.eastTilt, 6);
            }
        }
    });

    it("never moves or damages the centre column in a centre slam", () => {
        const slam = slamAt(WardenSlamTarget.CENTRE, 0);
        const end = floorSlamEndsAtSeconds(slam);
        const centreColumn = wardenP3FloorSlamTiles(WardenSlamTarget.LEFT).filter(
            (tile) => tile.x === CENTRE_X,
        );

        expect(centreColumn.length).toBeGreaterThan(0);
        for (const tile of centreColumn) {
            expect(floorSlamArrivalSeconds(slam, tile)).toBeUndefined();
            for (let time = 0; time <= end; time += 0.01) {
                expect(floorTilePose([slam], tile, time)).toBe(REST_LOC_TRANSFORM);
            }
        }
        expect(
            floorSlamTilesArriving(slam, -Infinity, Infinity).some((tile) => tile.x === CENTRE_X),
        ).toBe(false);
    });

    it("rests a tile before the front arrives and after its pulse, and raises it in between", () => {
        const slam = slamAt(WardenSlamTarget.LEFT, 1);
        const farTile = wardenP3ArenaTile(3926, 5165);
        const farArrival = arrival(slam, farTile);
        const pulseSeconds = floorSlamEndsAtSeconds(slam) - farArrival;

        expect(pulseSeconds).toBeGreaterThan(0);
        expect(floorTilePose([slam], farTile, farArrival - 0.001)).toBe(REST_LOC_TRANSFORM);
        expect(floorTilePose([slam], farTile, farArrival + pulseSeconds + 0.001)).toBe(
            REST_LOC_TRANSFORM,
        );
        expect(peakPose(slam, farTile).lift).toBeGreaterThan(0);
    });

    it("hits every covered tile exactly once across consecutive windows", () => {
        const slam = slamAt(WardenSlamTarget.RIGHT, 0.5);
        const hits = new Map<string, number>();
        for (let time = 0; time < floorSlamEndsAtSeconds(slam); time += 1 / 120) {
            for (const tile of floorSlamTilesArriving(slam, time, time + 1 / 120)) {
                const key = `${tile.x},${tile.y}`;
                hits.set(key, (hits.get(key) ?? 0) + 1);
            }
        }

        expect(hits.size).toBe(wardenP3FloorSlamTiles(WardenSlamTarget.RIGHT).length);
        expect([...hits.values()].every((count) => count === 1)).toBe(true);
    });

    it("hides pulled tiles, even under a slam, and leaves the rest of the floor alone", () => {
        const { floor, tiles } = pullWardenP3ArenaTiles(
            WARDEN_P3_INITIAL_ARENA_FLOOR,
            2,
            () => 0.5,
        );
        const slam = slamAt(WardenSlamTarget.CENTRE, 0);
        for (const pulled of tiles) {
            const arrival = floorSlamArrivalSeconds(slam, pulled) ?? 0;
            expect(wardenP3FloorTilePose([slam], floor, pulled, arrival + 0.05)).toEqual({
                kind: "HIDDEN",
            });
        }
        for (const tile of wardenP3SolidFloorTiles(floor)) {
            expect(wardenP3FloorTilePose([], floor, tile, 0)).toBe(REST_LOC_TRANSFORM);
        }
    });
});
