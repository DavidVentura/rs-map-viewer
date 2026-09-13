import {
    AbilityTarget,
    AbilityTargetKind,
    DeliveryKind,
    ResolvedAbility,
    WeaponStyle,
    abilityRange,
    aimAtCombatant,
    liveAbilityTarget,
    trackedDeliveryReach,
} from "./Ability";
import { resolveReadyCast } from "./CastResolution";
import { CombatEventKind } from "./CombatEvent";
import { EnergySiphonActor } from "./EncounterActor";
import { Enemy } from "./Enemy";
import { EnergySiphonImpactKind, canTargetEnergySiphon } from "./EnergySiphon";
import { EquipmentGrantId, createEquipmentGrant } from "./Equipment";
import { GroundItem, distanceToGroundItem } from "./GroundItem";
import { InteractionId } from "./Interaction";
import {
    ARRIVAL_TOLERANCE,
    MovementOutcome,
    Player,
    PlayerMovement,
    PlayerMovementKind,
    STAND_STILL,
} from "./Player";
import { consumeRangedDoubleShot, resetRangedHits } from "./StanceMechanics";
import { TILE_SIZE } from "./Terrain";
import { VisualEffect, casterEffectAnchor, casterEffectTiming } from "./VisualEffect";
import { WorldContext } from "./WorldContext";
import { isWithinMeleeReach } from "./abilityRules";

export enum OrderTargetKind {
    GROUND = 0,
    ENEMY = 1,
    ENERGY_SIPHON = 2,
    GROUND_ITEM = 3,
}

// What a left press or a right-click menu entry landed on, as the renderer resolved it.
export type OrderTarget =
    | { readonly kind: OrderTargetKind.GROUND; readonly x: number; readonly y: number }
    | { readonly kind: OrderTargetKind.ENEMY; readonly enemy: Enemy }
    | { readonly kind: OrderTargetKind.ENERGY_SIPHON; readonly siphon: EnergySiphonActor }
    | { readonly kind: OrderTargetKind.GROUND_ITEM; readonly groundItemId: number };

export type AttackTarget = Extract<
    OrderTarget,
    { readonly kind: OrderTargetKind.ENEMY | OrderTargetKind.ENERGY_SIPHON }
>;

// The menu has no "Walk here" entry, so it only ever orders an attack or a pickup.
export type MenuOrderTarget = Exclude<OrderTarget, { readonly kind: OrderTargetKind.GROUND }>;

export enum PlayerOrderKind {
    IDLE = 0,
    WALK_TO = 1,
    ATTACK = 2,
    PICK_UP = 3,
}

// What the player keeps doing without further input, OSRS style: walking to a clicked point,
// chasing a target into range and attacking it until it dies (or, for an energy siphon, until
// it is reversed), or walking to a ground item and picking it up.
export type PlayerOrder =
    | { readonly kind: PlayerOrderKind.IDLE }
    | { readonly kind: PlayerOrderKind.WALK_TO; readonly x: number; readonly y: number }
    | { readonly kind: PlayerOrderKind.ATTACK; readonly target: AttackTarget }
    | { readonly kind: PlayerOrderKind.PICK_UP; readonly groundItemId: number };

export const IDLE_ORDER: PlayerOrder = { kind: PlayerOrderKind.IDLE };

// STEERING: the left button has stayed down since a press on the ground, so the walk destination
// follows the pointer until it is released.
export enum PointerHold {
    RELEASED = 0,
    STEERING = 1,
}

export type PlayerOrders = {
    readonly order: PlayerOrder;
    readonly pointer: PointerHold;
};

export const IDLE_PLAYER_ORDERS: PlayerOrders = {
    order: IDLE_ORDER,
    pointer: PointerHold.RELEASED,
};

export enum OrderEventKind {
    PRESS = 0,
    DRAG = 1,
    RELEASE = 2,
    MENU = 3,
    SKILL_KEY = 4,
}

export type OrderEvent =
    | { readonly kind: OrderEventKind.PRESS; readonly target: OrderTarget }
    // The held pointer now sits over this ground point.
    | { readonly kind: OrderEventKind.DRAG; readonly x: number; readonly y: number }
    | { readonly kind: OrderEventKind.RELEASE }
    | { readonly kind: OrderEventKind.MENU; readonly target: MenuOrderTarget }
    | { readonly kind: OrderEventKind.SKILL_KEY };

// Anything but an energy siphon, which only a basic attack can strike (see EnergySiphon.ts).
export type SkillTarget = Exclude<
    AbilityTarget,
    { readonly kind: AbilityTargetKind.ENERGY_SIPHON }
>;

export type SkillInput =
    | { readonly held: false }
    | { readonly held: true; readonly target: SkillTarget };

export type SimInput = {
    // Everything that happened to the pointer and the skill keys since the last frame, applied to
    // the player's orders once however many fixed steps the frame runs (see GameWorld.advance).
    readonly orders: readonly OrderEvent[];
    readonly running: boolean;
    readonly skills: readonly SkillInput[];
    readonly styleSwitch?: WeaponStyle;
    readonly startInteraction?: InteractionId;
    readonly chooseUpgrade?: number;
};

// How close the player must walk to a ground item to pick it up; also the walk's stop distance, so
// the player always ends up in pickup range rather than short of it.
export const PICKUP_RADIUS = 0.5 * TILE_SIZE;

function orderFor(target: OrderTarget): PlayerOrder {
    switch (target.kind) {
        case OrderTargetKind.GROUND:
            return { kind: PlayerOrderKind.WALK_TO, x: target.x, y: target.y };
        case OrderTargetKind.ENEMY:
        case OrderTargetKind.ENERGY_SIPHON:
            return { kind: PlayerOrderKind.ATTACK, target };
        case OrderTargetKind.GROUND_ITEM:
            return { kind: PlayerOrderKind.PICK_UP, groundItemId: target.groundItemId };
    }
}

// A press replaces whatever the player was doing; one on the ground also starts steering, so while
// the button stays down every drag moves the destination and letting go keeps the last one. A skill
// key drops the order outright.
export function applyOrderEvent(orders: PlayerOrders, event: OrderEvent): PlayerOrders {
    switch (event.kind) {
        case OrderEventKind.PRESS:
            return {
                order: orderFor(event.target),
                pointer:
                    event.target.kind === OrderTargetKind.GROUND
                        ? PointerHold.STEERING
                        : PointerHold.RELEASED,
            };
        case OrderEventKind.DRAG:
            if (orders.pointer !== PointerHold.STEERING) {
                return orders;
            }
            return {
                order: { kind: PlayerOrderKind.WALK_TO, x: event.x, y: event.y },
                pointer: PointerHold.STEERING,
            };
        case OrderEventKind.RELEASE:
            return { order: orders.order, pointer: PointerHold.RELEASED };
        case OrderEventKind.MENU:
            return { order: orderFor(event.target), pointer: PointerHold.RELEASED };
        case OrderEventKind.SKILL_KEY:
            return IDLE_PLAYER_ORDERS;
    }
}

export function applyOrderEvents(
    orders: PlayerOrders,
    events: readonly OrderEvent[],
): PlayerOrders {
    return events.reduce(applyOrderEvent, orders);
}

// A fresh action - a press, a menu entry, a skill key - also walks the player away from a lever or
// chest they were operating; a drag or a release only continues what a press started.
export function interruptsInteraction(events: readonly OrderEvent[]): boolean {
    return events.some(
        (event) =>
            event.kind === OrderEventKind.PRESS ||
            event.kind === OrderEventKind.MENU ||
            event.kind === OrderEventKind.SKILL_KEY,
    );
}

// One fixed step of the player acting on its order and held skills; returns the order to carry
// into the next step (IDLE once it is done).
export function stepPlayer(
    world: WorldContext,
    player: Player,
    order: PlayerOrder,
    input: SimInput,
    dtSeconds: number,
): PlayerOrder {
    if (input.styleSwitch !== undefined) {
        player.requestStyleSwitch(input.styleSwitch);
    }
    const current = liveOrder(world, player, order);
    beginHeldSkills(world, player, input.skills);
    beginOrderedAttack(world, player, current);
    const outcome = player.update(
        orderMovement(world, player, current, input.running),
        dtSeconds,
        world.timeSeconds,
        world.terrain,
    );
    if (outcome === MovementOutcome.MOVED) {
        player.stanceMechanics = resetRangedHits(player.stanceMechanics);
    }
    resolveReadyCast(world, player);
    return liveOrder(world, player, settleOrder(world, player, current, outcome));
}

// An order is over once its target has died, left the player's level or the world, or can no
// longer be struck by the player's basic attack (a reversed siphon, or a non-melee style for one).
function liveOrder(world: WorldContext, player: Player, order: PlayerOrder): PlayerOrder {
    switch (order.kind) {
        case PlayerOrderKind.IDLE:
        case PlayerOrderKind.WALK_TO:
            return order;
        case PlayerOrderKind.ATTACK:
            return isAttackable(world, player, order.target) ? order : IDLE_ORDER;
        case PlayerOrderKind.PICK_UP: {
            const item = world.findGroundItem(order.groundItemId);
            return item && item.level === player.level ? order : IDLE_ORDER;
        }
    }
}

function isAttackable(world: WorldContext, player: Player, target: AttackTarget): boolean {
    switch (target.kind) {
        case OrderTargetKind.ENEMY: {
            const enemy = target.enemy;
            return (
                world.findEnemy(enemy.id) === enemy &&
                enemy.health > 0 &&
                enemy.level === player.level
            );
        }
        case OrderTargetKind.ENERGY_SIPHON: {
            const siphon = target.siphon;
            return (
                world.findEnergySiphon(siphon.id) === siphon &&
                siphon.level === player.level &&
                canTargetEnergySiphon(siphon.siphon, {
                    kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK,
                    style: player.style,
                })
            );
        }
    }
}

type TargetBody = { readonly x: number; readonly y: number; readonly hitRadius: number };

function attackTargetBody(target: AttackTarget): TargetBody {
    switch (target.kind) {
        case OrderTargetKind.ENEMY:
            return target.enemy;
        case OrderTargetKind.ENERGY_SIPHON:
            return {
                x: target.siphon.x,
                y: target.siphon.y,
                hitRadius: target.siphon.type.hitRadius,
            };
    }
}

function orderMovement(
    world: WorldContext,
    player: Player,
    order: PlayerOrder,
    running: boolean,
): PlayerMovement {
    switch (order.kind) {
        case PlayerOrderKind.IDLE:
            return STAND_STILL;
        case PlayerOrderKind.WALK_TO:
            return {
                kind: PlayerMovementKind.APPROACH,
                x: order.x,
                y: order.y,
                stopDistance: 0,
                running,
            };
        case PlayerOrderKind.ATTACK: {
            const body = attackTargetBody(order.target);
            return {
                kind: PlayerMovementKind.APPROACH,
                x: body.x,
                y: body.y,
                stopDistance: abilityRange(player.basicAttack, player.hitRadius, body.hitRadius),
                running,
            };
        }
        case PlayerOrderKind.PICK_UP: {
            const item = orderedGroundItem(world, order.groundItemId);
            return {
                kind: PlayerMovementKind.APPROACH,
                x: item.x,
                y: item.y,
                stopDistance: PICKUP_RADIUS,
                running,
            };
        }
    }
}

// Only called for an order liveOrder has just kept, so the item is still on the ground.
function orderedGroundItem(world: WorldContext, groundItemId: number): GroundItem {
    const item = world.findGroundItem(groundItemId);
    if (!item) {
        throw new Error(`Ground item ${groundItemId} vanished under a live pickup order`);
    }
    return item;
}

// A walk ends on its point, or where a wall stops it; a pickup ends once the item is in reach,
// or where a wall keeps it out of reach.
function settleOrder(
    world: WorldContext,
    player: Player,
    order: PlayerOrder,
    outcome: MovementOutcome,
): PlayerOrder {
    switch (order.kind) {
        case PlayerOrderKind.IDLE:
        case PlayerOrderKind.ATTACK:
            return order;
        case PlayerOrderKind.WALK_TO: {
            const remaining = Math.hypot(order.x - player.x, order.y - player.y);
            if (outcome === MovementOutcome.BLOCKED || remaining <= ARRIVAL_TOLERANCE) {
                return IDLE_ORDER;
            }
            return order;
        }
        case PlayerOrderKind.PICK_UP: {
            const item = orderedGroundItem(world, order.groundItemId);
            if (distanceToGroundItem(item, player.x, player.y) <= PICKUP_RADIUS) {
                pickUp(world, player, item);
                return IDLE_ORDER;
            }
            return outcome === MovementOutcome.BLOCKED ? IDLE_ORDER : order;
        }
    }
}

function pickUp(world: WorldContext, player: Player, item: GroundItem): void {
    player.equipGrant(
        createEquipmentGrant(EquipmentGrantId.INDIVIDUAL, "Equipment upgrade", [
            { path: item.path, tierIndex: item.tierIndex },
        ]),
    );
    world.groundItems = world.groundItems.filter((existing) => existing.id !== item.id);
    world.events.push({
        kind: CombatEventKind.ITEM_PICKED_UP,
        path: item.path,
        tierIndex: item.tierIndex,
    });
}

// Swings (or shoots) as soon as the target is within the basic attack's range and the attack is
// off cooldown; orderMovement closes the distance until then.
function beginOrderedAttack(world: WorldContext, player: Player, order: PlayerOrder): void {
    if (order.kind !== PlayerOrderKind.ATTACK) {
        return;
    }
    if (!player.canUseBasicAttackIgnoringTarget(world.timeSeconds)) {
        return;
    }
    const basicAttack = player.basicAttack;
    const body = attackTargetBody(order.target);
    const distance = Math.hypot(body.x - player.x, body.y - player.y);
    if (distance > abilityRange(basicAttack, player.hitRadius, body.hitRadius)) {
        return;
    }
    const aim: AbilityTarget =
        order.target.kind === OrderTargetKind.ENEMY
            ? aimAtCombatant(basicAttack.effect.delivery, order.target.enemy)
            : { kind: AbilityTargetKind.ENERGY_SIPHON, siphon: order.target.siphon };
    if (
        player.style === WeaponStyle.RANGED &&
        basicAttack.effect.delivery.kind === DeliveryKind.PROJECTILE
    ) {
        const consumed = consumeRangedDoubleShot(player.stanceMechanics);
        player.stanceMechanics = consumed.state;
        const delivery = consumed.firesDouble
            ? { ...basicAttack.effect.delivery, count: 2 }
            : basicAttack.effect.delivery;
        beginPlayerCast(
            world,
            player,
            { ...basicAttack, effect: { ...basicAttack.effect, delivery } },
            aim,
        );
        return;
    }
    beginPlayerCast(world, player, basicAttack, aim);
}

function beginHeldSkills(world: WorldContext, player: Player, skills: readonly SkillInput[]): void {
    const skillCount = Math.min(skills.length, player.skills.length);
    for (let skillSlot = 0; skillSlot < skillCount; skillSlot++) {
        const skillInput = skills[skillSlot];
        if (!skillInput.held) {
            continue;
        }
        const skill = player.skills[skillSlot];
        if (
            !player.canUseSkillIgnoringTarget(skillSlot, world.timeSeconds) ||
            !canUseSkill(player, skill, skillInput.target)
        ) {
            continue;
        }
        beginPlayerCast(world, player, skill, skillInput.target);
    }
}

// The one path a player's cast begins through, whichever slot triggered it: starts the cast
// itself, then - if the ability has one - its caster-anchored graphic (a weapon-special trail,
// a launch flash at the bow/staff), so that graphic starts with the swing and keeps pace with
// it at the ability's own castSpeed, rather than lagging to the point of impact at natural
// speed (see AbilityEffect.casterEffect).
function beginPlayerCast(
    world: WorldContext,
    player: Player,
    ability: ResolvedAbility,
    target: AbilityTarget,
): void {
    player.beginCast(ability, target, world.timeSeconds);
    const casterEffect = ability.effect.casterEffect;
    if (casterEffect) {
        world.pushVisualEffect(
            new VisualEffect(
                casterEffect.kind,
                casterEffectAnchor(player, casterEffect.placement),
                casterEffect.height,
                casterEffectTiming(world.animations.effects[casterEffect.kind], ability.castSeq),
                undefined,
                ability.castSpeed,
            ),
        );
    }
}

// A held skill never walks the player anywhere: one with a melee reach only goes off at a
// combatant already inside it.
function canUseSkill(player: Player, skill: ResolvedAbility, target: SkillTarget): boolean {
    const reach = trackedDeliveryReach(skill.effect.delivery);
    if (reach === undefined) {
        return true;
    }
    const aim = liveAbilityTarget(target, player.level);
    if (aim.kind !== AbilityTargetKind.COMBATANT) {
        return false;
    }
    const enemy = aim.combatant;
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    return isWithinMeleeReach(distance, reach, player.hitRadius, enemy.hitRadius);
}
