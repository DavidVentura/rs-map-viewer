import { EnergySiphonActor, createEnergySiphonActor } from "./EncounterActor";
import { Enemy } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import { HOSTILE_ENERGY_SIPHON } from "./EnergySiphon";
import {
    ATTACK_ORDER_PERSISTENCE,
    AttackOrderPersistence,
    HOLD_DRAG_DISTANCE,
    HOLD_THRESHOLD_SECONDS,
    IDLE_ORDER,
    IDLE_PLAYER_ORDERS,
    OrderEvent,
    OrderEventKind,
    OrderTargetKind,
    PlayerOrder,
    PlayerOrderKind,
    PlayerOrders,
    PointerHoldKind,
    applyOrderEvents,
    interruptsInteraction,
    promoteHeldPress,
} from "./PlayerOrders";
import { stubEncounterAnimations } from "./testLoaders";

const ANIMATIONS = stubEncounterAnimations();
const ENEMY = new Enemy(1, 0, 0, 0, 0, 0, ANIMATIONS.enemyType(EnemyTypeId.GOBLIN));
const SIPHON: EnergySiphonActor = createEnergySiphonActor(
    2,
    0,
    0,
    0,
    ANIMATIONS.enemyType(EnemyTypeId.ENERGY_SIPHON),
    0,
    HOSTILE_ENERGY_SIPHON,
    1,
);

const PRESS_ON_ENEMY: OrderEvent = {
    kind: OrderEventKind.PRESS,
    target: { kind: OrderTargetKind.ENEMY, enemy: ENEMY },
};
const RELEASE: OrderEvent = { kind: OrderEventKind.RELEASE };
const SKILL_KEY: OrderEvent = { kind: OrderEventKind.SKILL_KEY };
const MENU_ATTACK: OrderEvent = {
    kind: OrderEventKind.MENU,
    target: { kind: OrderTargetKind.ENEMY, enemy: ENEMY },
};

const CLICKED_ATTACK: PlayerOrder = {
    kind: PlayerOrderKind.ATTACK,
    target: { kind: OrderTargetKind.ENEMY, enemy: ENEMY },
    persistence: ATTACK_ORDER_PERSISTENCE,
};
const HELD_ATTACK: PlayerOrder = {
    kind: PlayerOrderKind.ATTACK,
    target: { kind: OrderTargetKind.ENEMY, enemy: ENEMY },
    persistence: AttackOrderPersistence.WHILE_HELD,
};

// Just short of the hold threshold, so these events still land inside a click.
const BEFORE_HOLD = HOLD_THRESHOLD_SECONDS - 0.01;

function pressOnGround(x: number, y: number): OrderEvent {
    return { kind: OrderEventKind.PRESS, target: { kind: OrderTargetKind.GROUND, x, y } };
}

function drag(x: number, y: number): OrderEvent {
    return { kind: OrderEventKind.DRAG, x, y };
}

function walkTo(x: number, y: number): PlayerOrder {
    return { kind: PlayerOrderKind.WALK_TO, x, y };
}

// Events of one frame, landing at `nowSeconds`; the press that starts a sequence is at time zero.
function at(orders: PlayerOrders, nowSeconds: number, ...events: OrderEvent[]): PlayerOrders {
    return applyOrderEvents(orders, events, nowSeconds);
}

function pressed(...events: OrderEvent[]): PlayerOrders {
    return at(IDLE_PLAYER_ORDERS, 0, ...events);
}

describe("clicks and holds on an enemy", () => {
    it("attacks as a click would from the very press, before it is known to be a hold", () => {
        expect(pressed(PRESS_ON_ENEMY).order).toEqual(CLICKED_ATTACK);
    });

    it("keeps the clicked attack running after a quick release", () => {
        expect(at(pressed(PRESS_ON_ENEMY), BEFORE_HOLD, RELEASE)).toEqual({
            order: CLICKED_ATTACK,
            pointer: { kind: PointerHoldKind.RELEASED },
        });
    });

    it("attacks until release once held past the threshold, and stops on release", () => {
        const held = at(pressed(PRESS_ON_ENEMY), HOLD_THRESHOLD_SECONDS);
        expect(held.order).toEqual(HELD_ATTACK);

        expect(at(held, HOLD_THRESHOLD_SECONDS + 1, RELEASE)).toEqual(IDLE_PLAYER_ORDERS);
    });

    it("counts a release exactly on the threshold as the end of a hold", () => {
        expect(at(pressed(PRESS_ON_ENEMY), HOLD_THRESHOLD_SECONDS, RELEASE)).toEqual(
            IDLE_PLAYER_ORDERS,
        );
    });

    it("re-arms the hold after the click's single attack already ended the order", () => {
        const attackedOnPress: PlayerOrders = { ...pressed(PRESS_ON_ENEMY), order: IDLE_ORDER };
        expect(promoteHeldPress(attackedOnPress, BEFORE_HOLD)).toBe(attackedOnPress);
        expect(promoteHeldPress(attackedOnPress, HOLD_THRESHOLD_SECONDS).order).toEqual(
            HELD_ATTACK,
        );
    });

    it("keeps attacking a pressed enemy while the held pointer wanders off it", () => {
        const held = at(
            pressed(PRESS_ON_ENEMY, drag(900, 900)),
            HOLD_THRESHOLD_SECONDS,
            drag(0, 0),
        );
        expect(held.order).toEqual(HELD_ATTACK);
    });

    it("swings at an energy siphon once however long it is held", () => {
        const siphonAttack: PlayerOrder = {
            kind: PlayerOrderKind.ATTACK,
            target: { kind: OrderTargetKind.ENERGY_SIPHON, siphon: SIPHON },
            persistence: ATTACK_ORDER_PERSISTENCE,
        };
        const pressedSiphon = pressed({
            kind: OrderEventKind.PRESS,
            target: { kind: OrderTargetKind.ENERGY_SIPHON, siphon: SIPHON },
        });
        const held = at(pressedSiphon, HOLD_THRESHOLD_SECONDS * 4);
        expect(held).toEqual({ order: siphonAttack, pointer: { kind: PointerHoldKind.RELEASED } });

        expect(at(held, HOLD_THRESHOLD_SECONDS * 5, RELEASE).order).toEqual(siphonAttack);
    });
});

describe("clicks and holds on the ground", () => {
    it("walks to the exact clicked point and keeps going after a quick release", () => {
        expect(at(pressed(pressOnGround(300, 200)), BEFORE_HOLD, RELEASE)).toEqual({
            order: walkTo(300, 200),
            pointer: { kind: PointerHoldKind.RELEASED },
        });
    });

    it("ignores the pointer's jitter during a click", () => {
        const jittered = at(
            pressed(pressOnGround(300, 200)),
            BEFORE_HOLD,
            drag(300 + HOLD_DRAG_DISTANCE - 1, 200),
            RELEASE,
        );
        expect(jittered.order).toEqual(walkTo(300, 200));
    });

    it("follows the pointer once held past the threshold, and stops on release", () => {
        const held = at(pressed(pressOnGround(300, 200)), HOLD_THRESHOLD_SECONDS);
        expect(held.order).toEqual(walkTo(300, 200));

        const steered = at(held, HOLD_THRESHOLD_SECONDS + 0.1, drag(310, 205), drag(500, 300));
        expect(steered.order).toEqual(walkTo(500, 300));

        const released = at(steered, HOLD_THRESHOLD_SECONDS + 0.2, RELEASE);
        expect(released).toEqual(IDLE_PLAYER_ORDERS);
        expect(at(released, HOLD_THRESHOLD_SECONDS + 0.3, drag(900, 900))).toBe(released);
    });

    it("turns a drag across the ground into a hold before the threshold", () => {
        const dragged = pressed(pressOnGround(300, 200), drag(300 + HOLD_DRAG_DISTANCE, 200));
        expect(dragged.order).toEqual(walkTo(300 + HOLD_DRAG_DISTANCE, 200));

        expect(at(dragged, 0.05, RELEASE)).toEqual(IDLE_PLAYER_ORDERS);
    });
});

describe("interruptions", () => {
    it("replaces the current order with whatever a new press or menu entry asks for", () => {
        expect(pressed(PRESS_ON_ENEMY, RELEASE, pressOnGround(10, 20)).order).toEqual(
            walkTo(10, 20),
        );
        const menuPickup: OrderEvent = {
            kind: OrderEventKind.MENU,
            target: { kind: OrderTargetKind.GROUND_ITEM, groundItemId: 7 },
        };
        expect(pressed(pressOnGround(10, 20), menuPickup, drag(500, 500))).toEqual({
            order: { kind: PlayerOrderKind.PICK_UP, groundItemId: 7 },
            pointer: { kind: PointerHoldKind.RELEASED },
        });
    });

    it("attacks once from the menu, even in the middle of a hold, and ignores its release", () => {
        const held = at(pressed(pressOnGround(10, 20)), HOLD_THRESHOLD_SECONDS);
        const menu = at(held, HOLD_THRESHOLD_SECONDS + 0.1, MENU_ATTACK);
        expect(menu).toEqual({
            order: CLICKED_ATTACK,
            pointer: { kind: PointerHoldKind.RELEASED },
        });

        expect(at(menu, HOLD_THRESHOLD_SECONDS + 0.2, drag(500, 500), RELEASE)).toEqual(menu);
    });

    it("drops a walk or an attack when a skill key is pressed, holds included", () => {
        expect(pressed(PRESS_ON_ENEMY, SKILL_KEY)).toEqual(IDLE_PLAYER_ORDERS);
        const held = at(pressed(PRESS_ON_ENEMY), HOLD_THRESHOLD_SECONDS);
        expect(at(held, HOLD_THRESHOLD_SECONDS, SKILL_KEY)).toEqual(IDLE_PLAYER_ORDERS);
        expect(pressed(pressOnGround(10, 20), SKILL_KEY, drag(500, 500))).toEqual(
            IDLE_PLAYER_ORDERS,
        );
        expect(at(pressed(pressOnGround(10, 20), SKILL_KEY), HOLD_THRESHOLD_SECONDS)).toEqual(
            IDLE_PLAYER_ORDERS,
        );
    });
});

describe("interruptsInteraction", () => {
    it("counts presses, menu entries and skill keys as fresh actions, not drags or releases", () => {
        expect(interruptsInteraction([pressOnGround(0, 0)])).toBe(true);
        expect(interruptsInteraction([SKILL_KEY])).toBe(true);
        expect(interruptsInteraction([MENU_ATTACK])).toBe(true);
        expect(interruptsInteraction([drag(1, 1), RELEASE])).toBe(false);
    });
});
