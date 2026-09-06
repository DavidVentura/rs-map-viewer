import { AbilityEffectKind, Stance } from "./Ability";
import { AbilitySlotInput, GameWorld, SimInput } from "./GameWorld";
import { Terrain } from "./Terrain";
import { BOW_SHOT, HEALING_POTION } from "./abilities";

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
        world.spawnPlayer(0, 0, 0, 1, 2, 3, 4);
        const target = { x: 500, y: 0 };

        advanceSeconds(world, holdSlot(0, target), BOW_SHOT.windupSeconds - 0.05);
        expect(world.projectiles.length).toBe(0);

        advanceSeconds(world, holdSlot(0, target), 0.1);
        expect(world.projectiles.length).toBe(1);
    });

    it("re-fires the bow on cooldown while the slot stays held", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, 1, 2, 3, 4);
        const target = { x: 500, y: 0 };

        const cooldownTotal = BOW_SHOT.windupSeconds + BOW_SHOT.locks[0].seconds;
        advanceSeconds(world, holdSlot(0, target), cooldownTotal * 2 + 0.1);
        expect(world.projectiles.length).toBe(2);
    });

    it("shares the ATTACK cooldown group between the bow and magic bolt", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, 1, 2, 3, 4);
        const target = { x: 500, y: 0 };

        advanceSeconds(world, holdSlot(0, target), BOW_SHOT.windupSeconds + 0.05);
        expect(world.projectiles.length).toBe(1);

        advanceSeconds(world, holdSlot(1, target), 0.05);
        expect(world.projectiles.length).toBe(1);
    });

    it("heals the player and locks the ATTACK group when the potion is used", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, 1, 2, 3, 4);
        const player = world.player!;
        player.health = 50;
        const healAmount =
            HEALING_POTION.effect.kind === AbilityEffectKind.HEAL
                ? HEALING_POTION.effect.amount
                : 0;

        advanceSeconds(world, holdSlot(2, { x: 0, y: 0 }), HEALING_POTION.windupSeconds + 0.05);
        expect(player.health).toBe(50 + healAmount);

        advanceSeconds(world, holdSlot(0, { x: 500, y: 0 }), 0.05);
        expect(world.projectiles.length).toBe(0);
    });

    it("channels the stance switch, blocking movement until it completes", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader);
        world.spawnPlayer(0, 0, 0, 1, 2, 3, 4);
        const player = world.player!;
        expect(player.stance).toBe(Stance.RANGED);

        advanceSeconds(world, holdSlot(3, { x: 0, y: 0 }), 0.3);
        expect(player.abilityRuntime.isChanneling(world.timeSeconds)).toBe(true);

        const movingWhileIdle: SimInput = {
            movement: { x: 1, y: 0, running: false },
            abilities: idleAbilities(),
        };

        advanceSeconds(world, movingWhileIdle, 0.5);
        expect(player.x).toBe(0);
        expect(player.stance).toBe(Stance.RANGED);

        advanceSeconds(world, movingWhileIdle, 0.5);
        expect(player.stance).toBe(Stance.MELEE);
    });
});
