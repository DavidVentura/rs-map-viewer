import {
    AbilityEffect,
    AbilityTarget,
    AbilityTargetKind,
    ConeDelivery,
    DeliveryKind,
    ProjectileDelivery,
    ResolvedAbility,
    WeaponStyle,
    abilityTargetPoint,
    liveAbilityTarget,
    trackedDeliveryReach,
} from "./Ability";
import { Combatant } from "./Combatant";
import { applyPayloads, hitEffectHoldSeconds } from "./Effect";
import { affectedCombatants, coneTileSpawns } from "./EffectResolution";
import { EnergySiphonActor } from "./EncounterActor";
import { Enemy } from "./Enemy";
import {
    EnergySiphonImpact,
    EnergySiphonImpactKind,
    EnergySiphonImpactResult,
    resolveEnergySiphonImpact,
} from "./EnergySiphon";
import { Player } from "./Player";
import { ProjectileImpact, ProjectileLanding, ProjectileTarget, travelSeconds } from "./Projectile";
import { MAGIC_MANA_REFUND_PER_ENEMY } from "./StanceMechanics";
import { WorldContext } from "./WorldContext";
import { isWithinMeleeReach } from "./abilityRules";
import {
    FlightOrigin,
    directionToRotation,
    generateSpreadDirections,
    rotationToDirection,
} from "./projectileMath";

const PROJECTILE_LAUNCH_OFFSET = 48;

export function resolveReadyCast(world: WorldContext, caster: Player | Enemy): void {
    const cast = caster.abilityRuntime.takeReadyCast(world.timeSeconds);
    if (!cast) {
        return;
    }
    resolveEffect(world, caster, cast.definition, cast.target);
}

// The one resolution path for every cast, player or enemy: the delivery picks who is affected
// (or spawns projectiles, picked later on arrival), the payloads land on each of them, and the
// hit graphic is anchored per combatant for combatant deliveries or at the landing point for
// point deliveries (see AbilityEffect.hitEffect). casterEffect is not spawned here - it starts
// with the cast itself (see PlayerOrders' beginPlayerCast) so it plays in step with the swing
// rather than lagging behind to the point of impact.
function resolveEffect(
    world: WorldContext,
    caster: Combatant,
    ability: ResolvedAbility,
    target: AbilityTarget,
): void {
    const effect = ability.effect;
    if (target.kind === AbilityTargetKind.ENERGY_SIPHON) {
        strikeEnergySiphon(world, caster, ability, target.siphon);
    }
    const aim = liveAbilityTarget(target, caster.level);
    const delivery = effect.delivery;
    switch (delivery.kind) {
        case DeliveryKind.PROJECTILE:
            spawnProjectiles(world, caster, ability, delivery, aim);
            return;
        case DeliveryKind.CONE:
            landCone(world, caster, effect, delivery, aim);
            return;
        case DeliveryKind.TARGET:
        case DeliveryKind.CIRCLE: {
            const hits = affectedCombatants(
                caster,
                delivery,
                effect.affects,
                aim,
                world.combatants(),
            );
            for (const hit of hits) {
                landOnCombatant(world, hit, effect);
            }
            if (caster instanceof Player && caster.style === WeaponStyle.MAGIC) {
                caster.refundMana(hits.length * MAGIC_MANA_REFUND_PER_ENEMY);
            }
            return;
        }
    }
}

// A siphon is no combatant, so the swing's own delivery passes it by; it takes the hit here, on the
// same contact frame, and EnergySiphon.ts decides whether that hit reverses it.
function strikeEnergySiphon(
    world: WorldContext,
    caster: Combatant,
    ability: ResolvedAbility,
    aimed: EnergySiphonActor,
): void {
    if (!(caster instanceof Player)) {
        throw new Error(`Only the player strikes energy siphons, not ${ability.id}`);
    }
    const reach = trackedDeliveryReach(ability.effect.delivery);
    if (reach === undefined) {
        throw new Error(`${ability.id} has no melee reach to strike an energy siphon with`);
    }
    // The intermission may have resolved and recalled the siphon while the swing wound up.
    const siphon = world.findEnergySiphon(aimed.id);
    if (!siphon) {
        return;
    }
    const distance = Math.hypot(siphon.x - caster.x, siphon.y - caster.y);
    if (!isWithinMeleeReach(distance, reach, caster.hitRadius, siphon.type.hitRadius)) {
        return;
    }
    // A style switch mid-swing changes the basic attack, and the swing no longer counts as one.
    const impact: EnergySiphonImpact =
        ability.id === caster.basicAttack.id
            ? { kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK, style: caster.style }
            : { kind: EnergySiphonImpactKind.PLAYER_SKILL };
    const resolved = resolveEnergySiphonImpact(siphon.siphon, impact);
    if (resolved.result !== EnergySiphonImpactResult.REVERSED) {
        return;
    }
    siphon.siphon = resolved.siphon;
}

function landOnCombatant(world: WorldContext, target: Combatant, effect: AbilityEffect): void {
    applyPayloads(target, effect.payloads, world.timeSeconds, world.random, world.events);
    if (!effect.hitEffect || target.health <= 0) {
        return;
    }
    world.spawnVisualEffect(
        effect.hitEffect,
        { kind: "COMBATANT", combatant: target },
        hitEffectHoldSeconds(effect.payloads),
    );
}

function landCone(
    world: WorldContext,
    caster: Combatant,
    effect: AbilityEffect,
    delivery: ConeDelivery,
    aim: AbilityTarget,
): void {
    const hits = affectedCombatants(caster, delivery, effect.affects, aim, world.combatants());
    for (const hit of hits) {
        applyPayloads(hit, effect.payloads, world.timeSeconds, world.random, world.events);
    }
    const hitEffect = effect.hitEffect;
    if (!hitEffect) {
        return;
    }
    // The nearest tiles sit under the caster's own model, so when the budget runs short it's
    // the far end of the cone that keeps its graphics.
    const spawns = coneTileSpawns(caster.x, caster.y, caster.rotation, delivery, world.random);
    const budget = world.visualEffectBudget;
    const farthest = spawns.slice(Math.max(0, spawns.length - budget));
    for (const spawn of farthest) {
        world.pendingVisualEffects.push({
            hitEffect,
            anchor: { kind: "POINT", x: spawn.x, y: spawn.y, level: caster.level, rotation: 0 },
            startsAt: world.timeSeconds + spawn.delaySeconds,
        });
    }
}

// A free-flight spec fans count shots across the spread around the aim direction, each flying
// to max range along its own line; any other landing rule is a single shot that tracks the
// aimed combatant (or flies to the bare aimed point, to expire harmlessly, when there is none)
// or lands where the aim stands at cast time.
function spawnProjectiles(
    world: WorldContext,
    caster: Combatant,
    ability: ResolvedAbility,
    delivery: ProjectileDelivery,
    aim: AbilityTarget,
): void {
    const effect = ability.effect;
    const spec = delivery.spec;
    const impact: ProjectileImpact = {
        caster,
        affects: effect.affects,
        payloads: effect.payloads,
        hitEffect: effect.hitEffect,
        // Ranged's own basic-attack tag: compared against the player's *current* basic attack
        // rather than a fixed ability id, since which weapon tier (and so which ability) is the
        // basic attack now depends on the equipped ranged weapon (see Player.basicAttack).
        playerMechanic:
            caster instanceof Player &&
            caster.style === WeaponStyle.RANGED &&
            ability.id === caster.basicAttack.id
                ? "RANGED_BASIC"
                : caster instanceof Player && caster.style === WeaponStyle.MAGIC
                ? "MAGIC"
                : undefined,
    };
    const aimPoint = abilityTargetPoint(aim);
    if (spec.landing.kind === "FREE_FLIGHT") {
        const deltaX = aimPoint.x - caster.x;
        const deltaY = aimPoint.y - caster.y;
        if (deltaX === 0 && deltaY === 0) {
            return;
        }
        const directions = generateSpreadDirections(
            directionToRotation(deltaX, deltaY),
            delivery.spreadAngleRadians,
            delivery.count,
        );
        for (const rotation of directions) {
            const direction = rotationToDirection(rotation);
            const start = projectileLaunchPoint(world, caster, direction.x, direction.y);
            world.launchProjectile(spec, impact, start, {
                kind: "POINT",
                x: caster.x + direction.x * spec.range,
                y: caster.y + direction.y * spec.range,
            });
        }
        return;
    }
    const start = aimedLaunchPoint(world, caster, spec.landing, aimPoint);
    if (!start) {
        return;
    }
    const target: ProjectileTarget =
        spec.landing.kind === "TRACKED_COMBATANT" && aim.kind === AbilityTargetKind.COMBATANT
            ? { kind: "COMBATANT", combatant: aim.combatant }
            : { kind: "POINT", x: aimPoint.x, y: aimPoint.y };
    if (spec.landing.kind === "FIXED_POINT" && spec.landing.telegraph) {
        const distance = Math.hypot(aimPoint.x - start.x, aimPoint.y - start.y);
        world.spawnVisualEffect(
            spec.landing.telegraph,
            { kind: "POINT", x: aimPoint.x, y: aimPoint.y, level: caster.level, rotation: 0 },
            travelSeconds(spec.travelTime, distance),
        );
    }
    for (let shot = 0; shot < delivery.count; shot++) {
        world.launchProjectile(spec, impact, start, target);
    }
}

// Where an aimed shot spawns: above its landing point for a rock dropped from the sky, else a
// launch offset from the caster toward the aim (nowhere, when the aim is the caster's own
// position).
function aimedLaunchPoint(
    world: WorldContext,
    caster: Combatant,
    landing: ProjectileLanding,
    aimPoint: { x: number; y: number },
): FlightOrigin | undefined {
    if (landing.kind === "FIXED_POINT" && landing.origin.kind === "AT_TARGET") {
        return {
            x: aimPoint.x,
            y: aimPoint.y,
            height:
                world.terrain.getHeight(caster.level, aimPoint.x, aimPoint.y) +
                landing.origin.height,
        };
    }
    const deltaX = aimPoint.x - caster.x;
    const deltaY = aimPoint.y - caster.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance === 0) {
        return undefined;
    }
    return projectileLaunchPoint(world, caster, deltaX / distance, deltaY / distance);
}

function projectileLaunchPoint(
    world: WorldContext,
    caster: Combatant,
    directionX: number,
    directionY: number,
): FlightOrigin {
    const x = caster.x + directionX * PROJECTILE_LAUNCH_OFFSET;
    const y = caster.y + directionY * PROJECTILE_LAUNCH_OFFSET;
    return {
        x,
        y,
        height: world.terrain.getHeight(caster.level, x, y) + caster.projectileLaunchHeight,
    };
}
