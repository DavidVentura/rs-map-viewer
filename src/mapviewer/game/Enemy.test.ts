import { AbilityDefinition, AbilityEffectKind, CooldownGroup } from "./Ability";
import { AnimationPlayback } from "./Animation";
import { Combatant, Faction } from "./Combatant";
import {
    Enemy,
    EnemyDecisionInputs,
    EnemyState,
    computeChaseMovement,
    computeKeepDistanceMovement,
    decideEnemyState,
    enemyAttackRange,
    selectPatternAbility,
} from "./Enemy";
import {
    DropTier,
    EnemyBehaviour,
    EnemyType,
    EnemyTypeId,
    ResolvedEnemyType,
    resolveEnemyType,
} from "./EnemyType";
import { ARROW_SPEC } from "./Projectile";
import { Terrain } from "./Terrain";
import {
    GOBLIN_MELEE,
    TOK_XIL_RANGED_SHOT,
    YT_MEJKOT_HEAL_PULSE,
    YT_MEJKOT_MELEE,
} from "./abilities";
import { directionToRotation } from "./projectileMath";
import { stubSequenceLoaders } from "./testLoaders";

function decisionInputs(overrides: Partial<EnemyDecisionInputs> = {}): EnemyDecisionInputs {
    return {
        health: 20,
        distanceToPlayer: 0,
        hasPlayer: true,
        attackReach: 176,
        attackReachMin: 0,
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

    it("keeps chasing (not winding up) when closer than the minimum engage range of a banded attack", () => {
        expect(
            decideEnemyState(
                EnemyState.CHASE,
                decisionInputs({ distanceToPlayer: 100, attackReachMin: 512, attackReach: 896 }),
            ),
        ).toBe(EnemyState.CHASE);
    });

    it("winds up once within the banded attack's min/max window", () => {
        expect(
            decideEnemyState(
                EnemyState.CHASE,
                decisionInputs({ distanceToPlayer: 600, attackReachMin: 512, attackReach: 896 }),
            ),
        ).toBe(EnemyState.WINDUP);
    });
});

describe("enemyAttackRange", () => {
    it("adds both hit radii on top of a melee ability's reach", () => {
        expect(enemyAttackRange(GOBLIN_MELEE, 64, 64)).toBe(48 + 64 + 64);
    });

    it("uses the projectile spec's range for a ranged ability", () => {
        const rangedDefinition: AbilityDefinition = {
            ...GOBLIN_MELEE,
            id: "enemy_ranged",
            effect: { kind: AbilityEffectKind.PROJECTILE, spec: ARROW_SPEC },
        };
        expect(enemyAttackRange(rangedDefinition, 64, 64)).toBe(ARROW_SPEC.range);
    });

    it("uses the ground strike's own cast range, ignoring hit radii", () => {
        const groundStrikeDefinition: AbilityDefinition = {
            ...GOBLIN_MELEE,
            id: "enemy_ground_strike",
            effect: {
                kind: AbilityEffectKind.GROUND_STRIKE,
                radiusTiles: 1,
                telegraphSeconds: 1,
                damageMin: 1,
                damageMax: 1,
                range: 10 * 128,
            },
        };
        expect(enemyAttackRange(groundStrikeDefinition, 128, 64)).toBe(10 * 128);
    });
});

describe("computeKeepDistanceMovement", () => {
    it("retreats directly away from the player when closer than minRange", () => {
        const result = computeKeepDistanceMovement(100, 0, 100, 512, 896);
        expect(result.x).toBeCloseTo(-1);
        expect(result.y).toBeCloseTo(0);
    });

    it("approaches the player when farther than maxRange", () => {
        const result = computeKeepDistanceMovement(0, 1000, 1000, 512, 896);
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(1);
    });

    it("holds ground inside the band", () => {
        expect(computeKeepDistanceMovement(600, 0, 600, 512, 896)).toEqual({ x: 0, y: 0 });
    });

    it("returns a zero vector when already on top of the target", () => {
        expect(computeKeepDistanceMovement(0, 0, 0, 512, 896)).toEqual({ x: 0, y: 0 });
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

const { seqTypeLoader, seqFrameLoader } = stubSequenceLoaders();

function resolveType(type: EnemyType): ResolvedEnemyType {
    return resolveEnemyType(type, seqTypeLoader, seqFrameLoader);
}
const terrain: Terrain = {
    isLoaded: () => true,
    canOccupy: () => true,
    getWallFlag: () => 0,
    getHeight: () => 0,
};

class FakePlayer implements Combatant {
    readonly faction = Faction.PLAYER;
    readonly hitRadius = 64;
    readonly projectileLaunchHeight = 40;
    readonly maxHealth = 100;
    health = 100;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
    ) {}
}

const TEST_ENEMY_TYPE = resolveType({
    id: EnemyTypeId.GOBLIN,
    npcTypeId: 0,
    idleSeqId: 1,
    walkSeqId: 2,
    deathSeqId: 3,
    attackSeqId: 4,
    hitRadius: 64,
    projectileLaunchHeight: 40,
    maxHealth: 20,
    walkSpeed: 288 * 1.6,
    behaviour: EnemyBehaviour.RUSHER,
    abilities: [GOBLIN_MELEE],
    dropTier: DropTier.NONE,
});
const TEST_MELEE = TEST_ENEMY_TYPE.abilities[0];

const TEST_KITER_TYPE = resolveType({
    id: EnemyTypeId.TOK_XIL,
    npcTypeId: 0,
    idleSeqId: 1,
    walkSeqId: 2,
    deathSeqId: 3,
    attackSeqId: 4,
    hitRadius: 128,
    projectileLaunchHeight: 200,
    maxHealth: 150,
    walkSpeed: 288 * 1.6,
    behaviour: EnemyBehaviour.KITER,
    engagement: { minRange: 512 },
    abilities: [TOK_XIL_RANGED_SHOT],
    dropTier: DropTier.NONE,
});

const TEST_TANK_TYPE = resolveType({
    id: EnemyTypeId.YT_MEJKOT,
    npcTypeId: 0,
    idleSeqId: 1,
    walkSeqId: 2,
    deathSeqId: 3,
    attackSeqId: 4,
    hitRadius: 160,
    projectileLaunchHeight: 120,
    maxHealth: 360,
    walkSpeed: 288 * 1.6,
    behaviour: EnemyBehaviour.TANK,
    abilities: [YT_MEJKOT_HEAL_PULSE, YT_MEJKOT_MELEE],
    dropTier: DropTier.NONE,
});

function makeEnemy(): Enemy {
    return new Enemy(1, 0, 0, 0, 0, 0, TEST_ENEMY_TYPE);
}

describe("Enemy cast sequence", () => {
    it("plays the casting ability's own castSeqId rather than the type's cast/attack sequence", () => {
        const enemy = new Enemy(
            1,
            0,
            0,
            0,
            0,
            0,
            resolveType({ ...TEST_ENEMY_TYPE, castSeqId: 999 }),
        );
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.animation.seqId).toBe(GOBLIN_MELEE.castSeqId);
    });
});

describe("Enemy preview mode", () => {
    it("plays the pinned previewSeqId instead of running the AI state machine", () => {
        const enemy = makeEnemy();
        enemy.previewSeqId = 2639;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, [], 1, 1, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.animation.seqId).toBe(2639);
        expect(enemy.state).toBe(EnemyState.IDLE);
        expect(enemy.x).toBe(0);
        expect(enemy.y).toBe(0);
    });

    it("never enters the DEAD state even at zero health", () => {
        const enemy = makeEnemy();
        enemy.previewSeqId = 2639;
        enemy.health = 0;

        enemy.update(undefined, [], 1, 1, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).not.toBe(EnemyState.DEAD);
    });

    it("defaults previewPlayback to LOOP", () => {
        const enemy = makeEnemy();
        expect(enemy.previewPlayback).toBe(AnimationPlayback.LOOP);
    });
});

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
        return new Enemy(1, x, y, 0, x, y, TEST_ENEMY_TYPE);
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

        const impactSeconds = TEST_MELEE.timing.impactSeconds;
        time += impactSeconds - 0.001;
        enemy.update(
            player,
            [],
            impactSeconds - 0.001,
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

        const recoverySeconds = TEST_MELEE.locks.find(
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

    it("shows the cast sequence through its resolved animationSeconds, then falls back to idle for the rest of recovery", () => {
        const enemy = makeMeleeEnemy(0, 0);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(100, 0, 0);

        let time = 10;
        enemy.update(player, [], 0.016, time, seqTypeLoader, seqFrameLoader, terrain);
        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.animation.seqId).toBe(TEST_MELEE.castSeqId);

        const played = TEST_MELEE.timing.animationSeconds;
        const totalCommit =
            TEST_MELEE.timing.impactSeconds +
            TEST_MELEE.locks.find((lock) => lock.group === CooldownGroup.ATTACK)!.seconds;
        expect(played).toBeLessThan(totalCommit);

        const justBeforeAnimationEnds = 10 + played - 0.01;
        enemy.update(
            player,
            [],
            justBeforeAnimationEnds - time,
            justBeforeAnimationEnds,
            seqTypeLoader,
            seqFrameLoader,
            terrain,
        );
        time = justBeforeAnimationEnds;
        expect(enemy.state).toBe(EnemyState.RECOVERY);
        expect(enemy.animation.seqId).toBe(TEST_MELEE.castSeqId);

        const justAfterAnimationEnds = 10 + played + 0.01;
        enemy.update(
            player,
            [],
            justAfterAnimationEnds - time,
            justAfterAnimationEnds,
            seqTypeLoader,
            seqFrameLoader,
            terrain,
        );
        expect(enemy.state).toBe(EnemyState.RECOVERY);
        expect(enemy.animation.seqId).toBe(TEST_ENEMY_TYPE.idleSeqId);
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
        expect(enemy.abilityRuntime.canUse(TEST_MELEE, 0, 10.1)).toBe(true);
    });
});

describe("KITER behaviour (integration through Enemy.update)", () => {
    function makeKiter(x: number, y: number): Enemy {
        return new Enemy(1, x, y, 0, x, y, TEST_KITER_TYPE);
    }

    it("backs away when the player is closer than the engagement band", () => {
        const enemy = makeKiter(0, 0);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(100, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.CHASE);
        expect(enemy.x).toBeLessThan(0);
    });

    it("approaches when the player is farther than the engagement band", () => {
        const enemy = makeKiter(0, 0);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(2000, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.CHASE);
        expect(enemy.x).toBeGreaterThan(0);
    });

    it("holds ground and winds up once inside the band", () => {
        const enemy = makeKiter(0, 0);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(600, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.x).toBe(0);
    });
});

describe("TANK behaviour (integration through Enemy.update)", () => {
    it("prioritizes the heal pulse over melee whenever it is off cooldown", () => {
        const enemy = new Enemy(1, 0, 0, 0, 0, 0, TEST_TANK_TYPE);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(10000, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.abilityRuntime.pendingDefinition()?.id).toBe(YT_MEJKOT_HEAL_PULSE.id);
    });

    it("falls back to melee once the heal pulse is on cooldown and the player is in reach", () => {
        const enemy = new Enemy(1, 0, 0, 0, 0, 0, TEST_TANK_TYPE);
        enemy.state = EnemyState.CHASE;
        const farPlayer = new FakePlayer(10000, 0, 0);
        const frame = 0.05;
        let time = 10;

        enemy.update(farPlayer, [], frame, time, seqTypeLoader, seqFrameLoader, terrain);
        expect(enemy.abilityRuntime.pendingDefinition()?.id).toBe(YT_MEJKOT_HEAL_PULSE.id);

        let guard = 0;
        while (enemy.state !== EnemyState.CHASE && guard < 1000) {
            time += frame;
            enemy.update(farPlayer, [], frame, time, seqTypeLoader, seqFrameLoader, terrain);
            guard++;
        }
        expect(enemy.state).toBe(EnemyState.CHASE);

        const nearPlayer = new FakePlayer(100, 0, 0);
        time += frame;
        enemy.update(nearPlayer, [], frame, time, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.abilityRuntime.pendingDefinition()?.id).toBe(YT_MEJKOT_MELEE.id);
    });
});

describe("selectPatternAbility", () => {
    const A: AbilityDefinition = { ...GOBLIN_MELEE, id: "pattern_a" };
    const B: AbilityDefinition = { ...GOBLIN_MELEE, id: "pattern_b" };
    const C: AbilityDefinition = { ...GOBLIN_MELEE, id: "pattern_c" };
    const pattern = [A, B, C];

    it("picks the entry at startIndex when it is usable, advancing to the next index", () => {
        expect(selectPatternAbility(pattern, 0, () => true)).toEqual({
            ability: A,
            nextIndex: 1,
        });
    });

    it("wraps from the last entry back to the first", () => {
        expect(selectPatternAbility(pattern, 2, () => true)).toEqual({
            ability: C,
            nextIndex: 0,
        });
    });

    it("skips an entry that fails the usability check (e.g. melee out of range) and tries the next one in the cycle", () => {
        const isUsable = (ability: AbilityDefinition) => ability !== A;
        expect(selectPatternAbility(pattern, 0, isUsable)).toEqual({ ability: B, nextIndex: 2 });
    });

    it("returns undefined when no entry in the pattern is usable", () => {
        expect(selectPatternAbility(pattern, 0, () => false)).toBeUndefined();
    });

    it("passes each skipped candidate's own index to the usability check", () => {
        const seenIndices: number[] = [];
        selectPatternAbility(pattern, 1, (_, index) => {
            seenIndices.push(index);
            return index === 0;
        });
        // Starting at 1: tries 1, 2, then wraps to 0, which is the first accepted.
        expect(seenIndices).toEqual([1, 2, 0]);
    });
});

const TEST_BOSS_MELEE: AbilityDefinition = { ...GOBLIN_MELEE, id: "boss_melee" };
const TEST_BOSS_RANGED: AbilityDefinition = {
    ...GOBLIN_MELEE,
    id: "boss_ranged",
    effect: { kind: AbilityEffectKind.PROJECTILE, spec: ARROW_SPEC },
};

const TEST_BOSS_TYPE = resolveType({
    id: EnemyTypeId.TZTOK_JAD,
    npcTypeId: 0,
    idleSeqId: 1,
    walkSeqId: 2,
    deathSeqId: 3,
    attackSeqId: 4,
    hitRadius: 192,
    projectileLaunchHeight: 520,
    maxHealth: 1200,
    walkSpeed: 288 * 1.6,
    behaviour: EnemyBehaviour.BOSS,
    engagement: { leashRangeTiles: 6 },
    pattern: [TEST_BOSS_MELEE, TEST_BOSS_RANGED],
    abilities: [TEST_BOSS_MELEE, TEST_BOSS_RANGED],
    dropTier: DropTier.BOSS,
});

describe("BOSS behaviour (integration through Enemy.update)", () => {
    it("skips the melee pattern entry when the player is out of melee range and casts the ranged one instead", () => {
        const enemy = new Enemy(1, 0, 0, 0, 0, 0, TEST_BOSS_TYPE);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(1000, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.abilityRuntime.pendingDefinition()?.id).toBe(TEST_BOSS_RANGED.id);
    });

    it("casts the melee pattern entry, in pattern order, once the player is adjacent", () => {
        const enemy = new Enemy(1, 0, 0, 0, 0, 0, TEST_BOSS_TYPE);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(50, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.abilityRuntime.pendingDefinition()?.id).toBe(TEST_BOSS_MELEE.id);
    });

    it("advances through the pattern in order across repeated casts, not re-picking the entry it just used", () => {
        const enemy = new Enemy(1, 0, 0, 0, 0, 0, TEST_BOSS_TYPE);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(50, 0, 0);
        const frame = 0.05;
        let time = 10;

        enemy.update(player, [], frame, time, seqTypeLoader, seqFrameLoader, terrain);
        expect(enemy.abilityRuntime.pendingDefinition()?.id).toBe(TEST_BOSS_MELEE.id);

        let guard = 0;
        while (enemy.state !== EnemyState.CHASE && guard < 1000) {
            time += frame;
            enemy.update(player, [], frame, time, seqTypeLoader, seqFrameLoader, terrain);
            guard++;
        }
        expect(enemy.state).toBe(EnemyState.CHASE);

        time += frame;
        enemy.update(player, [], frame, time, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.WINDUP);
        expect(enemy.abilityRuntime.pendingDefinition()?.id).toBe(TEST_BOSS_RANGED.id);
    });

    it("holds ground instead of closing to melee range while the player is within the leash range", () => {
        const enemy = new Enemy(1, 0, 0, 0, 0, 0, TEST_BOSS_TYPE);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(500, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.x).toBe(0);
        expect(enemy.y).toBe(0);
    });

    it("approaches once the player is beyond both the leash range and every pattern entry's cast range", () => {
        const enemy = new Enemy(1, 0, 0, 0, 0, 0, TEST_BOSS_TYPE);
        enemy.state = EnemyState.CHASE;
        const player = new FakePlayer(ARROW_SPEC.range + 1000, 0, 0);

        enemy.update(player, [], 0.016, 10, seqTypeLoader, seqFrameLoader, terrain);

        expect(enemy.state).toBe(EnemyState.CHASE);
        expect(enemy.x).toBeGreaterThan(0);
    });
});
