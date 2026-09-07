import { Faction } from "./Combatant";
import {
    computeArcOffset,
    computeProjectilePitch,
    directionToRotation,
    findLandingHit,
    findSweepHit,
    generateSpreadDirections,
    isPointInCone,
    isWithinTileArea,
    pitchRadiansToRotationUnits,
    reaimTowardTarget,
    rotationAngleDifference,
    rotationToDirection,
    sweepCircleHitFraction,
} from "./projectileMath";

class FakeCombatant {
    readonly hitRadius = 32;
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

describe("reaimTowardTarget", () => {
    it("returns a unit vector pointing from the origin to the target", () => {
        const result = reaimTowardTarget(1, 0, 0, 0, 0, 500);
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(1);
    });

    it("keeps the previous direction when already at the target", () => {
        const result = reaimTowardTarget(1, 0, 100, 100, 100, 100);
        expect(result).toEqual({ x: 1, y: 0 });
    });
});

describe("computeArcOffset (SYMMETRIC)", () => {
    const arrowArc = { baseHeight: 256, heightPerDistance: 0.15, maxHeight: 768 };

    it("is zero at the start and end of the reference distance", () => {
        expect(computeArcOffset(0, 1000, arrowArc, "SYMMETRIC")).toBe(0);
        expect(computeArcOffset(1000, 1000, arrowArc, "SYMMETRIC")).toBe(0);
    });

    it("peaks above zero at the midpoint", () => {
        expect(computeArcOffset(500, 1000, arrowArc, "SYMMETRIC")).toBeGreaterThan(0);
    });

    it("clamps the peak height to the arc profile maximum", () => {
        const offset = computeArcOffset(5000, 10000, arrowArc, "SYMMETRIC");
        expect(offset).toBeCloseTo(arrowArc.maxHeight);
    });

    it("stays flat for a zero-height arc profile", () => {
        const flatArc = { baseHeight: 0, heightPerDistance: 0, maxHeight: 0 };
        expect(computeArcOffset(500, 1000, flatArc, "SYMMETRIC")).toBe(0);
    });

    it("does not travel past full progress once the reference distance is exceeded", () => {
        const atReference = computeArcOffset(1000, 1000, arrowArc, "SYMMETRIC");
        const pastReference = computeArcOffset(2000, 1000, arrowArc, "SYMMETRIC");
        expect(pastReference).toBe(atReference);
    });
});

describe("computeArcOffset (DESCENDING)", () => {
    const jadArc = { baseHeight: 400, heightPerDistance: 0.3, maxHeight: 900 };

    it("is at its peak at the start (the launch point is the apex)", () => {
        const peak = computeArcOffset(0, 1000, jadArc, "DESCENDING");
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeGreaterThan(computeArcOffset(1, 1000, jadArc, "DESCENDING"));
    });

    it("is zero at the end of the reference distance", () => {
        expect(computeArcOffset(1000, 1000, jadArc, "DESCENDING")).toBeCloseTo(0);
    });

    it("decreases monotonically from start to end", () => {
        const early = computeArcOffset(200, 1000, jadArc, "DESCENDING");
        const late = computeArcOffset(800, 1000, jadArc, "DESCENDING");
        expect(early).toBeGreaterThan(late);
    });
});

describe("computeProjectilePitch (SYMMETRIC)", () => {
    const arrowArc = { baseHeight: 256, heightPerDistance: 0.15, maxHeight: 768 };

    it("is zero at the apex", () => {
        expect(computeProjectilePitch(500, 1000, arrowArc, "SYMMETRIC")).toBeCloseTo(0);
    });

    it("is positive (nose up) at the start", () => {
        expect(computeProjectilePitch(0, 1000, arrowArc, "SYMMETRIC")).toBeGreaterThan(0);
    });

    it("is negative (nose down) at the end", () => {
        expect(computeProjectilePitch(1000, 1000, arrowArc, "SYMMETRIC")).toBeLessThan(0);
    });

    it("is zero throughout for a flat (zero-height) arc profile", () => {
        const flatArc = { baseHeight: 0, heightPerDistance: 0, maxHeight: 0 };
        expect(computeProjectilePitch(0, 1000, flatArc, "SYMMETRIC")).toBeCloseTo(0);
        expect(computeProjectilePitch(500, 1000, flatArc, "SYMMETRIC")).toBeCloseTo(0);
        expect(computeProjectilePitch(1000, 1000, flatArc, "SYMMETRIC")).toBeCloseTo(0);
    });
});

describe("computeProjectilePitch (DESCENDING)", () => {
    const jadArc = { baseHeight: 400, heightPerDistance: 0.3, maxHeight: 900 };

    it("is level (zero) leaving the apex at the start", () => {
        expect(computeProjectilePitch(0, 1000, jadArc, "DESCENDING")).toBeCloseTo(0);
    });

    it("is negative (nose down) partway through, and more so near the end", () => {
        const early = computeProjectilePitch(200, 1000, jadArc, "DESCENDING");
        const late = computeProjectilePitch(800, 1000, jadArc, "DESCENDING");
        expect(early).toBeLessThan(0);
        expect(late).toBeLessThan(early);
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

describe("findLandingHit", () => {
    it("finds the closest hostile combatant within radius of the landing point", () => {
        const far = new FakeCombatant(0, 40, 0, Faction.ENEMY);
        const near = new FakeCombatant(10, 0, 0, Faction.ENEMY);
        const hit = findLandingHit(0, 0, 16, 0, Faction.PLAYER, [far, near]);
        expect(hit).toBe(near);
    });

    it("returns undefined when nothing is within radius", () => {
        const enemy = new FakeCombatant(1000, 1000, 0, Faction.ENEMY);
        expect(findLandingHit(0, 0, 16, 0, Faction.PLAYER, [enemy])).toBeUndefined();
    });

    it("ignores combatants sharing the projectile's faction", () => {
        const ally = new FakeCombatant(0, 0, 0, Faction.PLAYER);
        expect(findLandingHit(0, 0, 16, 0, Faction.PLAYER, [ally])).toBeUndefined();
    });

    it("ignores combatants on a different level", () => {
        const other = new FakeCombatant(0, 0, 1, Faction.ENEMY);
        expect(findLandingHit(0, 0, 16, 0, Faction.PLAYER, [other])).toBeUndefined();
    });

    it("ignores combatants that are already dead", () => {
        const dead = new FakeCombatant(0, 0, 0, Faction.ENEMY);
        dead.health = 0;
        expect(findLandingHit(0, 0, 16, 0, Faction.PLAYER, [dead])).toBeUndefined();
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
