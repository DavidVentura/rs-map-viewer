import { AbilityDefinition, AbilityEffectKind, CooldownGroup } from "./Ability";
import { Combatant, Faction } from "./Combatant";
import {
    Enemy,
    EnemyDecisionInputs,
    EnemyState,
    computeChaseMovement,
    decideEnemyState,
    enemyAttackRange,
} from "./Enemy";
import { EnemyType, EnemyTypeId } from "./EnemyType";
import { ARROW_SPEC } from "./Projectile";
import { Terrain } from "./Terrain";
import { ENEMY_MELEE } from "./abilities";
import { directionToRotation } from "./projectileMath";

function decisionInputs(overrides: Partial<EnemyDecisionInputs> = {}): EnemyDecisionInputs {
    return {
        health: 20,
        distanceToPlayer: 0,
        hasPlayer: true,
        attackReach: 176,
        frozen: false,
        attackReady: true,
        windupComplete: false,
        ...overrides,
    };
}

describe("decideEnemyState", () => {
    it("stays idle while there is no player", () => {
        expect(
            decideEnemyState(
                EnemyState.IDLE,
                decisionInputs({ hasPlayer: false, distanceToPlayer: Infinity }),
            ),
        ).toBe(EnemyState.IDLE);
    });

    it("starts chasing immediately once a player exists, regardless of distance", () => {
        expect(
            decideEnemyState(
                EnemyState.IDLE,
                decisionInputs({ hasPlayer: true, distanceToPlayer: 10000 }),
            ),
        ).toBe(EnemyState.CHASE);
    });

    it("keeps chasing even if the player moves far away", () => {
        expect(
            decideEnemyState(EnemyState.CHASE, decisionInputs({ distanceToPlayer: 10000 })),
        ).toBe(EnemyState.CHASE);
    });

    it("dies once health reaches zero, from any state", () => {
        expect(decideEnemyState(EnemyState.IDLE, decisionInputs({ health: 0 }))).toBe(
            EnemyState.DEAD,
        );
        expect(decideEnemyState(EnemyState.CHASE, decisionInputs({ health: -5 }))).toBe(
            EnemyState.DEAD,
        );
    });

    it("never leaves the dead state", () => {
        expect(decideEnemyState(EnemyState.DEAD, decisionInputs())).toBe(EnemyState.DEAD);
    });

    it("winds up once within attack reach and the attack is ready", () => {
        expect(
            decideEnemyState(
                EnemyState.CHASE,
                decisionInputs({ distanceToPlayer: 100, attackReach: 176, attackReady: true }),
            ),
        ).toBe(EnemyState.WINDUP);
    });

    it("keeps chasing when within reach but the attack is still on cooldown", () => {
        expect(
            decideEnemyState(
                EnemyState.CHASE,
                decisionInputs({ distanceToPlayer: 100, attackReach: 176, attackReady: false }),
            ),
        ).toBe(EnemyState.CHASE);
    });

    it("keeps chasing when the attack is ready but the player is out of reach", () => {
        expect(
            decideEnemyState(
                EnemyState.CHASE,
                decisionInputs({ distanceToPlayer: 500, attackReach: 176, attackReady: true }),
            ),
        ).toBe(EnemyState.CHASE);
    });

    it("stays winding up until the wind-up timer elapses", () => {
        expect(decideEnemyState(EnemyState.WINDUP, decisionInputs({ windupComplete: false }))).toBe(
            EnemyState.WINDUP,
        );
    });

    it("moves to recovery once the wind-up completes, regardless of distance (dodge only avoids the hit, not the animation)", () => {
        expect(
            decideEnemyState(
                EnemyState.WINDUP,
                decisionInputs({ windupComplete: true, distanceToPlayer: 100000 }),
            ),
        ).toBe(EnemyState.RECOVERY);
    });

    it("cancels a wind-up immediately when frozen mid wind-up", () => {
        expect(
            decideEnemyState(
                EnemyState.WINDUP,
                decisionInputs({ frozen: true, windupComplete: false }),
            ),
        ).toBe(EnemyState.CHASE);
    });

    it("stays in recovery until the recovery lock expires", () => {
        expect(decideEnemyState(EnemyState.RECOVERY, decisionInputs({ attackReady: false }))).toBe(
            EnemyState.RECOVERY,
        );
    });

    it("returns to chase once the recovery lock expires", () => {
        expect(decideEnemyState(EnemyState.RECOVERY, decisionInputs({ attackReady: true }))).toBe(
            EnemyState.CHASE,
        );
    });
});

describe("enemyAttackRange", () => {
    it("adds both hit radii on top of a melee ability's reach", () => {
        expect(enemyAttackRange(ENEMY_MELEE, 64, 64)).toBe(48 + 64 + 64);
    });

    it("uses the projectile spec's range for a ranged ability", () => {
        const rangedDefinition: AbilityDefinition = {
            ...ENEMY_MELEE,
            id: "enemy_ranged",
            effect: { kind: AbilityEffectKind.PROJECTILE, spec: ARROW_SPEC },
        };
        expect(enemyAttackRange(rangedDefinition, 64, 64)).toBe(ARROW_SPEC.range);
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
    isLoaded: () => true,
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

const TEST_ENEMY_TYPE: EnemyType = {
    id: EnemyTypeId.GOBLIN,
    npcTypeId: 0,
    idleSeqId: 1,
    walkSeqId: 2,
    deathSeqId: 3,
    attackSeqId: 4,
    hitRadius: 64,
    maxHealth: 20,
    walkSpeed: 288 * 1.6,
};

function makeEnemy(): Enemy {
    return new Enemy(1, 0, 0, 0, 0, 0, TEST_ENEMY_TYPE);
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

        enemy.update(player, [], 1, 1, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.IDLE);
        expect(enemy.x).toBe(0);
        expect(enemy.y).toBe(0);
    });

    it("resumes chasing once the freeze expires", () => {
        const enemy = makeEnemy();
        enemy.frozenUntil = 1;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, [], 1, 2, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.CHASE);
    });

    it("still dies from damage taken while frozen", () => {
        const enemy = makeEnemy();
        enemy.frozenUntil = 10;
        enemy.health = 0;

        enemy.update(undefined, [], 1, 1, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.DEAD);
    });
});

describe("Enemy attack cycle (integration through Enemy.update)", () => {
    function makeMeleeEnemy(x: number, y: number): Enemy {
        return new Enemy(1, x, y, 0, x, y, TEST_ENEMY_TYPE, ENEMY_MELEE);
    }

    it("winds up once the chasing enemy is within melee reach, without moving", () => {
        const enemy = makeMeleeEnemy(0, 0);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.x).toBe(0);
        expect(enemy.y).toBe(0);
        expect(enemy.rotation).toBe(directionToRotation(100, 0));
    });

    it("does not move for the whole wind-up, then recovers, then resumes chasing", () => {
        const enemy = makeMeleeEnemy(0, 0);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(100, 0, 0);

        let time = 10;
        enemy.update(player, [], 0.016, time, seqTypeLoader, seqFrameLoader, terrain);
        expect(enemy.state).toBe(EnemyState.WINDUP);

        const windupSeconds = ENEMY_MELEE.windupSeconds;
        time += windupSeconds - 0.001;
        enemy.update(
            player,
            [],
            windupSeconds - 0.001,
            time,
            seqTypeLoader,
            seqFrameLoader,
            terrain,
        );
        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.x).toBe(0);

        time += 0.002;
        enemy.update(player, [], 0.002, time, seqTypeLoader, seqFrameLoader, terrain);
        expect(enemy.state).toBe(EnemyState.RECOVERY);

        const recoverySeconds = ENEMY_MELEE.locks.find(
            (lock) => lock.group === CooldownGroup.ATTACK,
        )!.seconds;
        time += recoverySeconds + 0.01;
        enemy.update(
            player,
            [],
            recoverySeconds + 0.01,
            time,
            seqTypeLoader,
            seqFrameLoader,
            terrain,
        );
        expect(enemy.state).toBe(EnemyState.CHASE);
    });

    it("cancels the wind-up and resets the ability runtime if frozen mid wind-up", () => {
        const enemy = makeMeleeEnemy(0, 0);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);
        expect(enemy.state).toBe(EnemyState.WINDUP);

        enemy.frozenUntil = 20;
        enemy.update(player, [], 0.016, 10.1, seqTypeLoader, seqFrameLoader, terrain);
        expect(enemy.state).toBe(EnemyState.CHASE);
        expect(enemy.abilityRuntime.canUse(ENEMY_MELEE, 0, 10.1)).toBe(true);
    });
});
