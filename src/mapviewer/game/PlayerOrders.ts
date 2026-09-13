import {
    AbilityTarget,
    AbilityTargetKind,
    DeliveryKind,
    ResolvedAbility,
    WeaponStyle,
    aimedCombatant,
    trackedDeliveryReach,
} from "./Ability";
import { resolveReadyCast } from "./CastResolution";
import { CombatEventKind } from "./CombatEvent";
import { computeChaseMovement } from "./Enemy";
import {
    EnergySiphonImpactKind,
    EnergySiphonImpactResult,
    resolveEnergySiphonImpact,
} from "./EnergySiphon";
import { EquipmentGrantId, createEquipmentGrant } from "./Equipment";
import { distanceToGroundItem } from "./GroundItem";
import { InteractionId } from "./Interaction";
import { Player, PlayerInput } from "./Player";
import { consumeRangedDoubleShot, resetRangedHits } from "./StanceMechanics";
import { TILE_SIZE } from "./Terrain";
import { VisualEffect, casterEffectAnchor, casterEffectTiming } from "./VisualEffect";
import { WorldContext } from "./WorldContext";
import { isWithinMeleeReach } from "./abilityRules";
import { directionToRotation } from "./projectileMath";

export type AbilitySlotInput = {
    readonly held: boolean;
    readonly target?: AbilityTarget;
};

export type CombatInput = {
    readonly basicAttack: AbilitySlotInput;
    readonly skills: readonly AbilitySlotInput[];
};

export type PickupTarget = {
    readonly groundItemId: number;
};

export type InteractionIntent =
    | { readonly kind: "START"; readonly interactionId: InteractionId }
    | { readonly kind: "CANCEL" };

export type SimInput = {
    movement: PlayerInput;
    combat: CombatInput;
    styleSwitch?: WeaponStyle;
    // Set while the player has an active pickup intent (see the renderer's click handling); the
    // world walks the player to the item using the same walk-to-target movement as the melee
    // chase, and equips it once in range. Cleared by the renderer, not the world, whenever the
    // player instead holds an attack on an enemy or plain ground movement.
    pickupTarget?: PickupTarget;
    interaction?: InteractionIntent;
    chooseUpgrade?: number;
};

// How close the player must walk to a ground item to pick it up; also the chase's stop
// distance, so the player always ends up in pickup range rather than short of it.
export const PICKUP_RADIUS = 0.5 * TILE_SIZE;

export function applyPlayerInput(
    world: WorldContext,
    player: Player,
    input: SimInput,
    dtSeconds: number,
): void {
    if (input.styleSwitch !== undefined) {
        player.requestStyleSwitch(input.styleSwitch);
    }
    processCombatInput(world, player, input.combat);
    const movement = resolveMovementInput(world, player, input);
    if (movement.x !== 0 || movement.y !== 0) {
        player.stanceMechanics = resetRangedHits(player.stanceMechanics);
    }
    player.update(movement, dtSeconds, world.timeSeconds, world.terrain);
    resolveEnergySiphonBasicAttack(world, player, input);
    resolveReadyCast(world, player);
    resolvePickup(world, player, input);
}

// Equips the targeted ground item and removes it once the player has walked within pickup
// range (see computePickupChaseInput, which drives the walk using the same reach constant).
function resolvePickup(world: WorldContext, player: Player, input: SimInput): void {
    const pickupTarget = input.pickupTarget;
    if (!pickupTarget) {
        return;
    }
    const item = world.findGroundItem(pickupTarget.groundItemId);
    if (!item || item.level !== player.level) {
        return;
    }
    if (distanceToGroundItem(item, player.x, player.y) > PICKUP_RADIUS) {
        return;
    }
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

function resolveMovementInput(world: WorldContext, player: Player, input: SimInput): PlayerInput {
    return (
        computeEnergySiphonChaseInput(world, player, input) ??
        computeMeleeChaseInput(player, input) ??
        computePickupChaseInput(world, player, input) ??
        input.movement
    );
}

function computeEnergySiphonChaseInput(
    world: WorldContext,
    player: Player,
    input: SimInput,
): PlayerInput | undefined {
    if (player.style !== WeaponStyle.MELEE) {
        return undefined;
    }
    const basicAttack = input.combat.basicAttack;
    if (!basicAttack.held || basicAttack.target?.kind !== AbilityTargetKind.ENERGY_SIPHON) {
        return undefined;
    }
    const siphon = world.findEnergySiphon(basicAttack.target.siphon.id);
    if (!siphon) {
        return undefined;
    }
    const reach = energySiphonInteractionReach(player);
    const deltaX = siphon.x - player.x;
    const deltaY = siphon.y - player.y;
    const distance = Math.hypot(deltaX, deltaY);
    const movement = computeChaseMovement(deltaX, deltaY, distance, reach);
    if (movement.x === 0 && movement.y === 0) {
        return undefined;
    }
    return { x: movement.x, y: movement.y, running: input.movement.running };
}

function resolveEnergySiphonBasicAttack(
    world: WorldContext,
    player: Player,
    input: SimInput,
): void {
    const basicAttack = input.combat.basicAttack;
    if (
        player.style !== WeaponStyle.MELEE ||
        !basicAttack.held ||
        basicAttack.target?.kind !== AbilityTargetKind.ENERGY_SIPHON
    ) {
        return;
    }
    const siphon = world.findEnergySiphon(basicAttack.target.siphon.id);
    if (!siphon) {
        return;
    }
    const distance = Math.hypot(siphon.x - player.x, siphon.y - player.y);
    if (distance > energySiphonInteractionReach(player)) {
        return;
    }
    const impact = resolveEnergySiphonImpact(siphon.siphon, {
        kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK,
        style: player.style,
    });
    if (impact.result !== EnergySiphonImpactResult.REVERSED) {
        return;
    }
    const deltaX = siphon.x - player.x;
    const deltaY = siphon.y - player.y;
    if (deltaX !== 0 || deltaY !== 0) {
        player.rotation = directionToRotation(deltaX, deltaY);
    }
    siphon.siphon = impact.siphon;
    siphon.rotation = siphon.reversedRotation;
}

function energySiphonInteractionReach(player: Player): number {
    const reach = trackedDeliveryReach(player.basicAttack.effect.delivery);
    if (reach === undefined) {
        throw new Error("Melee basic attack must have a tracked reach");
    }
    return reach + player.hitRadius;
}

// Walks the player toward a pending pickup target using the same walk-to-target chase as
// computeMeleeChaseInput, stopping once within PICKUP_RADIUS (resolvePickup then equips the
// item on the same tick it stops).
function computePickupChaseInput(
    world: WorldContext,
    player: Player,
    input: SimInput,
): PlayerInput | undefined {
    const pickupTarget = input.pickupTarget;
    if (!pickupTarget) {
        return undefined;
    }
    const item = world.findGroundItem(pickupTarget.groundItemId);
    if (!item || item.level !== player.level) {
        return undefined;
    }
    const deltaX = item.x - player.x;
    const deltaY = item.y - player.y;
    const distance = Math.hypot(deltaX, deltaY);
    const movement = computeChaseMovement(deltaX, deltaY, distance, PICKUP_RADIUS);
    if (movement.x === 0 && movement.y === 0) {
        return undefined;
    }
    return { x: movement.x, y: movement.y, running: input.movement.running };
}

function computeMeleeChaseInput(player: Player, input: SimInput): PlayerInput | undefined {
    if (player.style !== WeaponStyle.MELEE) {
        return undefined;
    }
    const basicAttackInput = input.combat.basicAttack;
    if (!basicAttackInput.held || !basicAttackInput.target) {
        return undefined;
    }
    const enemy = aimedCombatant(basicAttackInput.target, player.level);
    if (!enemy) {
        return undefined;
    }
    const attack = player.basicAttack;
    const deliveryReach = trackedDeliveryReach(attack.effect.delivery);
    if (deliveryReach === undefined) {
        return undefined;
    }
    const deltaX = enemy.x - player.x;
    const deltaY = enemy.y - player.y;
    const distance = Math.hypot(deltaX, deltaY);
    const reach = deliveryReach + player.hitRadius + enemy.hitRadius;
    if (distance <= reach) {
        return undefined;
    }
    const movement = computeChaseMovement(deltaX, deltaY, distance, reach);
    if (movement.x === 0 && movement.y === 0) {
        return undefined;
    }
    return { x: movement.x, y: movement.y, running: input.movement.running };
}

function processCombatInput(world: WorldContext, player: Player, combat: CombatInput): void {
    tryBeginBasicAttack(world, player, combat.basicAttack);
    const skillCount = Math.min(combat.skills.length, player.skills.length);
    for (let skillSlot = 0; skillSlot < skillCount; skillSlot++) {
        tryBeginCast(
            world,
            player,
            player.skills[skillSlot],
            combat.skills[skillSlot],
            player.canUseSkillIgnoringTarget(skillSlot, world.timeSeconds),
        );
    }
}

function tryBeginBasicAttack(
    world: WorldContext,
    player: Player,
    abilityInput: AbilitySlotInput,
): void {
    const basicAttack = player.basicAttack;
    if (!abilityInput.held || !abilityInput.target) {
        return;
    }
    if (abilityInput.target.kind === AbilityTargetKind.ENERGY_SIPHON) {
        return;
    }
    if (
        !player.canUseBasicAttackIgnoringTarget(world.timeSeconds) ||
        !canUseAbility(player, basicAttack, abilityInput.target)
    ) {
        return;
    }
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
            abilityInput.target,
        );
        return;
    }
    beginPlayerCast(world, player, basicAttack, abilityInput.target);
}

function tryBeginCast(
    world: WorldContext,
    player: Player,
    ability: ResolvedAbility,
    abilityInput: AbilitySlotInput,
    canUse: boolean,
): void {
    if (!abilityInput.held || !abilityInput.target) {
        return;
    }
    if (abilityInput.target.kind === AbilityTargetKind.ENERGY_SIPHON) {
        return;
    }
    if (!canUse || !canUseAbility(player, ability, abilityInput.target)) {
        return;
    }
    beginPlayerCast(world, player, ability, abilityInput.target);
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

function canUseAbility(player: Player, ability: ResolvedAbility, target: AbilityTarget): boolean {
    if (target.kind === AbilityTargetKind.ENERGY_SIPHON) {
        return false;
    }
    const reach = trackedDeliveryReach(ability.effect.delivery);
    if (reach === undefined) {
        return true;
    }
    const enemy = aimedCombatant(target, player.level);
    if (!enemy) {
        return false;
    }
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    return isWithinMeleeReach(distance, reach, player.hitRadius, enemy.hitRadius);
}
