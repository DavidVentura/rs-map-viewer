import { AbilityDefinition, AbilityEffectKind, CooldownGroup, WeaponStyle } from "./Ability";
import { CombatEventKind } from "./CombatEvent";
import { Faction } from "./Combatant";
import { Encounter, EncounterId, EncounterSpawnMode } from "./Encounter";
import { EnemyState } from "./Enemy";
import { DropTier, EnemyBehaviour, EnemyType, EnemyTypeId } from "./EnemyType";
import { AbilitySlotInput, GameWorld, SimInput } from "./GameWorld";
import { Player, StanceSeqIdsByStance } from "./Player";
import { ARROW_SPEC } from "./Projectile";
import { Terrain } from "./Terrain";
import {
    BOW_SHOT,
    CLEAVE,
    ENEMY_MELEE,
    HEALING_POTION,
    ICE_BARRAGE,
    MAGIC_BOLT,
    POWER_SHOT,
    SCIMITAR_SLASH,
    VOLLEY,
} from "./abilities";

class FakeTerrain implements Terrain {
    isLoaded(): boolean {
        return true;
    }

    canOccupy(): boolean {
        return true;
    }

    getWallFlag(): number {
        return 0;
    }

    getHeight(): number {
        return 0;
    }
}

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;
const seqFrameLoader = {} as any;

const STYLE_SEQ_IDS: StanceSeqIdsByStance = {
    [WeaponStyle.RANGED]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 426 },
    [WeaponStyle.MAGIC]: { idleSeqId: 813, walkSeqId: 1146, runSeqId: 1210, attackSeqId: 711 },
    [WeaponStyle.MELEE]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 390 },
};

function makeEnemyType(
    idleSeqId: number,
    walkSeqId: number,
    deathSeqId: number,
    attackSeqId: number = -1,
): EnemyType {
    return {
        id: EnemyTypeId.GOBLIN,
        npcTypeId: 0,
        idleSeqId,
        walkSeqId,
        deathSeqId,
        attackSeqId,
        hitRadius: 64,
        maxHealth: 20,
        walkSpeed: 288 * 1.6,
        behaviour: EnemyBehaviour.RUSHER,
        abilities: [ENEMY_MELEE],
        dropTier: DropTier.NONE,
    };
}

function idleAbilities(): AbilitySlotInput[] {
    return [{ held: false }, { held: false }, { held: false }, { held: false }];
}

function holdSlot(slot: number, target: { x: number; y: number; enemyId?: number }): SimInput {
    const abilities = idleAbilities();
    abilities[slot] = { held: true, target };
    return { movement: { x: 0, y: 0, running: false }, abilities };
}

function advanceSeconds(world: GameWorld, input: SimInput, seconds: number): void {
    const frame = 1 / 60;
    let remaining = seconds;
    while (remaining > 1e-9) {
        const dt = Math.min(frame, remaining);
        world.advance(dt, input);
        remaining -= dt;
    }
}

function idleInput(): SimInput {
    return { movement: { x: 0, y: 0, running: false }, abilities: idleAbilities() };
}

// Auto-picks the first upgrade offer whenever one is pending (a no-op otherwise), so a wave-clear
// upgrade pause between waves doesn't stall a test that isn't exercising the upgrade flow itself.
function autoUpgradeInput(): SimInput {
    return { ...idleInput(), chooseUpgrade: 0 };
}

describe("GameWorld ability wiring", () => {
    it("fires an arrow once the bow's wind-up elapses, not before", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const target = { x: 500, y: 0 };

        advanceSeconds(world, holdSlot(0, target), BOW_SHOT.impactSeconds - 0.05);
        expect(world.projectiles.length).toBe(0);

        advanceSeconds(world, holdSlot(0, target), 0.1);
        expect(world.projectiles.length).toBe(1);
    });

    it("re-fires the bow on cooldown while the slot stays held", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        // Far enough that neither arrow reaches its aimed landing point (and disappears) within
        // this test's short window, so both fired arrows are still in flight to be counted.
        const target = { x: 100000, y: 0 };

        const cooldownTotal = BOW_SHOT.impactSeconds + BOW_SHOT.locks[0].seconds;
        advanceSeconds(world, holdSlot(0, target), cooldownTotal * 2 + 0.1);
        expect(world.projectiles.length).toBe(2);
    });

    it("shares the ATTACK cooldown group across every style's basic attack", () => {
        for (const attack of [BOW_SHOT, MAGIC_BOLT, SCIMITAR_SLASH]) {
            expect(attack.requires).toContain(CooldownGroup.ATTACK);
            expect(attack.locks.some((lock) => lock.group === CooldownGroup.ATTACK)).toBe(true);
        }
    });

    it("heals the player and locks the ATTACK group when the potion is used", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const player = world.player!;
        player.health = 50;
        const healAmount =
            HEALING_POTION.effect.kind === AbilityEffectKind.HEAL
                ? HEALING_POTION.effect.amount
                : 0;
        const potionSlot = player.abilityBar.length - 1;

        advanceSeconds(
            world,
            holdSlot(potionSlot, { x: 0, y: 0 }),
            HEALING_POTION.impactSeconds + 0.05,
        );
        expect(player.health).toBe(50 + healAmount);

        advanceSeconds(world, holdSlot(0, { x: 500, y: 0 }), 0.05);
        expect(world.projectiles.length).toBe(0);
    });

    it("no-ops the potion at full health but still consumes the charge", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const player = world.player!;
        expect(player.health).toBe(player.maxHealth);
        const potionSlot = player.abilityBar.length - 1;

        advanceSeconds(
            world,
            holdSlot(potionSlot, { x: 0, y: 0 }),
            HEALING_POTION.impactSeconds + 0.05,
        );
        expect(player.health).toBe(player.maxHealth);
        expect(player.abilityRuntime.canUse(HEALING_POTION, player.mana, world.timeSeconds)).toBe(
            false,
        );
    });

    it("switches instantly through SimInput, with no delay before the player can move", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const player = world.player!;
        expect(player.style).toBe(WeaponStyle.RANGED);

        const switchInput: SimInput = {
            movement: { x: 0, y: 0, running: false },
            abilities: idleAbilities(),
            styleSwitch: WeaponStyle.MELEE,
        };
        advanceSeconds(world, switchInput, 1 / 120);
        expect(player.style).toBe(WeaponStyle.MELEE);

        const movingWhileIdle: SimInput = {
            movement: { x: 1, y: 0, running: false },
            abilities: idleAbilities(),
        };
        advanceSeconds(world, movingWhileIdle, 1 / 60);
        expect(player.x).toBeGreaterThan(0);
    });
});

describe("Melee style", () => {
    it("does not swing when the enemy is out of reach, and walks the player toward it instead", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdSlot(0, { x: enemy.x, y: enemy.y, enemyId: enemy.id }), 0.02);

        expect(enemy.health).toBe(enemy.maxHealth);
        expect(player.abilityRuntime.isBusy(world.timeSeconds)).toBe(false);
        expect(player.y).toBeGreaterThan(0);
        expect(player.y).toBeLessThan(200);
    });

    it("swings once close enough and damages the enemy", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(
            world,
            holdSlot(0, { x: enemy.x, y: enemy.y, enemyId: enemy.id }),
            SCIMITAR_SLASH.impactSeconds + 0.05,
        );

        expect(enemy.health).toBeLessThan(enemy.maxHealth);
    });

    it("Cleave hits an enemy in front of the player for double the basic slash damage", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];
        const basicMin =
            SCIMITAR_SLASH.effect.kind === AbilityEffectKind.MELEE
                ? SCIMITAR_SLASH.effect.minDamage
                : 0;

        advanceSeconds(
            world,
            holdSlot(1, { x: enemy.x, y: enemy.y, enemyId: enemy.id }),
            CLEAVE.impactSeconds + 0.05,
        );

        expect(enemy.health).toBe(enemy.maxHealth - basicMin * 2);
    });

    it("Cleave does not hit an enemy behind the player's facing", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, -200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdSlot(1, { x: 0, y: 200 }), CLEAVE.impactSeconds + 0.05);

        expect(enemy.health).toBe(enemy.maxHealth);
    });
});

describe("Ranged style", () => {
    it("Volley fires one arrow per spread direction on wind-up", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const target = { x: 500, y: 0 };
        const count =
            VOLLEY.effect.kind === AbilityEffectKind.MULTI_PROJECTILE ? VOLLEY.effect.count : 0;

        advanceSeconds(world, holdSlot(1, target), VOLLEY.impactSeconds + 0.05);

        expect(world.projectiles.length).toBe(count);
    });

    it("Power Shot pierces through multiple enemies along its path", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(200, 0, 0, makeEnemyType(1, 2, 3));
        world.spawnEnemy(400, 0, 0, makeEnemyType(1, 2, 3));
        const [near, far] = world.enemies;

        advanceSeconds(world, holdSlot(2, { x: 1000, y: 0 }), POWER_SHOT.impactSeconds + 0.5);

        expect(near.health).toBeLessThan(near.maxHealth);
        expect(far.health).toBeLessThan(far.maxHealth);
    });
});

describe("Magic style", () => {
    it("Ice Barrage damages and freezes enemies within its area", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;
        const enemy = world.enemies[0];

        advanceSeconds(
            world,
            holdSlot(1, { x: enemy.x, y: enemy.y, enemyId: enemy.id }),
            ICE_BARRAGE.impactSeconds + 0.05,
        );

        expect(enemy.health).toBeLessThan(enemy.maxHealth);
        expect(enemy.isFrozen(world.timeSeconds)).toBe(true);
        expect(world.visualEffects.length).toBe(1);
    });

    it("centers on the ground point when no enemy is targeted", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(300, 0, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;
        const enemy = world.enemies[0];

        advanceSeconds(
            world,
            holdSlot(1, { x: enemy.x, y: enemy.y }),
            ICE_BARRAGE.impactSeconds + 0.05,
        );

        expect(enemy.isFrozen(world.timeSeconds)).toBe(true);
    });
});

describe("Enemy attack cycle", () => {
    it("winds up more slowly than the player's fastest basic attack, so it reads as a telegraph", () => {
        expect(ENEMY_MELEE.impactSeconds).toBeGreaterThanOrEqual(0.5);
        expect(ENEMY_MELEE.impactSeconds).toBeGreaterThan(BOW_SHOT.impactSeconds);
    });

    it("lands a melee hit on the player once the wind-up completes while still in reach", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        const enemy = world.enemies[0];

        advanceSeconds(world, idleInput(), ENEMY_MELEE.impactSeconds + 0.05);

        const meleeEffect =
            ENEMY_MELEE.effect.kind === AbilityEffectKind.MELEE ? ENEMY_MELEE.effect : undefined;
        expect(meleeEffect).toBeDefined();
        expect(player.health).toBe(player.maxHealth - meleeEffect!.minDamage);
        expect(enemy.state).toBe(EnemyState.RECOVERY);
    });

    it("leaves the player's health unchanged while invulnerable", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        world.setInvulnerable(true);
        const player = world.player!;

        advanceSeconds(world, idleInput(), ENEMY_MELEE.impactSeconds + 0.05);

        expect(player.health).toBe(player.maxHealth);
    });

    it("misses the melee hit if the player retreats out of reach during the wind-up (dodge by distance)", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        const enemy = world.enemies[0];
        const frame = 1 / 120;

        let guard = 0;
        while (enemy.state !== EnemyState.WINDUP && guard < 1000) {
            world.advance(frame, idleInput());
            guard++;
        }
        expect(enemy.state).toBe(EnemyState.WINDUP);

        const retreatInput: SimInput = {
            movement: { x: 0, y: -1, running: true },
            abilities: idleAbilities(),
        };
        guard = 0;
        while (enemy.state === EnemyState.WINDUP && guard < 1000) {
            world.advance(frame, retreatInput);
            guard++;
        }

        expect(enemy.state).toBe(EnemyState.RECOVERY);
        expect(player.health).toBe(player.maxHealth);
    });

    it("cancels the enemy's wind-up entirely if frozen mid wind-up", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        const enemy = world.enemies[0];
        const frame = 1 / 120;

        let guard = 0;
        while (enemy.state !== EnemyState.WINDUP && guard < 1000) {
            world.advance(frame, idleInput());
            guard++;
        }
        expect(enemy.state).toBe(EnemyState.WINDUP);

        enemy.frozenUntil = world.timeSeconds + 10;
        world.advance(frame, idleInput());

        expect(enemy.state).toBe(EnemyState.CHASE);
        expect(player.health).toBe(player.maxHealth);
    });

    it("spawns an enemy-sourced projectile aimed at the player for a ranged enemy attack definition", () => {
        const rangedAttack: AbilityDefinition = {
            ...ENEMY_MELEE,
            id: "test_enemy_ranged",
            impactSeconds: 0.2,
            castSpeed: 1,
            effect: { kind: AbilityEffectKind.PROJECTILE, spec: ARROW_SPEC },
        };
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 300, 0, makeEnemyType(1, 2, 3, 4), [rangedAttack]);
        const player = world.player!;

        advanceSeconds(world, idleInput(), rangedAttack.impactSeconds + 0.05);

        expect(world.projectiles.length).toBe(1);
        expect(world.projectiles[0].sourceFaction).toBe(Faction.ENEMY);

        advanceSeconds(world, idleInput(), 1);

        expect(player.health).toBeLessThan(player.maxHealth);
    });
});

describe("Enemy death and respawn", () => {
    it("dies, emits ENEMY_DIED, then respawns at full health at its spawn point after a delay, emitting ENEMY_RESPAWNED", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(50, 100, 0, makeEnemyType(1, 2, 3));
        const enemy = world.enemies[0];
        enemy.health = 0;

        world.advance(1 / 120, idleInput());
        let events = world.drainEvents();
        expect(enemy.state).toBe(EnemyState.DEAD);
        expect(
            events.some(
                (event) => event.kind === CombatEventKind.ENEMY_DIED && event.target === enemy,
            ),
        ).toBe(true);

        let guard = 0;
        while (enemy.health < enemy.maxHealth && guard < 100000) {
            world.advance(1 / 120, idleInput());
            guard++;
        }
        events = world.drainEvents();

        expect(enemy.state).toBe(EnemyState.IDLE);
        expect(enemy.x).toBe(enemy.spawnX);
        expect(enemy.y).toBe(enemy.spawnY);
        expect(
            events.some(
                (event) => event.kind === CombatEventKind.ENEMY_RESPAWNED && event.target === enemy,
            ),
        ).toBe(true);
    });
});

describe("Player death and respawn", () => {
    it("dies, ignores input for the death duration, then respawns at full health/mana and resets the encounter", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(10, 20, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(50, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        const enemy = world.enemies[0];
        enemy.health = 5;
        player.health = 0;

        world.advance(1 / 120, idleInput());
        let events = world.drainEvents();
        expect(
            events.some(
                (event) => event.kind === CombatEventKind.PLAYER_DIED && event.target === player,
            ),
        ).toBe(true);
        expect(player.isDead(world.timeSeconds)).toBe(true);

        const moveInput: SimInput = {
            movement: { x: 1, y: 0, running: true },
            abilities: idleAbilities(),
        };
        advanceSeconds(world, moveInput, Player.DEATH_SECONDS - 0.05);
        expect(player.x).toBe(10);
        expect(player.y).toBe(20);
        expect(player.health).toBe(0);

        advanceSeconds(world, idleInput(), 0.1);

        expect(player.health).toBe(player.maxHealth);
        expect(player.mana).toBe(player.maxMana);
        expect(player.x).toBe(player.spawnX);
        expect(player.y).toBe(player.spawnY);
        expect(player.abilityRuntime.canUse(BOW_SHOT, player.mana, world.timeSeconds)).toBe(true);
        expect(enemy.health).toBe(enemy.maxHealth);
    });
});

const GROUND_STRIKE_TEST: AbilityDefinition = {
    id: "test_ground_strike",
    name: "Test Ground Strike",
    impactSeconds: 0.2,
    channelSeconds: 0,
    animationSeconds: 0.2,
    castSpeed: 1,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: {
        kind: AbilityEffectKind.GROUND_STRIKE,
        radiusTiles: 1,
        telegraphSeconds: 0.5,
        damageMin: 10,
        damageMax: 10,
        range: 1000,
    },
};

const GROUND_STRIKE_TELEGRAPH_SECONDS =
    GROUND_STRIKE_TEST.effect.kind === AbilityEffectKind.GROUND_STRIKE
        ? GROUND_STRIKE_TEST.effect.telegraphSeconds
        : 0;

describe("Ground strike", () => {
    it("does not damage on cast, only after the telegraph elapses", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(50, 0, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        const enemy = world.enemies[0];

        player.beginCast(GROUND_STRIKE_TEST, { x: enemy.x, y: enemy.y }, world.timeSeconds);
        advanceSeconds(world, idleInput(), GROUND_STRIKE_TEST.impactSeconds + 0.01);

        expect(enemy.health).toBe(enemy.maxHealth);
        expect(world.pendingGroundStrikes.length).toBe(1);
        expect(world.pendingGroundStrikes[0].x).toBe(enemy.x);
        expect(world.pendingGroundStrikes[0].y).toBe(enemy.y);

        advanceSeconds(world, idleInput(), GROUND_STRIKE_TELEGRAPH_SECONDS + 0.01);

        expect(enemy.health).toBe(enemy.maxHealth - 10);
        expect(world.pendingGroundStrikes.length).toBe(0);
    });

    it("emits GROUND_STRIKE_LANDED with position and radius when a strike lands", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const player = world.player!;

        player.beginCast(GROUND_STRIKE_TEST, { x: 200, y: 300 }, world.timeSeconds);
        advanceSeconds(world, idleInput(), GROUND_STRIKE_TEST.impactSeconds + 0.01);
        world.drainEvents();

        advanceSeconds(world, idleInput(), GROUND_STRIKE_TELEGRAPH_SECONDS + 0.01);
        const events = world.drainEvents();

        const landed = events.find((event) => event.kind === CombatEventKind.GROUND_STRIKE_LANDED);
        expect(landed).toBeDefined();
        if (landed && landed.kind === CombatEventKind.GROUND_STRIKE_LANDED) {
            expect(landed.x).toBe(200);
            expect(landed.y).toBe(300);
            expect(landed.radius).toBe(128);
        }
    });

    it("does not hit combatants outside the strike radius", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(1000, 0, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        const enemy = world.enemies[0];

        player.beginCast(GROUND_STRIKE_TEST, { x: 0, y: 0 }, world.timeSeconds);
        advanceSeconds(
            world,
            idleInput(),
            GROUND_STRIKE_TEST.impactSeconds + GROUND_STRIKE_TELEGRAPH_SECONDS + 0.1,
        );

        expect(enemy.health).toBe(enemy.maxHealth);
    });

    it("lets an enemy ground-strike the player", () => {
        const enemyGroundStrike: AbilityDefinition = {
            ...GROUND_STRIKE_TEST,
            id: "test_enemy_ground_strike",
        };
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 300, 0, makeEnemyType(1, 2, 3, 4), [enemyGroundStrike]);
        const player = world.player!;

        // +0.05 (not +0.01, as other enemy-cast tests in this file use) to cover the tick the
        // enemy spends going IDLE -> CHASE before it can even start winding up.
        advanceSeconds(world, idleInput(), enemyGroundStrike.impactSeconds + 0.05);
        expect(world.pendingGroundStrikes.length).toBe(1);

        advanceSeconds(world, idleInput(), GROUND_STRIKE_TELEGRAPH_SECONDS + 0.01);

        expect(player.health).toBe(player.maxHealth - 10);
    });
});

function bossTestEncounter(): Encounter {
    return {
        id: EncounterId.QUICK_CAVE,
        mapSquares: [],
        playerSpawn: { x: 0, y: 0, level: 0 },
        enemySpawns: [
            { x: 5000, y: 0, level: 0 },
            { x: -5000, y: 0, level: 0 },
        ],
        enemyTypeIds: [EnemyTypeId.TZ_KIH, EnemyTypeId.TZTOK_JAD, EnemyTypeId.YT_HURKOT],
        spawnMode: EncounterSpawnMode.WAVES,
        waves: [
            {
                groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
                startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 },
            },
            {
                groups: [{ enemyTypeId: EnemyTypeId.TZTOK_JAD, count: 1 }],
                startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: Infinity },
                boss: true,
            },
        ],
        ambientNpcs: false,
        musicFile: "audio/test.opus",
    };
}

describe("TzTok-Jad boss wave (integration)", () => {
    it("only spawns Jad once the previous wave is fully dead, then clears the encounter once Jad dies", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(bossTestEncounter(), 0, 0, 0, STYLE_SEQ_IDS);

        world.advance(1 / 120, autoUpgradeInput());
        expect(world.enemies.length).toBe(1);
        expect(world.enemies[0].type.id).toBe(EnemyTypeId.TZ_KIH);
        world.drainEvents();

        advanceSeconds(world, autoUpgradeInput(), 1);
        expect(world.enemies.some((enemy) => enemy.type.id === EnemyTypeId.TZTOK_JAD)).toBe(false);
        expect(world.getWaveProgress()?.cleared).toBe(false);

        world.enemies[0].health = 0;
        advanceSeconds(world, autoUpgradeInput(), 0.1);

        const jad = world.enemies.find((enemy) => enemy.type.id === EnemyTypeId.TZTOK_JAD);
        expect(jad).toBeDefined();
        expect(world.getWaveProgress()?.cleared).toBe(false);
        world.drainEvents();

        jad!.health = 0;
        advanceSeconds(world, autoUpgradeInput(), 0.1);
        const events = world.drainEvents();

        expect(events.some((event) => event.kind === CombatEventKind.ENCOUNTER_CLEARED)).toBe(true);
        expect(world.getWaveProgress()?.cleared).toBe(true);
    });

    it("spawns two Yt-HurKot healers and emits BOSS_PHASE once, when Jad's health first crosses 50%", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(bossTestEncounter(), 0, 0, 0, STYLE_SEQ_IDS);

        world.advance(1 / 120, autoUpgradeInput());
        world.enemies[0].health = 0;
        advanceSeconds(world, autoUpgradeInput(), 0.1);
        world.drainEvents();

        const jad = world.enemies.find((enemy) => enemy.type.id === EnemyTypeId.TZTOK_JAD)!;
        expect(jad).toBeDefined();

        jad.health = jad.maxHealth * 0.5;
        world.advance(1 / 120, autoUpgradeInput());
        const events = world.drainEvents();

        expect(events.some((event) => event.kind === CombatEventKind.BOSS_PHASE)).toBe(true);
        const healers = world.enemies.filter((enemy) => enemy.type.id === EnemyTypeId.YT_HURKOT);
        expect(healers.length).toBe(2);

        // Health dipping further below the threshold does not retrigger the phase or spawn more.
        jad.health = jad.maxHealth * 0.1;
        world.advance(1 / 120, autoUpgradeInput());
        const laterEvents = world.drainEvents();
        expect(laterEvents.some((event) => event.kind === CombatEventKind.BOSS_PHASE)).toBe(false);
        expect(
            world.enemies.filter((enemy) => enemy.type.id === EnemyTypeId.YT_HURKOT).length,
        ).toBe(2);
    });
});
