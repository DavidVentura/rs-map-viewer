import { CombatEvent, CombatEventKind } from "./CombatEvent";
import { Combatant, Faction } from "./Combatant";
import {
    Affects,
    PayloadKind,
    applyPayloads,
    combatantsInCircle,
    damagePayload,
    hitEffectHoldSeconds,
    matchesAffects,
} from "./Effect";

function makeCombatant(
    x: number,
    y: number,
    faction: Faction,
    overrides?: Partial<Combatant>,
): Combatant {
    return {
        x,
        y,
        rotation: 0,
        level: 0,
        faction,
        hitRadius: 16,
        projectileLaunchHeight: 40,
        health: 10,
        maxHealth: 10,
        ...overrides,
    };
}

describe("matchesAffects", () => {
    const caster = makeCombatant(0, 0, Faction.PLAYER);
    const ally = makeCombatant(0, 0, Faction.PLAYER);
    const enemy = makeCombatant(0, 0, Faction.ENEMY);

    it("HOSTILE matches the other faction only", () => {
        expect(matchesAffects(caster, Affects.HOSTILE, enemy)).toBe(true);
        expect(matchesAffects(caster, Affects.HOSTILE, ally)).toBe(false);
        expect(matchesAffects(caster, Affects.HOSTILE, caster)).toBe(false);
    });

    it("ALLIED matches the caster's faction, the caster included", () => {
        expect(matchesAffects(caster, Affects.ALLIED, ally)).toBe(true);
        expect(matchesAffects(caster, Affects.ALLIED, caster)).toBe(true);
        expect(matchesAffects(caster, Affects.ALLIED, enemy)).toBe(false);
    });

    it("SELF matches the caster alone, not a same-faction twin", () => {
        expect(matchesAffects(caster, Affects.SELF, caster)).toBe(true);
        expect(matchesAffects(caster, Affects.SELF, ally)).toBe(false);
    });

    it("is relative to the caster's own faction", () => {
        expect(matchesAffects(enemy, Affects.HOSTILE, caster)).toBe(true);
        expect(matchesAffects(enemy, Affects.HOSTILE, ally)).toBe(true);
    });
});

describe("combatantsInCircle", () => {
    const center = { x: 0, y: 0, level: 0 };

    it("includes a combatant within the radius plus its own hit radius", () => {
        const near = makeCombatant(70, 0, Faction.ENEMY, { hitRadius: 16 });
        expect(combatantsInCircle(center, 64, [near])).toEqual([near]);
    });

    it("excludes a combatant just outside the radius plus its hit radius", () => {
        const far = makeCombatant(90, 0, Faction.ENEMY, { hitRadius: 16 });
        expect(combatantsInCircle(center, 64, [far])).toEqual([]);
    });

    it("excludes the dead and combatants on another level", () => {
        const dead = makeCombatant(0, 0, Faction.ENEMY, { health: 0 });
        const upstairs = makeCombatant(0, 0, Faction.ENEMY, { level: 1 });
        expect(combatantsInCircle(center, 64, [dead, upstairs])).toEqual([]);
    });

    it("ignores faction: filtering by who is affected is the caller's job", () => {
        const ally = makeCombatant(0, 0, Faction.PLAYER);
        const enemy = makeCombatant(0, 0, Faction.ENEMY);
        expect(combatantsInCircle(center, 64, [ally, enemy])).toEqual([ally, enemy]);
    });
});

describe("applyPayloads", () => {
    it("rolls DAMAGE with the injected random source and freezes relative to the current time", () => {
        const target = makeCombatant(0, 0, Faction.ENEMY, { health: 10, maxHealth: 10 });
        const events: CombatEvent[] = [];
        applyPayloads(
            target,
            [damagePayload(2, 6), { kind: PayloadKind.FREEZE, seconds: 3 }],
            100,
            () => 0.5,
            events,
        );
        expect(target.health).toBe(6);
        expect((target as { frozenUntil?: number }).frozenUntil).toBe(103);
        expect(events.map((event) => event.kind)).toEqual([
            CombatEventKind.DAMAGE,
            CombatEventKind.FREEZE,
        ]);
    });

    it("heals up to max health", () => {
        const target = makeCombatant(0, 0, Faction.PLAYER, { health: 4, maxHealth: 10 });
        const events: CombatEvent[] = [];
        applyPayloads(target, [{ kind: PayloadKind.HEAL, amount: 20 }], 0, () => 0, events);
        expect(target.health).toBe(10);
        expect(events).toEqual([{ kind: CombatEventKind.HEAL, target, amount: 6 }]);
    });

    it("stops landing payloads once the target is dead", () => {
        const target = makeCombatant(0, 0, Faction.ENEMY, { health: 5, maxHealth: 10 });
        const events: CombatEvent[] = [];
        applyPayloads(
            target,
            [
                damagePayload(5),
                { kind: PayloadKind.FREEZE, seconds: 3 },
                { kind: PayloadKind.HEAL, amount: 9 },
            ],
            0,
            () => 0,
            events,
        );
        expect(target.health).toBe(0);
        expect((target as { frozenUntil?: number }).frozenUntil).toBeUndefined();
        expect(events.map((event) => event.kind)).toEqual([CombatEventKind.DAMAGE]);
    });
});

describe("hitEffectHoldSeconds", () => {
    it("holds the hit graphic for the effect's longest freeze", () => {
        expect(
            hitEffectHoldSeconds([
                damagePayload(1),
                { kind: PayloadKind.FREEZE, seconds: 2 },
                { kind: PayloadKind.FREEZE, seconds: 3 },
            ]),
        ).toBe(3);
    });

    it("does not hold at all without a freeze", () => {
        expect(hitEffectHoldSeconds([damagePayload(1)])).toBeUndefined();
        expect(hitEffectHoldSeconds([])).toBeUndefined();
    });
});
