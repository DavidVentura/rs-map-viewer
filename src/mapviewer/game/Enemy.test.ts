import { EnemyState, computeChaseMovement, computeFacingRotation, decideEnemyState } from "./Enemy";

describe("decideEnemyState", () => {
    it("stays idle while the player is outside the aggro radius", () => {
        expect(decideEnemyState(EnemyState.IDLE, 20, 1000, 500)).toBe(EnemyState.IDLE);
    });

    it("starts chasing once the player enters the aggro radius", () => {
        expect(decideEnemyState(EnemyState.IDLE, 20, 400, 500)).toBe(EnemyState.CHASE);
    });

    it("keeps chasing even if the player moves back outside the aggro radius", () => {
        expect(decideEnemyState(EnemyState.CHASE, 20, 10000, 500)).toBe(EnemyState.CHASE);
    });

    it("dies once health reaches zero, from any state", () => {
        expect(decideEnemyState(EnemyState.IDLE, 0, 1000, 500)).toBe(EnemyState.DEAD);
        expect(decideEnemyState(EnemyState.CHASE, -5, 10, 500)).toBe(EnemyState.DEAD);
    });

    it("never leaves the dead state", () => {
        expect(decideEnemyState(EnemyState.DEAD, 20, 0, 500)).toBe(EnemyState.DEAD);
    });
});

describe("computeChaseMovement", () => {
    it("returns a zero vector once within the stop distance", () => {
        expect(computeChaseMovement(10, 0, 10, 50)).toEqual({ x: 0, y: 0 });
    });

    it("returns a zero vector when already on top of the target", () => {
        expect(computeChaseMovement(0, 0, 0, 50)).toEqual({ x: 0, y: 0 });
    });

    it("returns a unit vector toward the target beyond the stop distance", () => {
        const result = computeChaseMovement(300, 400, 500, 50);
        expect(result.x).toBeCloseTo(0.6);
        expect(result.y).toBeCloseTo(0.8);
    });
});

describe("computeFacingRotation", () => {
    it("faces north when the target is directly north", () => {
        expect(computeFacingRotation(0, 100)).toBe(1024);
    });

    it("faces south when the target is directly south", () => {
        expect(computeFacingRotation(0, -100)).toBe(0);
    });
});
