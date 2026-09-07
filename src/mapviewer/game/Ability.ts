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
    readonly windupSeconds: number;
    readonly channelSeconds: number;
    readonly manaCost: number;
    readonly maxCharges: number;
    readonly rechargeSeconds: number;
    readonly requires: readonly CooldownGroup[];
    readonly locks: readonly CooldownLock[];
    readonly effect: AbilityEffect;
    readonly castSeqId?: number;
};

export type AbilityTarget = {
    readonly x: number;
    readonly y: number;
    readonly enemyId?: number;
};
