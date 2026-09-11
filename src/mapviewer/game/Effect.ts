import { CombatEvent, applyDamage, applyFreeze, applyHeal } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { VisualEffectKind } from "./VisualEffect";
import { RandomSource, rollDamage } from "./abilityRules";

// Who an effect lands on, relative to its caster's faction; SELF is the caster alone.
export enum Affects {
    HOSTILE = 0,
    ALLIED = 1,
    SELF = 2,
}

export enum PayloadKind {
    DAMAGE = 0,
    FREEZE = 1,
    HEAL = 2,
}

// A fixed hit is min === max.
export type DamageRoll = {
    readonly min: number;
    readonly max: number;
};

export type DamagePayload = {
    readonly kind: PayloadKind.DAMAGE;
    readonly roll: DamageRoll;
};

export type FreezePayload = {
    readonly kind: PayloadKind.FREEZE;
    readonly seconds: number;
};

export type HealPayload = {
    readonly kind: PayloadKind.HEAL;
    readonly amount: number;
};

export type Payload = DamagePayload | FreezePayload | HealPayload;

export function damagePayload(min: number, max: number = min): DamagePayload {
    return { kind: PayloadKind.DAMAGE, roll: { min, max } };
}

export type HitEffect = {
    readonly kind: VisualEffectKind;
    readonly seqId: number;
    readonly height: number;
};

export type GroundPoint = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export function matchesAffects(caster: Combatant, affects: Affects, candidate: Combatant): boolean {
    switch (affects) {
        case Affects.HOSTILE:
            return candidate.faction !== caster.faction;
        case Affects.ALLIED:
            return candidate.faction === caster.faction;
        case Affects.SELF:
            return candidate === caster;
    }
}

export function combatantsInCircle<T extends Combatant>(
    center: GroundPoint,
    radius: number,
    combatants: readonly T[],
): T[] {
    return combatants.filter(
        (combatant) =>
            combatant.level === center.level &&
            combatant.health > 0 &&
            Math.hypot(combatant.x - center.x, combatant.y - center.y) <=
                radius + combatant.hitRadius,
    );
}

// Payloads land in order and stop at death: a DAMAGE that kills leaves no FREEZE or HEAL to land
// on the corpse.
export function applyPayloads(
    target: Combatant,
    payloads: readonly Payload[],
    timeSeconds: number,
    random: RandomSource,
    events: CombatEvent[],
): void {
    for (const payload of payloads) {
        if (target.health <= 0) {
            return;
        }
        switch (payload.kind) {
            case PayloadKind.DAMAGE:
                applyDamage(target, rollDamage(payload.roll.min, payload.roll.max, random), events);
                break;
            case PayloadKind.FREEZE:
                applyFreeze(target, timeSeconds + payload.seconds, events);
                break;
            case PayloadKind.HEAL:
                applyHeal(target, payload.amount, events);
                break;
        }
    }
}

// A hit graphic stays on its combatant for as long as the effect's freeze holds it; with no freeze
// it just plays out once.
export function hitEffectHoldSeconds(payloads: readonly Payload[]): number | undefined {
    const freezeSeconds = payloads.reduce(
        (longest, payload) =>
            payload.kind === PayloadKind.FREEZE ? Math.max(longest, payload.seconds) : longest,
        0,
    );
    return freezeSeconds > 0 ? freezeSeconds : undefined;
}
