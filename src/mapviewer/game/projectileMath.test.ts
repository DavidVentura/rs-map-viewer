import { Faction } from "./Combatant";
import {
    computeArcOffset,
    directionToRotation,
    findSweepHit,
    reaimTowardTarget,
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

describe("computeArcOffset", () => {
    const arrowArc = { baseHeight: 256, heightPerDistance: 0.15, maxHeight: 768 };

    it("is zero at the start and end of the reference distance", () => {
        expect(computeArcOffset(0, 1000, arrowArc)).toBe(0);
        expect(computeArcOffset(1000, 1000, arrowArc)).toBe(0);
    });

    it("peaks above zero at the midpoint", () => {
        expect(computeArcOffset(500, 1000, arrowArc)).toBeGreaterThan(0);
    });

    it("clamps the peak height to the arc profile maximum", () => {
        const offset = computeArcOffset(5000, 10000, arrowArc);
        expect(offset).toBeCloseTo(arrowArc.maxHeight);
    });

    it("stays flat for a zero-height arc profile", () => {
        const flatArc = { baseHeight: 0, heightPerDistance: 0, maxHeight: 0 };
        expect(computeArcOffset(500, 1000, flatArc)).toBe(0);
    });

    it("does not travel past full progress once the reference distance is exceeded", () => {
        const atReference = computeArcOffset(1000, 1000, arrowArc);
        const pastReference = computeArcOffset(2000, 1000, arrowArc);
        expect(pastReference).toBe(atReference);
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
});
