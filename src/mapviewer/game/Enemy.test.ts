import { Combatant, Faction } from "./Combatant";
import { Enemy, EnemyState, computeChaseMovement, decideEnemyState } from "./Enemy";
import { Terrain } from "./Terrain";
import { directionToRotation } from "./projectileMath";

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

describe("directionToRotation for facing", () => {
    it("faces north when the target is directly north", () => {
        expect(directionToRotation(0, 100)).toBe(1024);
    });

    it("faces south when the target is directly south", () => {
        expect(directionToRotation(0, -100)).toBe(0);
    });
});

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;
const seqFrameLoader = {} as any;
const terrain: Terrain = {
    canOccupy: () => true,
    getWallFlag: () => 0,
    getHeight: () => 0,
};

class FakePlayer implements Combatant {
    readonly faction = Faction.PLAYER;
    readonly hitRadius = 64;
    readonly maxHealth = 100;
    health = 100;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
    ) {}
}

function makeEnemy(): Enemy {
    return new Enemy(1, 0, 0, 0, 0, 0, 1, 2, 3);
}

describe("Enemy freezing", () => {
    it("is not frozen until frozenUntil is set", () => {
        const enemy = makeEnemy();
        expect(enemy.isFrozen(0)).toBe(false);
    });

    it("is frozen strictly before frozenUntil", () => {
        const enemy = makeEnemy();
        enemy.frozenUntil = 5;
        expect(enemy.isFrozen(4.999)).toBe(true);
        expect(enemy.isFrozen(5)).toBe(false);
    });

    it("does not chase the player while frozen, even within aggro range", () => {
        const enemy = makeEnemy();
        enemy.frozenUntil = 10;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, 1, 1, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.IDLE);
        expect(enemy.x).toBe(0);
        expect(enemy.y).toBe(0);
    });

    it("resumes chasing once the freeze expires", () => {
        const enemy = makeEnemy();
        enemy.frozenUntil = 1;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, 1, 2, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.CHASE);
    });

    it("still dies from damage taken while frozen", () => {
        const enemy = makeEnemy();
        enemy.frozenUntil = 10;
        enemy.health = 0;

        enemy.update(undefined, 1, 1, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.DEAD);
    });
});
