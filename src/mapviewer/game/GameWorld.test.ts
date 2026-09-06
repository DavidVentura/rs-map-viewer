import { AbilityEffectKind, CooldownGroup, WeaponStyle } from "./Ability";
import { AbilitySlotInput, GameWorld, SimInput } from "./GameWorld";
import { Player, StanceSeqIdsByStance } from "./Player";
import { Terrain } from "./Terrain";
import {
    BOW_SHOT,
    CLEAVE,
    HEALING_POTION,
    ICE_BARRAGE,
    MAGIC_BOLT,
    POWER_SHOT,
    SCIMITAR_SLASH,
    VOLLEY,
} from "./abilities";

class FakeTerrain implements Terrain {
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

describe("GameWorld ability wiring", () => {
    it("fires an arrow once the bow's wind-up elapses, not before", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const target = { x: 500, y: 0 };

        advanceSeconds(world, holdSlot(0, target), BOW_SHOT.windupSeconds - 0.05);
        expect(world.projectiles.length).toBe(0);

        advanceSeconds(world, holdSlot(0, target), 0.1);
        expect(world.projectiles.length).toBe(1);
    });

    it("re-fires the bow on cooldown while the slot stays held", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        const target = { x: 500, y: 0 };

        const cooldownTotal = BOW_SHOT.windupSeconds + BOW_SHOT.locks[0].seconds;
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
            HEALING_POTION.windupSeconds + 0.05,
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
            HEALING_POTION.windupSeconds + 0.05,
        );
        expect(player.health).toBe(player.maxHealth);
        expect(player.abilityRuntime.canUse(HEALING_POTION, player.mana, world.timeSeconds)).toBe(
            false,
        );
    });

    it("channels a style switch requested through SimInput, blocking movement until it completes", () => {
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
        expect(player.isSwitchingStyle(world.timeSeconds)).toBe(true);

        const movingWhileIdle: SimInput = {
            movement: { x: 1, y: 0, running: false },
            abilities: idleAbilities(),
        };

        advanceSeconds(world, movingWhileIdle, Player.STYLE_SWITCH_SECONDS / 2);
        expect(player.x).toBe(0);
        expect(player.style).toBe(WeaponStyle.RANGED);

        advanceSeconds(world, movingWhileIdle, Player.STYLE_SWITCH_SECONDS / 2 + 0.1);
        expect(player.style).toBe(WeaponStyle.MELEE);
    });
});

describe("Melee style", () => {
    it("does not swing when the enemy is out of reach, and walks the player toward it instead", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 200, 0, 1, 2, 3);
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
        world.spawnEnemy(0, 100, 0, 1, 2, 3);
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(
            world,
            holdSlot(0, { x: enemy.x, y: enemy.y, enemyId: enemy.id }),
            SCIMITAR_SLASH.windupSeconds + 0.05,
        );

        expect(enemy.health).toBeLessThan(enemy.maxHealth);
    });

    it("Cleave hits an enemy in front of the player for double the basic slash damage", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 200, 0, 1, 2, 3);
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
            CLEAVE.windupSeconds + 0.05,
        );

        expect(enemy.health).toBe(enemy.maxHealth - basicMin * 2);
    });

    it("Cleave does not hit an enemy behind the player's facing", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, -200, 0, 1, 2, 3);
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdSlot(1, { x: 0, y: 200 }), CLEAVE.windupSeconds + 0.05);

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

        advanceSeconds(world, holdSlot(1, target), VOLLEY.windupSeconds + 0.05);

        expect(world.projectiles.length).toBe(count);
    });

    it("Power Shot pierces through multiple enemies along its path", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(200, 0, 0, 1, 2, 3);
        world.spawnEnemy(400, 0, 0, 1, 2, 3);
        const [near, far] = world.enemies;

        advanceSeconds(world, holdSlot(2, { x: 1000, y: 0 }), POWER_SHOT.windupSeconds + 0.5);

        expect(near.health).toBeLessThan(near.maxHealth);
        expect(far.health).toBeLessThan(far.maxHealth);
    });
});

describe("Magic style", () => {
    it("Ice Barrage damages and freezes enemies within its area", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(0, 100, 0, 1, 2, 3);
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;
        const enemy = world.enemies[0];

        advanceSeconds(
            world,
            holdSlot(1, { x: enemy.x, y: enemy.y, enemyId: enemy.id }),
            ICE_BARRAGE.windupSeconds + 0.05,
        );

        expect(enemy.health).toBeLessThan(enemy.maxHealth);
        expect(enemy.isFrozen(world.timeSeconds)).toBe(true);
        expect(world.visualEffects.length).toBe(1);
    });

    it("centers on the ground point when no enemy is targeted", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
        world.spawnEnemy(300, 0, 0, 1, 2, 3);
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;
        const enemy = world.enemies[0];

        advanceSeconds(
            world,
            holdSlot(1, { x: enemy.x, y: enemy.y }),
            ICE_BARRAGE.windupSeconds + 0.05,
        );

        expect(enemy.isFrozen(world.timeSeconds)).toBe(true);
    });
});
