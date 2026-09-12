import { SeqTiming, sequenceDurationSeconds, sequenceTimeToFrameSeconds } from "./Animation";
import { Combatant } from "./Combatant";
import { Affects, HitEffect, Payload } from "./Effect";
import { ProjectileSpec } from "./Projectile";
import { SeqCatalog } from "./SeqCatalog";

export enum CooldownGroup {
    ATTACK = 0,
    HEAL = 1,
}

export type CooldownLock = {
    readonly group: CooldownGroup;
    readonly seconds: number;
};

export enum WeaponStyle {
    MELEE = 0,
    RANGED = 1,
    MAGIC = 2,
}

export enum DeliveryKind {
    TARGET = 0,
    CONE = 1,
    CIRCLE = 2,
    PROJECTILE = 4,
}

export enum CircleCenter {
    TARGET = 0,
    CASTER = 1,
}

// The aimed combatant, if within reach (plus both hit radii).
export type TargetDelivery = {
    readonly kind: DeliveryKind.TARGET;
    readonly reach: number;
};

// POINT: the cone always swings toward the aimed ground point, ignoring any hovered combatant -
// the right choice for a special that reads wrong when snapped onto a body (see aimModeFor).
// TRACKED_TARGET: the cone is a basic attack's own ladder tier - it targets a combatant like
// TargetDelivery (reach-gated, chased into range, see GameWorld.computeMeleeChaseInput/
// canUseAbility) and swings toward wherever that combatant now stands once in reach.
export enum ConeAim {
    POINT = 0,
    TRACKED_TARGET = 1,
}

// Everything in the cone in front of the caster.
export type ConeDelivery = {
    readonly kind: DeliveryKind.CONE;
    readonly angleRadians: number;
    readonly reach: number;
    readonly casterHalfWidth: number;
    readonly aim: ConeAim;
};

// Everything within the radius (plus its hit radius) of the aimed point/combatant or the caster.
export type CircleDelivery = {
    readonly kind: DeliveryKind.CIRCLE;
    readonly radiusTiles: number;
    readonly center: CircleCenter;
};

// count projectiles fanned across spreadAngleRadians around the aim (a single aimed shot is count
// 1); each carries the effect's payloads and lands them under the spec's landing rule.
export type ProjectileDelivery = {
    readonly kind: DeliveryKind.PROJECTILE;
    readonly spec: ProjectileSpec;
    readonly count: number;
    readonly spreadAngleRadians: number;
};

export type Delivery = TargetDelivery | ConeDelivery | CircleDelivery | ProjectileDelivery;

// hitEffect is spawned on each affected combatant for TARGET/CIRCLE deliveries and tracked
// projectiles, and once at the landing point for CONE deliveries and fixed-point projectiles.
// casterEffect is spawned once on the caster itself when the ability resolves, regardless of
// delivery kind - a weapon-special graphic that plays on the wielder (rotated to their facing)
// rather than at the target or landing point.
export type AbilityEffect<D extends Delivery = Delivery> = {
    readonly delivery: D;
    readonly affects: Affects;
    readonly payloads: readonly Payload[];
    readonly hitEffect?: HitEffect;
    readonly casterEffect?: HitEffect;
};

// The item shown in the caster's hand for the duration of a cast, in place of whatever they have
// equipped - e.g. the elder maul special or the crystal halberd special. hidesShield mirrors that
// item's own wearpos2 (see Appearance.ItemWearInfo): true for a two-handed override item, which
// hides a worn shield-slot attachment (defender/offhand book) the same way any other two-handed
// weapon would.
export type CastItemOverride = {
    readonly itemId: number;
    readonly hidesShield: boolean;
};

export type AbilityDefinition = {
    readonly id: string;
    readonly name: string;
    readonly castSeqId: number;
    // Frame index into castSeqId's sequence at which the effect (damage/heal/etc) resolves - the
    // visual contact/release pose. The cast animation keeps playing past this point through its
    // own recovery; how much of that recovery is covered by the ability's ATTACK lock vs. by idle
    // time once the animation itself has finished is up to the lock's own seconds.
    readonly contactFrame: number;
    // Playback speed multiplier for the cast animation (1 = natural speed). The demo's attack
    // cadence is much faster than natural OSRS animation speed, so this stays authored per ability
    // rather than derived from the cache.
    readonly castSpeed: number;
    readonly channelSeconds: number;
    readonly manaCost: number;
    readonly maxCharges: number;
    readonly rechargeSeconds: number;
    readonly requires: readonly CooldownGroup[];
    readonly locks: readonly CooldownLock[];
    readonly effect: AbilityEffect;
    readonly castItemOverride?: CastItemOverride;
};

// Wall-clock cast timing at the ability's castSpeed, derived from the cache's per-frame lengths
// (see resolveCastTiming): impactSeconds is when contactFrame is first displayed, i.e. when the
// effect resolves; animationSeconds is the whole cast sequence's length, the point past which
// Player/Enemy stop showing the cast animation and fall back to idle/movement, whether or not the
// ATTACK lock (see attackLockSeconds) is still holding the caster in place.
export type CastTiming = {
    readonly impactSeconds: number;
    readonly animationSeconds: number;
};

export type ResolvedAbility = AbilityDefinition & {
    readonly castSeq: SeqTiming;
    readonly timing: CastTiming;
};

export function resolveCastTiming(definition: AbilityDefinition, castSeq: SeqTiming): CastTiming {
    return {
        impactSeconds:
            sequenceTimeToFrameSeconds(castSeq, definition.contactFrame) / definition.castSpeed,
        animationSeconds: sequenceDurationSeconds(castSeq) / definition.castSpeed,
    };
}

export function resolveAbility(
    definition: AbilityDefinition,
    catalog: SeqCatalog,
): ResolvedAbility {
    const castSeq = catalog.get(definition.castSeqId);
    return { ...definition, castSeq, timing: resolveCastTiming(definition, castSeq) };
}

// The ATTACK-group lock's own seconds value, i.e. how long the ability keeps its caster from
// acting again after impact (see CastTiming.impactSeconds). 0 for abilities with no ATTACK-group
// lock.
export function attackLockSeconds(definition: AbilityDefinition): number {
    return definition.locks.find((lock) => lock.group === CooldownGroup.ATTACK)?.seconds ?? 0;
}

export enum AbilityTargetKind {
    COMBATANT = 0,
    POINT = 1,
}

export type AbilityTarget =
    | { readonly kind: AbilityTargetKind.COMBATANT; readonly combatant: Combatant }
    | { readonly kind: AbilityTargetKind.POINT; readonly x: number; readonly y: number };

export function abilityTargetPoint(target: AbilityTarget): { x: number; y: number } {
    return target.kind === AbilityTargetKind.COMBATANT ? target.combatant : target;
}

// A cast's aim as it stands at impact: an aimed combatant that has since died or is off the
// caster's level degrades to the point it stands on.
export function liveAbilityTarget(target: AbilityTarget, level: number): AbilityTarget {
    if (target.kind === AbilityTargetKind.POINT) {
        return target;
    }
    const combatant = target.combatant;
    if (combatant.level === level && combatant.health > 0) {
        return target;
    }
    return { kind: AbilityTargetKind.POINT, x: combatant.x, y: combatant.y };
}

export function aimedCombatant(target: AbilityTarget, level: number): Combatant | undefined {
    const live = liveAbilityTarget(target, level);
    return live.kind === AbilityTargetKind.COMBATANT ? live.combatant : undefined;
}

// POINT_ONLY deliveries are line/arc skills that read wrong when snapped onto a hovered body, so
// they always aim at the ground point; the rest prefer the hovered combatant and fall back to it.
export enum AimMode {
    COMBATANT_OR_POINT = 0,
    POINT_ONLY = 1,
}

export function aimModeFor(delivery: Delivery): AimMode {
    switch (delivery.kind) {
        case DeliveryKind.CONE:
            return delivery.aim === ConeAim.TRACKED_TARGET
                ? AimMode.COMBATANT_OR_POINT
                : AimMode.POINT_ONLY;
        case DeliveryKind.PROJECTILE:
            return delivery.spec.landing.kind === "FREE_FLIGHT"
                ? AimMode.POINT_ONLY
                : AimMode.COMBATANT_OR_POINT;
        case DeliveryKind.TARGET:
        case DeliveryKind.CIRCLE:
            return AimMode.COMBATANT_OR_POINT;
    }
}

// The reach a delivery chases/gates a live combatant to, for deliveries whose AimMode is
// COMBATANT_OR_POINT and so can be aimed at one: TargetDelivery always, and a TRACKED_TARGET
// ConeDelivery (a melee basic attack's own ladder tier). undefined for anything else - a
// POINT_ONLY cone special (no combatant to chase) or a CIRCLE/PROJECTILE delivery, which have
// their own aim/range rules. GameWorld's melee chase-to-target movement and its canUseAbility
// reach check both derive their reach from this, rather than special-casing DeliveryKind.TARGET.
export function trackedDeliveryReach(delivery: Delivery): number | undefined {
    switch (delivery.kind) {
        case DeliveryKind.TARGET:
            return delivery.reach;
        case DeliveryKind.CONE:
            return delivery.aim === ConeAim.TRACKED_TARGET ? delivery.reach : undefined;
        case DeliveryKind.CIRCLE:
        case DeliveryKind.PROJECTILE:
            return undefined;
    }
}

// The aim for a cast at `combatant` under the delivery's aim mode: the combatant itself, or the
// ground under it.
export function aimAtCombatant(delivery: Delivery, combatant: Combatant): AbilityTarget {
    return aimModeFor(delivery) === AimMode.POINT_ONLY
        ? { kind: AbilityTargetKind.POINT, x: combatant.x, y: combatant.y }
        : { kind: AbilityTargetKind.COMBATANT, combatant };
}
