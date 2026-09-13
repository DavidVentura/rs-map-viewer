import { Enemy } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import {
    IDLE_PLAYER_ORDERS,
    OrderEvent,
    OrderEventKind,
    OrderTargetKind,
    PlayerOrderKind,
    PlayerOrders,
    PointerHold,
    applyOrderEvents,
    interruptsInteraction,
} from "./PlayerOrders";
import { stubEncounterAnimations } from "./testLoaders";

const ENEMY = new Enemy(1, 0, 0, 0, 0, 0, stubEncounterAnimations().enemyType(EnemyTypeId.GOBLIN));

const PRESS_ON_ENEMY: OrderEvent = {
    kind: OrderEventKind.PRESS,
    target: { kind: OrderTargetKind.ENEMY, enemy: ENEMY },
};
const RELEASE: OrderEvent = { kind: OrderEventKind.RELEASE };
const SKILL_KEY: OrderEvent = { kind: OrderEventKind.SKILL_KEY };

function pressOnGround(x: number, y: number): OrderEvent {
    return { kind: OrderEventKind.PRESS, target: { kind: OrderTargetKind.GROUND, x, y } };
}

function drag(x: number, y: number): OrderEvent {
    return { kind: OrderEventKind.DRAG, x, y };
}

function after(...events: OrderEvent[]): PlayerOrders {
    return applyOrderEvents(IDLE_PLAYER_ORDERS, events);
}

describe("applyOrderEvents", () => {
    it("turns a click on the ground into a walk to that exact point", () => {
        expect(after(pressOnGround(300, 200), RELEASE)).toEqual({
            order: { kind: PlayerOrderKind.WALK_TO, x: 300, y: 200 },
            pointer: PointerHold.RELEASED,
        });
    });

    it("moves the destination with the held pointer and keeps the last one after release", () => {
        const released = after(pressOnGround(300, 200), drag(400, 250), drag(500, 300), RELEASE);
        expect(released.order).toEqual({ kind: PlayerOrderKind.WALK_TO, x: 500, y: 300 });

        expect(applyOrderEvents(released, [drag(900, 900)])).toBe(released);
    });

    it("keeps attacking a pressed enemy while the held pointer wanders off it", () => {
        const orders = after(PRESS_ON_ENEMY, drag(900, 900));
        expect(orders.order).toEqual({
            kind: PlayerOrderKind.ATTACK,
            target: PRESS_ON_ENEMY.target,
        });
    });

    it("replaces the current order with whatever a new press or menu entry asks for", () => {
        expect(after(PRESS_ON_ENEMY, RELEASE, pressOnGround(10, 20)).order).toEqual({
            kind: PlayerOrderKind.WALK_TO,
            x: 10,
            y: 20,
        });
        const menuPickup: OrderEvent = {
            kind: OrderEventKind.MENU,
            target: { kind: OrderTargetKind.GROUND_ITEM, groundItemId: 7 },
        };
        expect(after(pressOnGround(10, 20), menuPickup, drag(50, 50))).toEqual({
            order: { kind: PlayerOrderKind.PICK_UP, groundItemId: 7 },
            pointer: PointerHold.RELEASED,
        });
    });

    it("drops a walk or an attack when a skill key is pressed, steering included", () => {
        expect(after(PRESS_ON_ENEMY, SKILL_KEY)).toEqual(IDLE_PLAYER_ORDERS);
        expect(after(pressOnGround(10, 20), SKILL_KEY, drag(50, 50))).toEqual(IDLE_PLAYER_ORDERS);
    });
});

describe("interruptsInteraction", () => {
    it("counts presses, menu entries and skill keys as fresh actions, not drags or releases", () => {
        expect(interruptsInteraction([pressOnGround(0, 0)])).toBe(true);
        expect(interruptsInteraction([SKILL_KEY])).toBe(true);
        expect(
            interruptsInteraction([
                {
                    kind: OrderEventKind.MENU,
                    target: { kind: OrderTargetKind.ENEMY, enemy: ENEMY },
                },
            ]),
        ).toBe(true);
        expect(interruptsInteraction([drag(1, 1), RELEASE])).toBe(false);
    });
});
