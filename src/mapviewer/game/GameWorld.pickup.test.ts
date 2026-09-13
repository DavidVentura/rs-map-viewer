import { CombatEventKind } from "./CombatEvent";
import { EquipmentPath } from "./Equipment";
import { GameWorld } from "./GameWorld";
import { GroundItem } from "./GroundItem";
import { OrderEventKind, OrderTargetKind, PICKUP_RADIUS, SimInput } from "./PlayerOrders";
import { Terrain } from "./Terrain";
import { stubEncounterAnimations } from "./testLoaders";

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

const ANIMATIONS = stubEncounterAnimations();

const RUNNING_INPUT: SimInput = { orders: [], running: true, skills: [] };

function clickItem(world: GameWorld, groundItemId: number): void {
    world.advance(0, {
        ...RUNNING_INPUT,
        orders: [
            {
                kind: OrderEventKind.PRESS,
                target: { kind: OrderTargetKind.GROUND_ITEM, groundItemId },
            },
            { kind: OrderEventKind.RELEASE },
        ],
    });
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

function makeWorld(): GameWorld {
    const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
    world.spawnPlayer(0, 0, 0);
    return world;
}

function addGroundItem(world: GameWorld, overrides: Partial<GroundItem> = {}): GroundItem {
    const item: GroundItem = {
        id: 1,
        path: EquipmentPath.BOW,
        tierIndex: 1,
        x: 500,
        y: 0,
        level: 0,
        ...overrides,
    };
    world.groundItems.push(item);
    return item;
}

describe("ground item pickup", () => {
    it("walks the player toward a pending pickup target", () => {
        const world = makeWorld();
        const item = addGroundItem(world);
        const player = world.player!;
        const startDistance = Math.hypot(item.x - player.x, item.y - player.y);

        clickItem(world, item.id);
        world.advance(1 / 120, RUNNING_INPUT);

        const newDistance = Math.hypot(item.x - player.x, item.y - player.y);
        expect(newDistance).toBeLessThan(startDistance);
    });

    it("equips the item and removes it once the player is within pickup range", () => {
        const world = makeWorld();
        const item = addGroundItem(world, {
            x: 100,
            y: 0,
            path: EquipmentPath.STAFF,
            tierIndex: 2,
        });
        const player = world.player!;
        expect(player.equipment[EquipmentPath.STAFF]).toBe(0);

        clickItem(world, item.id);
        advanceSeconds(world, RUNNING_INPUT, 5);

        expect(player.equipment[EquipmentPath.STAFF]).toBe(2);
        expect(world.groundItems.length).toBe(0);
        expect(Math.hypot(item.x - player.x, item.y - player.y)).toBeLessThanOrEqual(
            PICKUP_RADIUS + 1,
        );
    });

    it("emits ITEM_PICKED_UP with the equipped path and tier once picked up", () => {
        const world = makeWorld();
        const item = addGroundItem(world, {
            x: 50,
            y: 0,
            path: EquipmentPath.AMULET,
            tierIndex: 3,
        });

        clickItem(world, item.id);
        advanceSeconds(world, RUNNING_INPUT, 5);
        const events = world.drainEvents();

        const pickedUp = events.find((event) => event.kind === CombatEventKind.ITEM_PICKED_UP);
        expect(pickedUp).toMatchObject({
            kind: CombatEventKind.ITEM_PICKED_UP,
            path: EquipmentPath.AMULET,
            tierIndex: 3,
        });
    });

    it("never moves the player and never picks up when the pickup target does not exist", () => {
        const world = makeWorld();
        const player = world.player!;
        const startX = player.x;
        const startY = player.y;

        clickItem(world, 999);
        advanceSeconds(world, RUNNING_INPUT, 1);

        expect(player.x).toBe(startX);
        expect(player.y).toBe(startY);
    });

    it("leaves the item on the ground if the player never reaches pickup range", () => {
        const world = makeWorld();
        addGroundItem(world, { x: 10000, y: 0 });

        clickItem(world, 1);
        world.advance(1 / 120, RUNNING_INPUT);

        expect(world.groundItems.length).toBe(1);
    });
});
