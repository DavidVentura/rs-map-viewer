import { ProjectileHitEffect, ProjectileSpec } from "./Projectile";

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

export enum AbilityEffectKind {
    PROJECTILE = 0,
    HEAL = 1,
    MELEE = 2,
    CONE_MELEE = 3,
    AREA = 4,
    MULTI_PROJECTILE = 5,
    GROUND_STRIKE = 6,
    HEAL_ALLIES = 7,
}

export type ProjectileEffect = {
    readonly kind: AbilityEffectKind.PROJECTILE;
    readonly spec: ProjectileSpec;
    // Rolled fresh per cast in place of spec.damage; unset for the fixed-damage player projectiles.
    readonly damageMin?: number;
    readonly damageMax?: number;
};

export type HealEffect = {
    readonly kind: AbilityEffectKind.HEAL;
    readonly amount: number;
};

export type MeleeEffect = {
    readonly kind: AbilityEffectKind.MELEE;
    readonly minDamage: number;
    readonly maxDamage: number;
    readonly reach: number;
};

export type ConeMeleeEffect = {
    readonly kind: AbilityEffectKind.CONE_MELEE;
    readonly damageMultiplier: number;
    readonly angleRadians: number;
    readonly reach: number;
    // Spawned once at impact, at a ground point in front of the caster (not per enemy hit); unset
    // for cone melees with no distinct impact graphic (e.g. Cleave).
    readonly hitEffect?: ProjectileHitEffect;
};

export type AreaEffect = {
    readonly kind: AbilityEffectKind.AREA;
    readonly radiusTiles: number;
    readonly damageMin: number;
    readonly damageMax: number;
    readonly freezeSeconds: number;
    readonly hitEffect: ProjectileHitEffect;
};

export type GroundStrikeEffect = {
    readonly kind: AbilityEffectKind.GROUND_STRIKE;
    readonly radiusTiles: number;
    readonly telegraphSeconds: number;
    readonly damageMin: number;
    readonly damageMax: number;
    // Casting range, i.e. how far from the target the caster may be to start this attack. Not
    // used by the strike resolution itself, only by enemyAttackRange's engage-distance check.
    readonly range: number;
};

export type HealAlliesEffect = {
    readonly kind: AbilityEffectKind.HEAL_ALLIES;
    readonly radiusTiles: number;
    readonly amount: number;
    readonly hitEffect: ProjectileHitEffect;
};

export type MultiProjectileEffect = {
    readonly kind: AbilityEffectKind.MULTI_PROJECTILE;
    readonly spec: ProjectileSpec;
    readonly count: number;
    readonly spreadAngleRadians: number;
};

export type AbilityEffect =
    | ProjectileEffect
    | HealEffect
    | MeleeEffect
    | ConeMeleeEffect
    | AreaEffect
    | MultiProjectileEffect
    | GroundStrikeEffect
    | HealAlliesEffect;

export type AbilityDefinition = {
    readonly id: string;
    readonly name: string;
    // Time from cast start to when the effect (damage/heal/etc) resolves, at this ability's
    // castSpeed. The cast animation keeps playing past this point through its own recovery
    // (see castAnimationSeconds); how much of that recovery is covered by the ability's ATTACK
    // lock vs. by idle time once the animation itself has finished is up to the lock's own seconds
    // relative to castAnimationSeconds, not to this field.
    readonly impactSeconds: number;
    readonly channelSeconds: number;
    // The cast sequence's own natural duration in seconds, at castSpeed 1 (from the cache's
    // per-frame tick lengths; see abilities.ts). Combined with castSpeed this gives
    // castAnimationSeconds, independent of impactSeconds/locks.
    readonly animationSeconds: number;
    // Playback speed multiplier for the cast animation (1 = natural speed). Chosen per-ability so
    // impactSeconds lands on the animation's visual contact frame; see abilities.ts for how each
    // value was derived from the cache's frame data.
    readonly castSpeed: number;
    readonly manaCost: number;
    readonly maxCharges: number;
    readonly rechargeSeconds: number;
    readonly requires: readonly CooldownGroup[];
    readonly locks: readonly CooldownLock[];
    readonly effect: AbilityEffect;
    readonly castSeqId?: number;
};

// The ATTACK-group lock's own seconds value, i.e. how long the ability keeps its caster from
// acting again after impact (see AbilityDefinition.impactSeconds). 0 for abilities with no
// ATTACK-group lock.
export function attackLockSeconds(definition: AbilityDefinition): number {
    return definition.locks.find((lock) => lock.group === CooldownGroup.ATTACK)?.seconds ?? 0;
}

// Wall-clock time the cast sequence itself plays for, at this ability's castSpeed - the point
// past which Player/Enemy stop showing the cast animation and fall back to idle/movement, whether
// or not the ATTACK lock (see attackLockSeconds) is still holding the caster in place.
export function castAnimationSeconds(definition: AbilityDefinition): number {
    return definition.animationSeconds / definition.castSpeed;
}

export type AbilityTarget = {
    readonly x: number;
    readonly y: number;
    readonly enemyId?: number;
};
