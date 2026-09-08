import { Combatant } from "./Combatant";
import { EquipmentPath } from "./Equipment";

export enum CombatEventKind {
    DAMAGE = 0,
    HEAL = 1,
    FREEZE = 2,
    PLAYER_DIED = 3,
    ENEMY_DIED = 4,
    ENEMY_RESPAWNED = 5,
    ENCOUNTER_CLEARED = 6,
    GROUND_STRIKE_LANDED = 7,
    ITEM_DROPPED = 8,
    ITEM_PICKED_UP = 9,
    BOSS_PHASE = 10,
    CONE_MELEE_LANDED = 11,
}

export type DamageEvent = {
    kind: CombatEventKind.DAMAGE;
    target: Combatant;
    amount: number;
};

export type HealEvent = {
    kind: CombatEventKind.HEAL;
    target: Combatant;
    amount: number;
};

export type FreezeEvent = {
    kind: CombatEventKind.FREEZE;
    target: Combatant;
    untilSeconds: number;
};

export type PlayerDiedEvent = {
    kind: CombatEventKind.PLAYER_DIED;
    target: Combatant;
};

export type EnemyDiedEvent = {
    kind: CombatEventKind.ENEMY_DIED;
    target: Combatant;
};

export type EnemyRespawnedEvent = {
    kind: CombatEventKind.ENEMY_RESPAWNED;
    target: Combatant;
};

export type EncounterClearedEvent = {
    kind: CombatEventKind.ENCOUNTER_CLEARED;
};

export type GroundStrikeLandedEvent = {
    kind: CombatEventKind.GROUND_STRIKE_LANDED;
    x: number;
    y: number;
    level: number;
    radius: number;
};

export type ItemDroppedEvent = {
    kind: CombatEventKind.ITEM_DROPPED;
    path: EquipmentPath;
    tierIndex: number;
    x: number;
    y: number;
    level: number;
};

export type ItemPickedUpEvent = {
    kind: CombatEventKind.ITEM_PICKED_UP;
    path: EquipmentPath;
    tierIndex: number;
};

export type BossPhaseEvent = {
    kind: CombatEventKind.BOSS_PHASE;
    boss: Combatant;
    phaseLabel: string;
};

// A cone-melee cast that carries a hitEffect (see ConeMeleeEffect.hitEffect) landing: lets the HUD
// draw a short-lived outline of the cone's actual damage area (see hudDraw.drawGroundConeFlash),
// distinct from GroundStrikeLandedEvent's circular area.
export type ConeMeleeLandedEvent = {
    kind: CombatEventKind.CONE_MELEE_LANDED;
    x: number;
    y: number;
    level: number;
    facingRotation: number;
    angleRadians: number;
    reach: number;
};

export type CombatEvent =
    | DamageEvent
    | HealEvent
    | FreezeEvent
    | PlayerDiedEvent
    | EnemyDiedEvent
    | EnemyRespawnedEvent
    | EncounterClearedEvent
    | GroundStrikeLandedEvent
    | ItemDroppedEvent
    | ItemPickedUpEvent
    | BossPhaseEvent
    | ConeMeleeLandedEvent;

export interface Freezable extends Combatant {
    frozenUntil?: number;
}

export function applyFreeze(target: Freezable, untilSeconds: number, events: CombatEvent[]): void {
    target.frozenUntil = Math.max(target.frozenUntil ?? 0, untilSeconds);
    events.push({ kind: CombatEventKind.FREEZE, target, untilSeconds });
}

// A target with its own damage-taken multiplier (currently only Player, via its melee-defender
// equipment) mitigates incoming damage here rather than this transform special-casing Player, the
// same pattern Freezable above uses for freeze duration.
export interface DamageTakenModifiable extends Combatant {
    readonly damageTakenMultiplier: number;
}

function hasDamageTakenMultiplier(target: Combatant): target is DamageTakenModifiable {
    return typeof (target as Partial<DamageTakenModifiable>).damageTakenMultiplier === "number";
}

// A target that is temporarily immune (currently only the player, via the debug invulnerability
// toggle) takes no damage at all, the same duck-typed pattern DamageTakenModifiable above uses for
// its multiplier; this covers every applyDamage caller, including Projectile.ts, with no changes
// needed at any of those call sites.
export interface Invulnerable extends Combatant {
    readonly invulnerable: boolean;
}

function isInvulnerable(target: Combatant): target is Invulnerable {
    return typeof (target as Partial<Invulnerable>).invulnerable === "boolean";
}

export function applyDamage(target: Combatant, amount: number, events: CombatEvent[]): void {
    if (isInvulnerable(target) && target.invulnerable) {
        return;
    }
    const effectiveAmount = hasDamageTakenMultiplier(target)
        ? amount * target.damageTakenMultiplier
        : amount;
    target.health = Math.max(0, target.health - effectiveAmount);
    events.push({ kind: CombatEventKind.DAMAGE, target, amount: effectiveAmount });
}

export function applyHeal(target: Combatant, amount: number, events: CombatEvent[]): void {
    const healedAmount = Math.min(amount, target.maxHealth - target.health);
    if (healedAmount <= 0) {
        return;
    }
    target.health += healedAmount;
    events.push({ kind: CombatEventKind.HEAL, target, amount: healedAmount });
}
