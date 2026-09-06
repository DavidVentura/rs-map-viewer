import { ProjectileSpec } from "./Projectile";

export enum CooldownGroup {
    ATTACK = 0,
    HEAL = 1,
}

export type CooldownLock = {
    readonly group: CooldownGroup;
    readonly seconds: number;
};

export enum Stance {
    MELEE = 0,
    RANGED = 1,
    MAGIC = 2,
}

export enum AbilityEffectKind {
    PROJECTILE = 0,
    HEAL = 1,
    MELEE = 2,
    STANCE = 3,
}

export type ProjectileEffect = {
    readonly kind: AbilityEffectKind.PROJECTILE;
    readonly spec: ProjectileSpec;
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

export type StanceEffect = {
    readonly kind: AbilityEffectKind.STANCE;
    readonly stance: Stance;
};

export type AbilityEffect = ProjectileEffect | HealEffect | MeleeEffect | StanceEffect;

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
};

export type AbilityTarget = {
    readonly x: number;
    readonly y: number;
    readonly enemyId?: number;
};
