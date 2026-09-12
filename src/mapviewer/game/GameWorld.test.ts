import {
    AbilityDefinition,
    AbilityTarget,
    AbilityTargetKind,
    CircleCenter,
    ConeDelivery,
    CooldownGroup,
    DeliveryKind,
    ResolvedAbility,
    WeaponStyle,
    resolveAbility,
} from "./Ability";
import { CombatEventKind } from "./CombatEvent";
import { Combatant, Faction } from "./Combatant";
import { Affects, PayloadKind, damagePayload } from "./Effect";
import { coneTileSpawns } from "./EffectResolution";
import { Encounter, EncounterId, EncounterSpawnMode } from "./Encounter";
import { EnemyState } from "./Enemy";
import {
    DropTier,
    EnemyBehaviour,
    EnemyTypeId,
    ResolvedEnemyType,
    resolveEnemyType,
} from "./EnemyType";
import {
    AbilitySlotInput,
    CombatInput,
    GameWorld,
    ScheduledVisualEffect,
    SimInput,
} from "./GameWorld";
import {
    WorldObjectKind,
    createInteraction,
    createInteractionId,
    createWorldObject,
    createWorldObjectId,
    createWorldPosition,
} from "./Interaction";
import { createPhase, createPhaseId } from "./Phase";
import { Player } from "./Player";
import { createExperience } from "./Progression";
import { ARROW_SPEC, JAD_RANGED_ROCK_SPEC } from "./Projectile";
import { recordStationaryRangedHit } from "./StanceMechanics";
import { TILE_SIZE, Terrain } from "./Terrain";
import { VisualEffectKind } from "./VisualEffect";
import {
    BOW_SHOT,
    CLEAVE,
    GOBLIN_MELEE,
    HEALING_POTION,
    ICE_BARRAGE,
    JAD_RANGED_STOMP,
    MAGIC_BOLT,
    MAUL_SMASH,
    POWER_SHOT,
    SCIMITAR_SLASH,
    TOK_XIL_RANGED_SHOT,
    VOLLEY,
    YT_MEJKOT_HEAL_PULSE,
} from "./abilities";
import {
    STUB_FRAME_COUNT,
    STUB_FRAME_SECONDS,
    stubEncounterAnimations,
    stubSeqCatalog,
} from "./testLoaders";

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

const seqCatalog = stubSeqCatalog();
const ANIMATIONS = stubEncounterAnimations();

function resolve(definition: AbilityDefinition): ResolvedAbility {
    return resolveAbility(definition, seqCatalog);
}

function impactOf(definition: AbilityDefinition): number {
    return resolve(definition).timing.impactSeconds;
}

function makeEnemyType(
    idleSeqId: number,
    walkSeqId: number,
    deathSeqId: number,
    abilities: readonly AbilityDefinition[] = [GOBLIN_MELEE],
): ResolvedEnemyType {
    return resolveEnemyType(
        {
            id: EnemyTypeId.GOBLIN,
            npcTypeId: 0,
            idleSeqId,
            walkSeqId,
            deathSeqId,
            attackSeqId: -1,
            hitRadius: 64,
            projectileLaunchHeight: 40,
            maxHealth: 20,
            experienceReward: createExperience(0),
            walkSpeed: 288 * 1.6,
            behaviour: EnemyBehaviour.RUSHER,
            abilities,
            dropTier: DropTier.NONE,
        },
        seqCatalog,
    );
}

function idleCombat(): CombatInput {
    return { basicAttack: { held: false }, skills: [] };
}

function point(x: number, y: number): AbilityTarget {
    return { kind: AbilityTargetKind.POINT, x, y };
}

function at(combatant: Combatant): AbilityTarget {
    return { kind: AbilityTargetKind.COMBATANT, combatant };
}

function minDamage(definition: AbilityDefinition): number {
    const payload = definition.effect.payloads.find(
        (candidate) => candidate.kind === PayloadKind.DAMAGE,
    );
    if (!payload || payload.kind !== PayloadKind.DAMAGE) {
        throw new Error(`${definition.id} has no DAMAGE payload`);
    }
    return payload.roll.min;
}

function healAmount(definition: AbilityDefinition): number {
    const payload = definition.effect.payloads.find(
        (candidate) => candidate.kind === PayloadKind.HEAL,
    );
    if (!payload || payload.kind !== PayloadKind.HEAL) {
        throw new Error(`${definition.id} has no HEAL payload`);
    }
    return payload.amount;
}

function holdBasicAttack(target: AbilityTarget): SimInput {
    return {
        movement: { x: 0, y: 0, running: false },
        combat: { basicAttack: { held: true, target }, skills: [] },
    };
}

function holdSkill(skillSlot: number, target: AbilityTarget): SimInput {
    const skills: AbilitySlotInput[] = Array.from({ length: skillSlot + 1 }, () => ({
        held: false,
    }));
    skills[skillSlot] = { held: true, target };
    return {
        movement: { x: 0, y: 0, running: false },
        combat: { basicAttack: { held: false }, skills },
    };
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
    return { movement: { x: 0, y: 0, running: false }, combat: idleCombat() };
}

function autoUpgradeInput(): SimInput {
    return idleInput();
}

describe("GameWorld ability wiring", () => {
    it("fires an arrow once the bow's wind-up elapses, not before", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        const target = point(500, 0);

        advanceSeconds(world, holdBasicAttack(target), impactOf(BOW_SHOT) - 0.05);
        expect(world.projectiles.length).toBe(0);

        advanceSeconds(world, holdBasicAttack(target), 0.1);
        expect(world.projectiles.length).toBe(1);
    });

    it("re-fires the bow on cooldown while the slot stays held", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        // Far enough that neither arrow reaches its aimed landing point (and disappears) within
        // this test's short window, so both fired arrows are still in flight to be counted.
        const target = point(100000, 0);

        const cooldownTotal = impactOf(BOW_SHOT) + BOW_SHOT.locks[0].seconds;
        advanceSeconds(world, holdBasicAttack(target), cooldownTotal * 2 + 0.1);
        expect(world.projectiles.length).toBe(2);
    });

    it("fires two tracked arrows after five confirmed stationary ranged hits", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        const player = world.player!;
        for (let hit = 0; hit < 5; hit++) {
            player.stanceMechanics = recordStationaryRangedHit(player.stanceMechanics);
        }

        advanceSeconds(world, holdBasicAttack(point(100000, 0)), impactOf(BOW_SHOT) + 0.05);

        expect(world.projectiles).toHaveLength(2);
        expect(player.stanceMechanics.rangedConsecutiveHits).toBe(0);
    });

    it("counts a confirmed ranged hit and clears the sequence on movement", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(100, 0, 0, { ...makeEnemyType(1, 2, 3), maxHealth: 100 });
        const player = world.player!;

        advanceSeconds(world, holdBasicAttack(at(world.enemies[0])), impactOf(BOW_SHOT) + 0.2);
        expect(player.stanceMechanics.rangedConsecutiveHits).toBe(1);

        world.advance(1 / 120, {
            ...idleInput(),
            movement: { x: 1, y: 0, running: false },
        });
        expect(player.stanceMechanics.rangedConsecutiveHits).toBe(0);
    });

    it("shares the ATTACK cooldown group across every style's basic attack", () => {
        for (const attack of [BOW_SHOT, MAGIC_BOLT, SCIMITAR_SLASH]) {
            expect(attack.requires).toContain(CooldownGroup.ATTACK);
            expect(attack.locks.some((lock) => lock.group === CooldownGroup.ATTACK)).toBe(true);
        }
    });

    it("heals the player and locks the ATTACK group when the potion is used", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        const player = world.player!;
        player.health = 50;
        advanceSeconds(world, holdSkill(2, point(0, 0)), impactOf(HEALING_POTION) + 0.05);
        expect(player.health).toBe(50 + healAmount(HEALING_POTION));

        advanceSeconds(world, holdBasicAttack(point(500, 0)), 0.05);
        expect(world.projectiles.length).toBe(0);
    });

    it("no-ops the potion at full health but still consumes the charge", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        const player = world.player!;
        expect(player.health).toBe(player.maxHealth);
        advanceSeconds(world, holdSkill(2, point(0, 0)), impactOf(HEALING_POTION) + 0.05);
        expect(player.health).toBe(player.maxHealth);
        expect(player.abilityRuntime.canUse(HEALING_POTION, player.mana, world.timeSeconds)).toBe(
            false,
        );
    });

    it("switches instantly through SimInput, with no delay before the player can move", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        const player = world.player!;
        expect(player.style).toBe(WeaponStyle.RANGED);

        const switchInput: SimInput = {
            movement: { x: 0, y: 0, running: false },
            combat: idleCombat(),
            styleSwitch: WeaponStyle.MELEE,
        };
        advanceSeconds(world, switchInput, 1 / 120);
        expect(player.style).toBe(WeaponStyle.MELEE);

        const movingWhileIdle: SimInput = {
            movement: { x: 1, y: 0, running: false },
            combat: idleCombat(),
        };
        advanceSeconds(world, movingWhileIdle, 1 / 60);
        expect(player.x).toBeGreaterThan(0);
    });
});

describe("Melee style", () => {
    it("does not swing when the enemy is out of reach, and walks the player toward it instead", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdBasicAttack(at(enemy)), 0.02);

        expect(enemy.health).toBe(enemy.maxHealth);
        expect(player.abilityRuntime.isBusy(world.timeSeconds)).toBe(false);
        expect(player.y).toBeGreaterThan(0);
        expect(player.y).toBeLessThan(200);
    });

    it("does not chase an out-of-range target when a melee skill is held", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;

        advanceSeconds(world, holdSkill(0, at(world.enemies[0])), 0.02);

        expect(player.abilityRuntime.isBusy(world.timeSeconds)).toBe(true);
        expect(player.abilityRuntime.activeCastAnimation(world.timeSeconds)?.definition.id).toBe(
            CLEAVE.id,
        );
        expect(player.y).toBe(0);
    });

    it("swings once close enough and damages the enemy", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdBasicAttack(at(enemy)), impactOf(SCIMITAR_SLASH) + 0.05);

        expect(enemy.health).toBe(enemy.maxHealth - minDamage(SCIMITAR_SLASH) * 2);
    });

    it("Cleave hits an enemy in front of the player for double the basic slash damage", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdSkill(0, point(enemy.x, enemy.y)), impactOf(CLEAVE) + 0.05);

        expect(minDamage(CLEAVE)).toBe(minDamage(SCIMITAR_SLASH) * 2);
        expect(enemy.health).toBe(enemy.maxHealth - minDamage(CLEAVE));
    });

    it("Cleave does not hit an enemy behind the player's facing", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, -200, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdSkill(0, point(0, 200)), impactOf(CLEAVE) + 0.05);

        expect(enemy.health).toBe(enemy.maxHealth);
    });
});

describe("Scheduled visual effects", () => {
    const dustWave = MAUL_SMASH.effect.hitEffect!;

    it("starts a pending effect once its start time is due, not before", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.pendingVisualEffects.push({
            hitEffect: dustWave,
            anchor: { kind: "POINT", x: 0, y: 0, level: 0 },
            startsAt: 0.5,
        });

        advanceSeconds(world, idleInput(), 0.4);
        expect(world.visualEffects.length).toBe(0);
        expect(world.pendingVisualEffects.length).toBe(1);

        advanceSeconds(world, idleInput(), 0.2);
        expect(world.pendingVisualEffects.length).toBe(0);
        expect(world.visualEffects.length).toBe(1);
        expect(world.visualEffects[0].kind).toBe(dustWave.kind);
        expect(world.visualEffects[0].height).toBe(dustWave.height);
    });

    it("counts pending effects against the visual effect budget", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        world.player!.style = WeaponStyle.MAGIC;
        for (let i = 0; i < GameWorld.MAX_VISUAL_EFFECTS; i++) {
            world.pendingVisualEffects.push({
                hitEffect: dustWave,
                anchor: { kind: "POINT", x: 0, y: 0, level: 0 },
                startsAt: 1000,
            });
        }

        advanceSeconds(world, holdSkill(0, at(world.enemies[0])), impactOf(ICE_BARRAGE) + 0.05);

        expect(world.visualEffects.length).toBe(0);
    });
});

describe("Maul Smash ground dust", () => {
    const coneDelivery = MAUL_SMASH.effect.delivery;
    if (coneDelivery.kind !== DeliveryKind.CONE) {
        throw new Error("expected a CONE delivery");
    }
    const cone: ConeDelivery = coneDelivery;

    // Casts the smash from the centre of tile (0, 0) aiming north, with `reserved` far-future
    // effects already holding part of the budget, and returns the newly scheduled dust waves.
    function castSmash(reserved: number): {
        world: GameWorld;
        scheduled: ScheduledVisualEffect[];
    } {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0.5 * TILE_SIZE, 0.5 * TILE_SIZE, 0);
        world.player!.style = WeaponStyle.MELEE;
        const placeholders: ScheduledVisualEffect[] = Array.from({ length: reserved }, () => ({
            hitEffect: MAUL_SMASH.effect.hitEffect!,
            anchor: { kind: "POINT", x: 0, y: 0, level: 0 },
            startsAt: 1000,
        }));
        world.pendingVisualEffects.push(...placeholders);

        advanceSeconds(
            world,
            holdSkill(1, point(0.5 * TILE_SIZE, 5 * TILE_SIZE)),
            impactOf(MAUL_SMASH) + 0.05,
        );

        const scheduled = world.pendingVisualEffects.filter(
            (pending) => !placeholders.includes(pending),
        );
        return { world, scheduled };
    }

    it("schedules one dust wave per covered tile, staggered outward", () => {
        const { world, scheduled } = castSmash(0);
        const player = world.player!;
        const expectedTiles = coneTileSpawns(player.x, player.y, player.rotation, cone, () => 0);

        expect(expectedTiles.length).toBeGreaterThan(1);
        expect(scheduled.length + world.visualEffects.length).toBe(expectedTiles.length);
        for (const pending of scheduled) {
            expect(pending.hitEffect.kind).toBe(MAUL_SMASH.effect.hitEffect!.kind);
            expect(pending.hitEffect.height).toBe(0);
            expect(pending.anchor.kind).toBe("POINT");
        }
        const starts = scheduled.map((pending) => pending.startsAt);
        expect(Math.max(...starts)).toBeGreaterThan(Math.min(...starts));

        advanceSeconds(world, idleInput(), 0.5);
        expect(world.pendingVisualEffects.length).toBe(0);
        expect(world.visualEffects.length).toBe(expectedTiles.length);
    });

    it("keeps the farthest tiles when the budget runs short", () => {
        const full = castSmash(0).scheduled.map((pending) => pending.startsAt);
        const { scheduled } = castSmash(GameWorld.MAX_VISUAL_EFFECTS - 2);

        const latestTwo = [...full].sort((a, b) => b - a).slice(0, 2);
        expect(scheduled.map((pending) => pending.startsAt).sort((a, b) => b - a)).toEqual(
            latestTwo,
        );
    });

    it("Cleave has no per-tile ground graphic, only its own caster-anchored weapon trail", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.player!.style = WeaponStyle.MELEE;

        advanceSeconds(world, holdSkill(0, point(0, 200)), impactOf(CLEAVE) + 0.05);

        expect(world.pendingVisualEffects.length).toBe(0);
        expect(world.visualEffects.length).toBe(1);
        expect(world.visualEffects[0].kind).toBe(CLEAVE.effect.casterEffect!.kind);
        expect(world.visualEffects[0].x).toBe(world.player!.x);
        expect(world.visualEffects[0].y).toBe(world.player!.y);
    });
});

describe("Ranged style", () => {
    it("Volley fires one arrow per spread direction on wind-up", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        const target = point(500, 0);
        const count =
            VOLLEY.effect.delivery.kind === DeliveryKind.PROJECTILE
                ? VOLLEY.effect.delivery.count
                : 0;

        advanceSeconds(world, holdSkill(0, target), impactOf(VOLLEY) + 0.05);

        expect(world.projectiles.length).toBe(count);
    });

    it("Power Shot pierces through multiple enemies along its path", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(200, 0, 0, makeEnemyType(1, 2, 3));
        world.spawnEnemy(400, 0, 0, makeEnemyType(1, 2, 3));
        const [near, far] = world.enemies;

        advanceSeconds(world, holdSkill(1, point(1000, 0)), impactOf(POWER_SHOT) + 0.5);

        expect(near.health).toBeLessThan(near.maxHealth);
        expect(far.health).toBeLessThan(far.maxHealth);
    });
});

describe("Magic style", () => {
    it("refunds magic mana when a distinct enemy is hit", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(100, 0, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;

        advanceSeconds(world, holdBasicAttack(at(world.enemies[0])), impactOf(MAGIC_BOLT) + 0.01);
        advanceSeconds(world, idleInput(), 0.2);

        expect(player.mana).toBeGreaterThan(player.maxMana - MAGIC_BOLT.manaCost);
        expect(player.mana).toBeLessThanOrEqual(player.maxMana);
    });

    it("Ice Barrage damages and freezes enemies within its area", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdSkill(0, at(enemy)), impactOf(ICE_BARRAGE) + 0.05);

        expect(enemy.health).toBeLessThan(enemy.maxHealth);
        expect(enemy.isFrozen(world.timeSeconds)).toBe(true);
        expect(world.visualEffects.length).toBe(1);
    });

    it("refunds mana once per distinct enemy hit by a crowd spell", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.setGodMode(true);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        world.spawnEnemy(50, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;
        player.mana = 0;

        advanceSeconds(world, holdSkill(0, point(0, 100)), impactOf(ICE_BARRAGE) + 0.05);

        expect(player.mana).toBeGreaterThanOrEqual(8);
    });

    it("centers on the ground point when no enemy is targeted", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(300, 0, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        player.style = WeaponStyle.MAGIC;
        const enemy = world.enemies[0];

        advanceSeconds(world, holdSkill(0, point(enemy.x, enemy.y)), impactOf(ICE_BARRAGE) + 0.05);

        expect(enemy.isFrozen(world.timeSeconds)).toBe(true);
    });
});

describe("Enemy attack cycle", () => {
    it("winds up more slowly than the player's fastest basic attack, so it reads as a telegraph", () => {
        expect(impactOf(GOBLIN_MELEE)).toBeGreaterThan(impactOf(BOW_SHOT));
    });

    it("lands a melee hit on the player once the wind-up completes while still in reach", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        const player = world.player!;
        const enemy = world.enemies[0];

        advanceSeconds(world, idleInput(), impactOf(GOBLIN_MELEE) + 0.05);

        expect(player.health).toBe(player.maxHealth - minDamage(GOBLIN_MELEE));
        expect(enemy.state).toBe(EnemyState.RECOVERY);
    });

    it("leaves the player's health unchanged in god mode", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 100, 0, makeEnemyType(1, 2, 3));
        world.setGodMode(true);
        const player = world.player!;

        advanceSeconds(world, idleInput(), impactOf(GOBLIN_MELEE) + 0.05);

        expect(player.health).toBe(player.maxHealth);
    });

    it("misses the melee hit if the player retreats out of reach during the wind-up (dodge by distance)", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
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
            combat: idleCombat(),
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
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
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
            ...GOBLIN_MELEE,
            id: "test_enemy_ranged",
            contactFrame: 2,
            castSpeed: 1,
            effect: {
                delivery: {
                    kind: DeliveryKind.PROJECTILE,
                    spec: ARROW_SPEC,
                    count: 1,
                    spreadAngleRadians: 0,
                },
                affects: Affects.HOSTILE,
                payloads: [damagePayload(3)],
            },
        };
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 300, 0, makeEnemyType(1, 2, 3, [rangedAttack]));
        const player = world.player!;

        advanceSeconds(world, idleInput(), impactOf(rangedAttack) + 0.05);

        expect(world.projectiles.length).toBe(1);
        expect(world.projectiles[0].impact.caster.faction).toBe(Faction.ENEMY);

        advanceSeconds(world, idleInput(), 1);

        expect(player.health).toBeLessThan(player.maxHealth);
    });
});

describe("Enemy death and respawn", () => {
    it("dies, emits ENEMY_DIED, then respawns at full health at its spawn point after a delay, emitting ENEMY_RESPAWNED", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
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

    it("awards authored enemy experience and emits a level-up event", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(0, 0, 0);
        const enemyId = world.spawnEnemy(100, 0, 0, {
            ...makeEnemyType(1, 2, 3),
            experienceReward: createExperience(100),
        });
        const enemy = world.findEnemy(enemyId)!;
        enemy.health = 0;

        world.advance(1 / 120, idleInput());

        expect(world.player!.characterLevel).toBe(2);
        expect(world.drainEvents()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: CombatEventKind.LEVEL_UP, level: 2 }),
            ]),
        );
    });
});

describe("Player death and respawn", () => {
    it("dies, ignores input for the death duration, then respawns at full health/mana and resets the encounter", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS);
        world.spawnPlayer(10, 20, 0);
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
            combat: idleCombat(),
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

describe("Projectile telegraph", () => {
    it("spawns a falling shadow at the rock's landing point that disappears once it lands", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 300, 0, makeEnemyType(1, 2, 3, [JAD_RANGED_STOMP]));
        const player = world.player!;

        advanceSeconds(world, idleInput(), impactOf(JAD_RANGED_STOMP) + 0.05);

        expect(world.projectiles.length).toBe(1);
        expect(world.visualEffects.length).toBe(1);
        expect(world.visualEffects[0].kind).toBe(VisualEffectKind.FALLING_SHADOW);
        expect(world.visualEffects[0].x).toBe(player.x);
        expect(world.visualEffects[0].y).toBe(player.y);

        advanceSeconds(world, idleInput(), JAD_RANGED_ROCK_SPEC.travelTime.baseSeconds - 0.1);
        expect(world.visualEffects.length).toBe(1);

        advanceSeconds(world, idleInput(), 0.2);
        expect(world.visualEffects.length).toBe(0);
    });

    it("drops the rock on the player's position at contact time, not cast start, and keeps it pinned there through the fall", () => {
        class SlopedTerrain implements Terrain {
            isLoaded(): boolean {
                return true;
            }

            canOccupy(): boolean {
                return true;
            }

            getWallFlag(): number {
                return 0;
            }

            getHeight(_level: number, x: number, y: number): number {
                return 1000 + x + 2 * y;
            }
        }
        const terrain = new SlopedTerrain();
        const world = new GameWorld(terrain, ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 300, 0, makeEnemyType(1, 2, 3, [JAD_RANGED_STOMP]));
        const player = world.player!;

        const runInput: SimInput = {
            movement: { x: 1, y: 0, running: true },
            combat: idleCombat(),
        };
        const tick = GameWorld.FIXED_STEP_SECONDS;
        let contactX: number | undefined;
        let contactY: number | undefined;
        for (let i = 0; i < 1000 && world.projectiles.length === 0; i++) {
            world.advance(tick, runInput);
            if (world.projectiles.length > 0) {
                contactX = player.x;
                contactY = player.y;
            }
        }

        // The player must actually have moved away from its cast-start position for this test to
        // tell cast-start placement apart from contact-time placement.
        expect(contactX).not.toBe(player.spawnX);
        expect(contactX).toBeDefined();
        expect(contactY).toBeDefined();

        const rock = world.projectiles[0];
        expect(rock.x).toBe(contactX);
        expect(rock.y).toBe(contactY);
        expect(rock.height).toBeCloseTo(terrain.getHeight(0, contactX!, contactY!), 0);

        expect(world.visualEffects.length).toBe(1);
        expect(world.visualEffects[0].x).toBe(contactX);
        expect(world.visualEffects[0].y).toBe(contactY);

        const fallPositions: { x: number; y: number }[] = [];
        for (let i = 0; i < 1000 && world.projectiles.length > 0; i++) {
            world.advance(tick, idleInput());
            if (world.projectiles.length > 0) {
                fallPositions.push({ x: world.projectiles[0].x, y: world.projectiles[0].y });
            }
        }
        for (const position of fallPositions) {
            expect(position).toEqual({ x: contactX, y: contactY });
        }

        // The player stood still under the rock's landing point through the fall, so it lands on it.
        expect(player.health).toBeLessThan(player.maxHealth);
    });

    it("spawns no telegraph for a fixed-point spec without one", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(0, 300, 0, makeEnemyType(1, 2, 3, [TOK_XIL_RANGED_SHOT]));

        advanceSeconds(world, idleInput(), impactOf(TOK_XIL_RANGED_SHOT) + 0.05);

        expect(world.projectiles.length).toBe(1);
        expect(world.visualEffects.length).toBe(0);
    });
});

// A hostile circle around the caster, the same definition cast by either side below.
const NOVA_TEST: AbilityDefinition = {
    id: "test_nova",
    name: "Test Nova",
    castSeqId: 5,
    contactFrame: 2,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 2, center: CircleCenter.CASTER },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(10)],
    },
};

describe("Faction filtering through one resolver", () => {
    it("hits only enemies when the player casts a hostile circle, and only the player when an enemy casts the same one", () => {
        const playerWorld = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        playerWorld.spawnPlayer(0, 0, 0);
        playerWorld.spawnEnemy(100, 0, 0, makeEnemyType(1, 2, 3));
        playerWorld.spawnEnemy(-100, 0, 0, makeEnemyType(1, 2, 3));
        const player = playerWorld.player!;
        player.beginCast(resolve(NOVA_TEST), point(0, 0), playerWorld.timeSeconds);
        advanceSeconds(playerWorld, idleInput(), impactOf(NOVA_TEST) + 0.01);

        expect(player.health).toBe(player.maxHealth);
        for (const enemy of playerWorld.enemies) {
            expect(enemy.health).toBe(enemy.maxHealth - 10);
        }

        const enemyWorld = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        enemyWorld.spawnPlayer(0, 0, 0);
        enemyWorld.spawnEnemy(100, 0, 0, makeEnemyType(1, 2, 3, [NOVA_TEST]));
        enemyWorld.spawnEnemy(-100, 0, 0, makeEnemyType(1, 2, 3, [NOVA_TEST]));
        const victim = enemyWorld.player!;
        advanceSeconds(enemyWorld, idleInput(), impactOf(NOVA_TEST) + 0.05);

        expect(victim.health).toBeLessThan(victim.maxHealth);
        for (const enemy of enemyWorld.enemies) {
            expect(enemy.health).toBe(enemy.maxHealth);
        }
    });

    it("heals allies of the caster with an ALLIED circle, leaving the other faction alone", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.spawnPlayer(0, 0, 0);
        world.spawnEnemy(100, 0, 0, makeEnemyType(1, 2, 3, [YT_MEJKOT_HEAL_PULSE]));
        world.spawnEnemy(-100, 0, 0, makeEnemyType(1, 2, 3, [YT_MEJKOT_HEAL_PULSE]));
        const player = world.player!;
        player.health = 10;
        for (const enemy of world.enemies) {
            enemy.health = 5;
        }

        advanceSeconds(world, idleInput(), impactOf(YT_MEJKOT_HEAL_PULSE) + 0.05);

        expect(player.health).toBe(10);
        for (const enemy of world.enemies) {
            expect(enemy.health).toBe(5 + healAmount(YT_MEJKOT_HEAL_PULSE));
        }
    });
});

function bossTestEncounter(): Encounter {
    const waves = [
        {
            groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
            startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0, delaySeconds: 0 },
        },
        {
            groups: [{ enemyTypeId: EnemyTypeId.TZTOK_JAD, count: 1 }],
            startCondition: {
                maxPreviousAliveFraction: 0,
                maxElapsedSeconds: Infinity,
                delaySeconds: 0,
            },
            boss: true,
        },
    ];
    const phase = createPhase(
        createPhaseId("boss"),
        "Boss",
        waves,
        { kind: "ALL_WAVES_CLEARED" },
        [],
    );
    // Placed one tile west of the player spawn, facing east, so its approach pose lands exactly on
    // spawn (see worldObjectApproachPose) and the interaction executes on the very next tick.
    const lever = createWorldObject(
        createWorldObjectId(1),
        WorldObjectKind.LEVER,
        createWorldPosition(-TILE_SIZE, 0, 0),
        1,
    );
    const start = createInteraction(
        createInteractionId("start_boss"),
        lever.id,
        "Pull Lever",
        { kind: "START_PHASE", phaseId: phase.id },
        1,
    );
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
        waves,
        phases: [phase],
        worldObjects: [lever],
        interactions: [start],
        ambientNpcs: false,
        musicFile: "audio/test.opus",
    };
}

// stubSeqCatalog gives every sequence id STUB_FRAME_COUNT frames of STUB_TICKS_PER_FRAME
// ticks (see testLoaders.ts), so the lever's pull animation - and thus this interaction - always
// takes STUB_FRAME_SECONDS * STUB_FRAME_COUNT = 1.6s to complete regardless of its seq id.
const STUB_INTERACTION_DURATION_SECONDS = STUB_FRAME_SECONDS * STUB_FRAME_COUNT;

function startBossPhase(world: GameWorld): void {
    const interaction = world.activeInteractions[0];
    world.advance(1 / 120, {
        ...idleInput(),
        interaction: { kind: "START", interactionId: interaction.id },
    });
    advanceSeconds(world, idleInput(), STUB_INTERACTION_DURATION_SECONDS + 0.05);
}

describe("TzTok-Jad boss wave (integration)", () => {
    it("only spawns Jad once the previous wave is fully dead, then clears the encounter once Jad dies", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.startEncounter(bossTestEncounter(), 0, 0, 0);
        startBossPhase(world);

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
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.startEncounter(bossTestEncounter(), 0, 0, 0);
        startBossPhase(world);

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
