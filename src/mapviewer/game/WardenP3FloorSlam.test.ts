import { LocTransform, REST_LOC_TRANSFORM } from "./LocTransform";
import {
    WardenP3ArenaTile,
    wardenP3ArenaRow,
    wardenP3ArenaTile,
    wardenP3FloorSlamTiles,
    wardenP3RowTiles,
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

    it("mirrors a left slam onto a right slam, tipping each side outward", () => {
        const right = slamAt(WardenSlamTarget.RIGHT, 0);
        const left = slamAt(WardenSlamTarget.LEFT, 0);

        for (const tile of wardenP3FloorSlamTiles(WardenSlamTarget.RIGHT)) {
            const mirrored = wardenP3ArenaTile(2 * CENTRE_X - tile.x, tile.y);
            expect(arrival(left, mirrored)).toBeCloseTo(arrival(right, tile), 9);
        }

        const rightSideLeg = peakPose(right, wardenP3ArenaTile(3942, 5159));
        const leftSideLeg = peakPose(left, wardenP3ArenaTile(3930, 5159));
        expect(rightSideLeg.eastTilt).toBeGreaterThan(0);
        expect(leftSideLeg.eastTilt).toBeLessThan(0);
        expect(rightSideLeg.northTilt).toBe(0);
        expect(leftSideLeg.northTilt).toBe(0);

        const rightFarLeg = peakPose(right, wardenP3ArenaTile(3937, 5165));
        const leftFarLeg = peakPose(left, wardenP3ArenaTile(3935, 5165));
        expect(rightFarLeg.northTilt).toBeGreaterThan(0);
        expect(leftFarLeg.northTilt).toBeGreaterThan(0);
        expect(rightFarLeg.eastTilt).toBe(0);
        expect(leftFarLeg.eastTilt).toBe(0);

        const rightCorner = peakPose(right, wardenP3ArenaTile(3940, 5161));
        expect(rightCorner.eastTilt).toBeGreaterThan(0);
        expect(rightCorner.northTilt).toBeGreaterThan(0);
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

    it("hides the tiles of removed rows and leaves the rest of the floor alone", () => {
        const removedRows = [9];
        for (const tile of wardenP3RowTiles(wardenP3ArenaRow(9))) {
            expect(wardenP3FloorTilePose([], removedRows, tile, 0)).toEqual({ kind: "HIDDEN" });
        }
        for (const tile of wardenP3RowTiles(wardenP3ArenaRow(8))) {
            expect(wardenP3FloorTilePose([], removedRows, tile, 0)).toBe(REST_LOC_TRANSFORM);
        }
    });
});
