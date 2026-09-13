import { AbilityTargetKind, WeaponStyle } from "./Ability";
import { CombatEventKind } from "./CombatEvent";
import { DropTier, EnemyBehaviour, EnemyType, EnemyTypeId, resolveEnemyType } from "./EnemyType";
import { EnergySiphonState } from "./EnergySiphon";
import { GameWorld, SimInput } from "./GameWorld";
import { createExperience } from "./Progression";
import { Terrain } from "./Terrain";
import { WARDEN_P3_SOLO_SIPHON_LAYOUT } from "./WardenP3Arena";
import { WardenP3Arena, WardenSiphonStatus } from "./WardenP3Director";
import { GOBLIN_MELEE } from "./abilities";
import { stubEncounterAnimations, stubSeqCatalog } from "./testLoaders";

class FlatTerrain implements Terrain {
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

const EMPTY_INPUT: SimInput = {
    movement: { x: 0, y: 0, running: false },
    combat: { basicAttack: { held: false }, skills: [] },
};

function attackSiphon(siphon: NonNullable<ReturnType<GameWorld["findEnergySiphon"]>>): SimInput {
    return {
        movement: { x: 0, y: 0, running: false },
        combat: {
            basicAttack: {
                held: true,
                target: { kind: AbilityTargetKind.ENERGY_SIPHON, siphon },
            },
            skills: [],
        },
    };
}

const WARDEN_TYPE: EnemyType = {
    id: EnemyTypeId.GOBLIN,
    npcTypeId: 0,
    idleSeqId: 0,
    walkSeqId: 0,
    deathSeqId: 0,
    attackSeqId: 0,
    hitRadius: 64,
    projectileLaunchHeight: 0,
    maxHealth: 100,
    experienceReward: createExperience(0),
    walkSpeed: 0,
    behaviour: EnemyBehaviour.RUSHER,
    abilities: [GOBLIN_MELEE],
    dropTier: DropTier.NONE,
};

const ARENA: WardenP3Arena = { furthestRowFromWarden: 5 };

function createWardenWorld(): { readonly world: GameWorld; readonly wardenId: number } {
    const world = new GameWorld(new FlatTerrain(), stubEncounterAnimations());
    world.spawnPlayer(0, 0, 0);
    const wardenId = world.spawnEnemy(128, 0, 0, resolveEnemyType(WARDEN_TYPE, stubSeqCatalog()));
    world.startWardenP3Runtime(wardenId, ARENA, WARDEN_P3_SOLO_SIPHON_LAYOUT);
    return { world, wardenId };
}

describe("Wardens P3 world runtime", () => {
    it("makes the Warden invulnerable for siphons and exposes the director commands to rendering", () => {
        const { world, wardenId } = createWardenWorld();
        const warden = world.findEnemy(wardenId)!;
        warden.health = 80;

        world.step(EMPTY_INPUT, 0.01);

        expect(warden.invulnerable).toBe(true);
        expect(world.wardenP3RenderState).toMatchObject({
            activeIntermission: 0,
            commands: [
                { kind: "SET_WARDEN_VULNERABILITY", vulnerable: false },
                { kind: "SPAWN_ENERGY_SIPHONS", intermission: 0 },
            ],
        });

        world.resolveWardenP3Siphons(WardenSiphonStatus.ALL_REVERSED);
        world.step(EMPTY_INPUT, 0.01);

        expect(warden.invulnerable).toBe(false);
        expect(world.wardenP3RenderState).toMatchObject({
            activeIntermission: undefined,
            commands: [
                {
                    kind: "RESOLVE_ENERGY_SIPHONS",
                    intermission: 0,
                    status: WardenSiphonStatus.ALL_REVERSED,
                    wardenDamage: 5,
                },
                { kind: "SET_WARDEN_VULNERABILITY", vulnerable: true },
            ],
        });
    });

    it("emits encounter completion when the Warden dies", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 0;

        world.step(EMPTY_INPUT, 0.01);

        expect(world.drainEvents()).toContainEqual({ kind: CombatEventKind.ENCOUNTER_CLEARED });
    });

    it("damages the attacked floor while leaving the indicated safe side untouched", () => {
        const { world } = createWardenWorld();
        world.player!.x = (3940 + 0.5) * 128;
        world.player!.y = (5160 + 0.5) * 128;
        const startingHealth = world.player!.health;

        world.step(EMPTY_INPUT, 0.01);
        world.step(EMPTY_INPUT, 1.8);
        expect(world.player!.health).toBe(startingHealth);
        world.step(EMPTY_INPUT, 0.67);
        expect(world.player!.health).toBe(startingHealth - 30);

        const safeWorld = createWardenWorld().world;
        safeWorld.player!.x = (3930 + 0.5) * 128;
        safeWorld.player!.y = (5160 + 0.5) * 128;
        const safeHealth = safeWorld.player!.health;
        safeWorld.step(EMPTY_INPUT, 0.01);
        safeWorld.step(EMPTY_INPUT, 1.8);
        safeWorld.step(EMPTY_INPUT, 0.67);
        expect(safeWorld.player!.health).toBe(safeHealth);
    });

    it("spawns mechanic-only siphons and resolves their intermission after basic melee reverses each", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        world.step(EMPTY_INPUT, 0.01);

        expect(world.energySiphons).toHaveLength(4);
        world.player!.style = WeaponStyle.MELEE;
        for (let index = 0; index < world.energySiphons.length - 1; index++) {
            const siphon = world.energySiphons[index];
            world.player!.x = siphon.x;
            world.player!.y = siphon.y;
            world.step(attackSiphon(siphon), 0.01);
            expect(world.findEnergySiphon(siphon.id)?.state).toBe(EnergySiphonState.REVERSED);
        }

        const finalSiphon = world.energySiphons.at(-1)!;
        world.player!.x = finalSiphon.x;
        world.player!.y = finalSiphon.y;
        world.step(attackSiphon(finalSiphon), 0.01);

        expect(world.energySiphons).toEqual([]);
        expect(world.wardenP3RenderState?.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.ALL_REVERSED,
            wardenDamage: 5,
        });
    });

    it("resolves a siphon intermission when its authored deadline expires", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        world.step(EMPTY_INPUT, 0.01);

        world.step(EMPTY_INPUT, WARDEN_P3_SOLO_SIPHON_LAYOUT.deadlineSeconds);

        expect(world.energySiphons).toEqual([]);
        expect(world.wardenP3RenderState?.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.DEADLINE_EXPIRED,
            wardenDamage: 0,
        });
    });
});
