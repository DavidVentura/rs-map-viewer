import { Combatant } from "./Combatant";

export enum CombatEventKind {
    DAMAGE = 0,
    HEAL = 1,
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

export type CombatEvent = DamageEvent | HealEvent;

export function applyDamage(target: Combatant, amount: number, events: CombatEvent[]): void {
    target.health = Math.max(0, target.health - amount);
    events.push({ kind: CombatEventKind.DAMAGE, target, amount });
}

export function applyHeal(target: Combatant, amount: number, events: CombatEvent[]): void {
    target.health = Math.min(target.maxHealth, target.health + amount);
    events.push({ kind: CombatEventKind.HEAL, target, amount });
}
