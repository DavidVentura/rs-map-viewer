import { Faction } from "./Combatant";
import {
    FlightPoint,
    FlightState,
    directionToRotation,
    findSweepHit,
    generateSpreadDirections,
    isPointInCone,
    isWithinTileArea,
    launchFlight,
    pitchRadiansToRotationUnits,
    rotationAngleDifference,
    rotationToDirection,
    stepFlight,
    sweepCircleHitFraction,
} from "./projectileMath";

class FakeCombatant {
    readonly hitRadius = 32;
    readonly projectileLaunchHeight = 40;
    readonly maxHealth = 100;
    health = 100;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly faction: Faction,
    ) {}
}

describe("directionToRotation", () => {
    it("is invariant to the magnitude of the direction", () => {
        expect(directionToRotation(1, 0)).toBe(directionToRotation(1000, 0));
    });

    it("faces north (rotation 1024) for +y and south (rotation 0) for -y", () => {
        expect(directionToRotation(0, 1)).toBe(1024);
        expect(directionToRotation(0, -1)).toBe(0);
    });
});

// Runs the solver to arrival, re-reading the (possibly moving) target every step, and returns the
// states it passed through.
function flyTo(
    initial: FlightState,
    target: () => FlightPoint,
    endHeight: number,
    dt: number,
): FlightState[] {
    const states: FlightState[] = [];
    let state = initial;
    for (let i = 0; i < 100000; i++) {
        const step = stepFlight(state, target(), endHeight, dt);
        state = step.state;
        states.push(state);
        if (step.arrived) {
            return states;
        }
    }
    throw new Error("flight never arrived");
}

describe("launchFlight", () => {
    it("sets the initial vertical velocity from the launch angle and horizontal speed", () => {
        const state = launchFlight({ x: 0, y: 0, height: 40 }, { x: 1000, y: 0 }, Math.PI / 4, 2);
        expect(state.verticalVelocity).toBeCloseTo(500);
        expect(state.secondsToArrival).toBe(2);
    });

    it("rejects a non-positive travel time", () => {
        expect(() => launchFlight({ x: 0, y: 0, height: 0 }, { x: 1, y: 0 }, 0, 0)).toThrow();
    });
});

describe("stepFlight", () => {
    const angle = Math.PI / 6;
    const start = { x: 0, y: 0, height: 40 };
    const target = { x: 1000, y: 0 };

    it("peaks at distance * tan(angle) / 4 above the baseline at the midpoint of a level shot", () => {
        const states = flyTo(launchFlight(start, target, angle, 1), () => target, 40, 1 / 1000);
        const midpoint = states.reduce((closest, state) =>
            Math.abs(state.x - 500) < Math.abs(closest.x - 500) ? state : closest,
        );
        expect(midpoint.height - 40).toBeCloseTo((1000 * Math.tan(angle)) / 4, 0);
        const peak = Math.max(...states.map((state) => state.height));
        expect(peak - 40).toBeCloseTo((1000 * Math.tan(angle)) / 4, 0);
    });

    it("lands exactly on the target at the end height and arrival time regardless of dt", () => {
        for (const dt of [1 / 120, 1 / 7, 0.3]) {
            const states = flyTo(launchFlight(start, target, angle, 1), () => target, 25, dt);
            const last = states[states.length - 1];
            expect(last.x).toBe(1000);
            expect(last.y).toBe(0);
            expect(last.height).toBe(25);
            expect(last.secondsToArrival).toBe(0);
            expect(Math.abs(states.length * dt - 1)).toBeLessThanOrEqual(dt);
        }
    });

    it("only descends for a zero-angle shot launched from high above its end height", () => {
        const states = flyTo(
            launchFlight({ x: 0, y: 0, height: 900 }, target, 0, 1),
            () => target,
            40,
            1 / 120,
        );
        let previous = 900;
        for (const state of states) {
            expect(state.height).toBeLessThanOrEqual(previous);
            previous = state.height;
        }
        expect(states[states.length - 1].height).toBe(40);
    });

    it("falls straight down for a shot with no horizontal distance", () => {
        const drop = { x: 300, y: 300 };
        const states = flyTo(
            launchFlight({ ...drop, height: 3000 }, drop, 0, 1.6),
            () => drop,
            0,
            1 / 120,
        );
        for (const state of states) {
            expect(state.x).toBe(300);
            expect(state.y).toBe(300);
        }
        expect(states[states.length - 1].height).toBe(0);
    });

    it("still lands on a target that moves mid-flight, at the same arrival time", () => {
        const moving = { x: 1000, y: 0 };
        let elapsed = 0;
        const dt = 1 / 120;
        const states = flyTo(
            launchFlight(start, moving, angle, 1),
            () => {
                elapsed += dt;
                moving.y = elapsed > 0.5 ? 400 : 0;
                return moving;
            },
            40,
            dt,
        );
        const last = states[states.length - 1];
        expect(last.x).toBe(1000);
        expect(last.y).toBe(400);
        expect(Math.abs(states.length * dt - 1)).toBeLessThanOrEqual(dt);
    });

    it("yaws toward the target and pitches nose up then nose down over a lobbed flight", () => {
        const first = stepFlight(
            launchFlight(start, { x: 0, y: 1000 }, angle, 1),
            { x: 0, y: 1000 },
            40,
            0.01,
        );
        expect(first.rotation).toBe(1024);
        expect(first.pitch).toBeCloseTo(pitchRadiansToRotationUnits(angle), -1);
        const states = flyTo(launchFlight(start, target, angle, 1), () => target, 40, 1 / 120);
        const late = stepFlight(states[states.length - 3], target, 40, 1 / 120);
        expect(late.pitch).toBeGreaterThan(1024);
    });

    it("pitches straight down for a pure vertical fall", () => {
        const drop = { x: 0, y: 0 };
        const step = stepFlight(launchFlight({ ...drop, height: 100 }, drop, 0, 1), drop, 0, 0.5);
        expect(step.state.verticalVelocity).toBeLessThan(0);
        const next = stepFlight(step.state, drop, 0, 0.25);
        expect(next.pitch).toBe(1536);
    });
});

describe("pitchRadiansToRotationUnits", () => {
    it("maps zero radians to zero units", () => {
        expect(pitchRadiansToRotationUnits(0)).toBe(0);
    });

    it("wraps a negative angle into the upper half of the unit circle", () => {
        expect(pitchRadiansToRotationUnits(-Math.PI / 2)).toBe(1536);
    });
});

describe("sweepCircleHitFraction", () => {
    it("finds the entry point of a segment passing through a circle", () => {
        const fraction = sweepCircleHitFraction(0, 0, 1000, 0, 500, 0, 50);
        expect(fraction).toBeCloseTo(0.45);
    });

    it("returns undefined when the segment misses the circle", () => {
        const fraction = sweepCircleHitFraction(0, 0, 1000, 0, 500, 200, 50);
        expect(fraction).toBeUndefined();
    });

    it("returns 0 when the segment starts inside the circle", () => {
        const fraction = sweepCircleHitFraction(500, 0, 1000, 0, 500, 0, 50);
        expect(fraction).toBe(0);
    });

    it("returns undefined for a stationary point outside the circle", () => {
        const fraction = sweepCircleHitFraction(0, 0, 0, 0, 500, 0, 50);
        expect(fraction).toBeUndefined();
    });

    it("ignores a circle behind the segment's travel direction", () => {
        const fraction = sweepCircleHitFraction(500, 0, 1000, 0, 0, 0, 50);
        expect(fraction).toBeUndefined();
    });
});

describe("findSweepHit", () => {
    it("returns the closest hostile combatant along the segment", () => {
        const far = new FakeCombatant(900, 0, 0, Faction.ENEMY);
        const near = new FakeCombatant(300, 0, 0, Faction.ENEMY);
        const hit = findSweepHit(0, 0, 1000, 0, 10, 0, Faction.PLAYER, [far, near]);
        expect(hit?.combatant).toBe(near);
    });

    it("ignores combatants sharing the projectile's faction", () => {
        const ally = new FakeCombatant(300, 0, 0, Faction.PLAYER);
        const hit = findSweepHit(0, 0, 1000, 0, 10, 0, Faction.PLAYER, [ally]);
        expect(hit).toBeUndefined();
    });

    it("ignores combatants on a different level", () => {
        const other = new FakeCombatant(300, 0, 1, Faction.ENEMY);
        const hit = findSweepHit(0, 0, 1000, 0, 10, 0, Faction.PLAYER, [other]);
        expect(hit).toBeUndefined();
    });

    it("ignores combatants that are already dead", () => {
        const dead = new FakeCombatant(300, 0, 0, Faction.ENEMY);
        dead.health = 0;
        const hit = findSweepHit(0, 0, 1000, 0, 10, 0, Faction.PLAYER, [dead]);
        expect(hit).toBeUndefined();
    });

    it("ignores combatants present in the excluded set", () => {
        const enemy = new FakeCombatant(300, 0, 0, Faction.ENEMY);
        const hit = findSweepHit(0, 0, 1000, 0, 10, 0, Faction.PLAYER, [enemy], new Set([enemy]));
        expect(hit).toBeUndefined();
    });
});

describe("rotationToDirection", () => {
    it("inverts directionToRotation for the cardinal directions", () => {
        for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
        ]) {
            const rotation = directionToRotation(dx, dy);
            const direction = rotationToDirection(rotation);
            expect(direction.x).toBeCloseTo(dx);
            expect(direction.y).toBeCloseTo(dy);
        }
    });
});

describe("rotationAngleDifference", () => {
    it("is zero for identical rotations", () => {
        expect(rotationAngleDifference(512, 512)).toBe(0);
    });

    it("is symmetric", () => {
        expect(rotationAngleDifference(0, 512)).toBe(rotationAngleDifference(512, 0));
    });

    it("wraps around the 2048-unit circle rather than exceeding a half turn", () => {
        expect(rotationAngleDifference(0, 2047)).toBe(1);
        expect(rotationAngleDifference(0, 1024)).toBe(1024);
    });
});

describe("isPointInCone", () => {
    it("hits a point directly ahead, within reach", () => {
        expect(isPointInCone(0, 0, 1024, Math.PI / 2, 500, 0, 100)).toBe(true);
    });

    it("misses a point behind the facing direction", () => {
        expect(isPointInCone(0, 0, 1024, Math.PI / 2, 500, 0, -100)).toBe(false);
    });

    it("misses a point beyond the reach", () => {
        expect(isPointInCone(0, 0, 1024, Math.PI / 2, 50, 0, 100)).toBe(false);
    });

    it("misses a point just outside the half-angle", () => {
        const direction = rotationToDirection(1024 + 257);
        const point = { x: direction.x * 100, y: direction.y * 100 };
        expect(isPointInCone(0, 0, 1024, Math.PI / 2, 500, point.x, point.y)).toBe(false);
    });

    it("hits a point just inside the half-angle", () => {
        const direction = rotationToDirection(1024 + 255);
        const point = { x: direction.x * 100, y: direction.y * 100 };
        expect(isPointInCone(0, 0, 1024, Math.PI / 2, 500, point.x, point.y)).toBe(true);
    });
});

describe("isWithinTileArea", () => {
    it("includes the center tile", () => {
        expect(isWithinTileArea(0, 0, 1, 0, 0)).toBe(true);
    });

    it("includes tiles within the radius in every direction", () => {
        expect(isWithinTileArea(128, 128, 1, 0, 0)).toBe(true);
        expect(isWithinTileArea(128, 128, 1, 255, 255)).toBe(true);
    });

    it("excludes tiles beyond the radius", () => {
        expect(isWithinTileArea(0, 0, 1, 256, 0)).toBe(false);
    });
});

describe("generateSpreadDirections", () => {
    it("returns exactly the base rotation for a single projectile", () => {
        expect(generateSpreadDirections(1024, Math.PI / 3, 1)).toEqual([1024]);
    });

    it("returns the requested count of directions", () => {
        expect(generateSpreadDirections(1024, Math.PI / 3, 8)).toHaveLength(8);
    });

    it("centers the spread on the base rotation", () => {
        const directions = generateSpreadDirections(1024, Math.PI / 2, 3);
        expect(directions[1]).toBe(1024);
    });

    it("spans the full requested spread angle between the outer directions", () => {
        const spreadAngleRadians = Math.PI / 2;
        const directions = generateSpreadDirections(1024, spreadAngleRadians, 5);
        const outerDifference = rotationAngleDifference(directions[0], directions[4]);
        expect((outerDifference * (2 * Math.PI)) / 2048).toBeCloseTo(spreadAngleRadians);
    });
});
