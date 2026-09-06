import { Combatant } from "./Combatant";

export enum CombatEventKind {
    DAMAGE = 0,
    HEAL = 1,
    FREEZE = 2,
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

export type CombatEvent = DamageEvent | HealEvent | FreezeEvent;

export interface Freezable extends Combatant {
    frozenUntil?: number;
}

export function applyFreeze(target: Freezable, untilSeconds: number, events: CombatEvent[]): void {
    target.frozenUntil = Math.max(target.frozenUntil ?? 0, untilSeconds);
    events.push({ kind: CombatEventKind.FREEZE, target, untilSeconds });
}

export function applyDamage(target: Combatant, amount: number, events: CombatEvent[]): void {
    target.health = Math.max(0, target.health - amount);
    events.push({ kind: CombatEventKind.DAMAGE, target, amount });
}

export function applyHeal(target: Combatant, amount: number, events: CombatEvent[]): void {
    const healedAmount = Math.min(amount, target.maxHealth - target.health);
    if (healedAmount <= 0) {
        return;
    }
    target.health += healedAmount;
    events.push({ kind: CombatEventKind.HEAL, target, amount: healedAmount });
}
