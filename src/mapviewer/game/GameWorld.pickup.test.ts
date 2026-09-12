import { WeaponStyle } from "./Ability";
import { CombatEventKind } from "./CombatEvent";
import { EquipmentGrantId, EquipmentPath, createEquipmentGrant, styleSetGrant } from "./Equipment";
import { GameWorld, SimInput } from "./GameWorld";
import { GroundItem } from "./GroundItem";
import { StanceSeqIdsByStance } from "./Player";
import { Terrain } from "./Terrain";
import { stubSequenceLoaders } from "./testLoaders";

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

const { seqTypeLoader, seqFrameLoader } = stubSequenceLoaders();

const STYLE_SEQ_IDS: StanceSeqIdsByStance = {
    [WeaponStyle.RANGED]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 426 },
    [WeaponStyle.MAGIC]: { idleSeqId: 813, walkSeqId: 1146, runSeqId: 1210, attackSeqId: 711 },
    [WeaponStyle.MELEE]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 390 },
};

function pickupInput(groundItemId: number): SimInput {
    return {
        movement: { x: 0, y: 0, running: true },
        combat: { basicAttack: { held: false }, skills: [] },
        pickupTarget: { groundItemId },
    };
}

function idleInput(): SimInput {
    return {
        movement: { x: 0, y: 0, running: false },
        combat: { basicAttack: { held: false }, skills: [] },
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

function makeWorld(): GameWorld {
    const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
    world.spawnPlayer(0, 0, 0, STYLE_SEQ_IDS);
    return world;
}

function addGroundItem(world: GameWorld, overrides: Partial<GroundItem> = {}): GroundItem {
    const item: GroundItem = {
        id: 1,
        grant: createEquipmentGrant(EquipmentGrantId.INDIVIDUAL, "Bow", [
            { path: EquipmentPath.BOW, tierIndex: 1 },
        ]),
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

        world.advance(1 / 120, pickupInput(item.id));

        const newDistance = Math.hypot(item.x - player.x, item.y - player.y);
        expect(newDistance).toBeLessThan(startDistance);
    });

    it("equips the item and removes it once the player is within pickup range", () => {
        const world = makeWorld();
        const item = addGroundItem(world, {
            x: 100,
            y: 0,
            grant: createEquipmentGrant(EquipmentGrantId.INDIVIDUAL, "Staff", [
                { path: EquipmentPath.STAFF, tierIndex: 2 },
            ]),
        });
        const player = world.player!;
        expect(player.equipment[EquipmentPath.STAFF]).toBe(0);

        advanceSeconds(world, pickupInput(item.id), 5);

        expect(player.equipment[EquipmentPath.STAFF]).toBe(2);
        expect(world.groundItems.length).toBe(0);
        expect(Math.hypot(item.x - player.x, item.y - player.y)).toBeLessThanOrEqual(
            GameWorld.PICKUP_RADIUS + 1,
        );
    });

    it("emits ITEM_PICKED_UP with the equipped path and tier once picked up", () => {
        const world = makeWorld();
        const item = addGroundItem(world, {
            x: 50,
            y: 0,
            grant: createEquipmentGrant(EquipmentGrantId.INDIVIDUAL, "Amulet", [
                { path: EquipmentPath.AMULET, tierIndex: 3 },
            ]),
        });

        advanceSeconds(world, pickupInput(item.id), 5);
        const events = world.drainEvents();

        const pickedUp = events.find((event) => event.kind === CombatEventKind.ITEM_PICKED_UP);
        expect(pickedUp).toMatchObject({
            kind: CombatEventKind.ITEM_PICKED_UP,
            grant: expect.objectContaining({
                changes: [{ path: EquipmentPath.AMULET, tierIndex: 3 }],
            }),
        });
    });

    it("never moves the player and never picks up when the pickup target does not exist", () => {
        const world = makeWorld();
        const player = world.player!;
        const startX = player.x;
        const startY = player.y;

        advanceSeconds(world, pickupInput(999), 1);

        expect(player.x).toBe(startX);
        expect(player.y).toBe(startY);
    });

    it("leaves the item on the ground if the player never reaches pickup range", () => {
        const world = makeWorld();
        addGroundItem(world, { x: 10000, y: 0 });

        world.advance(1 / 120, pickupInput(1));

        expect(world.groundItems.length).toBe(1);
    });
});

describe("equipment set pickup", () => {
    it("keeps floor grants until pickup and applies a complete set atomically", () => {
        const world = makeWorld();
        const item = addGroundItem(world, { x: 50, grant: styleSetGrant(WeaponStyle.MELEE, 2) });

        advanceSeconds(world, idleInput(), 120);
        expect(world.groundItems.length).toBe(1);

        advanceSeconds(world, pickupInput(item.id), 1);
        expect(world.groundItems.length).toBe(0);
        expect(world.player!.equipment[EquipmentPath.SCIMITAR]).toBe(2);
        expect(world.player!.equipment[EquipmentPath.DEFENDER]).toBe(2);
    });
});
