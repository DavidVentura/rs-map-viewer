import { Combatant, Faction } from "./Combatant";
import {
    PendingGroundStrike,
    combatantsHitByGroundStrike,
    groundStrikeProgress,
} from "./GroundStrike";

function makeCombatant(
    x: number,
    y: number,
    faction: Faction,
    overrides?: Partial<Combatant>,
): Combatant {
    return {
        x,
        y,
        level: 0,
        faction,
        hitRadius: 16,
        health: 10,
        maxHealth: 10,
        ...overrides,
    };
}

function makeStrike(overrides?: Partial<PendingGroundStrike>): PendingGroundStrike {
    return {
        x: 0,
        y: 0,
        level: 0,
        radius: 64,
        startSeconds: 0,
        strikeAtSeconds: 1,
        damageMin: 5,
        damageMax: 10,
        sourceFaction: Faction.PLAYER,
        caster: makeCombatant(0, 0, Faction.PLAYER),
        ...overrides,
    };
}

describe("combatantsHitByGroundStrike", () => {
    it("hits an opposing-faction combatant within the radius plus its hit radius", () => {
        const strike = makeStrike({ radius: 64, sourceFaction: Faction.PLAYER });
        const enemy = makeCombatant(70, 0, Faction.ENEMY, { hitRadius: 16 });

        expect(combatantsHitByGroundStrike(strike, [enemy])).toEqual([enemy]);
    });

    it("misses a combatant just outside the radius plus its hit radius", () => {
        const strike = makeStrike({ radius: 64, sourceFaction: Faction.PLAYER });
        const enemy = makeCombatant(90, 0, Faction.ENEMY, { hitRadius: 16 });

        expect(combatantsHitByGroundStrike(strike, [enemy])).toEqual([]);
    });

    it("does not hit combatants of the same faction as the strike source", () => {
        const strike = makeStrike({ radius: 64, sourceFaction: Faction.PLAYER });
        const ally = makeCombatant(0, 0, Faction.PLAYER);

        expect(combatantsHitByGroundStrike(strike, [ally])).toEqual([]);
    });

    it("does not hit combatants already dead", () => {
        const strike = makeStrike({ radius: 64, sourceFaction: Faction.PLAYER });
        const enemy = makeCombatant(0, 0, Faction.ENEMY, { health: 0 });

        expect(combatantsHitByGroundStrike(strike, [enemy])).toEqual([]);
    });

    it("does not hit combatants on a different level", () => {
        const strike = makeStrike({ radius: 64, sourceFaction: Faction.PLAYER, level: 0 });
        const enemy = makeCombatant(0, 0, Faction.ENEMY, { level: 1 });

        expect(combatantsHitByGroundStrike(strike, [enemy])).toEqual([]);
    });
});

describe("groundStrikeProgress", () => {
    it("is 0 right as the telegraph starts", () => {
        const strike = makeStrike({ startSeconds: 10, strikeAtSeconds: 11 });
        expect(groundStrikeProgress(strike, 10)).toBe(0);
    });

    it("is 0.5 halfway through the telegraph", () => {
        const strike = makeStrike({ startSeconds: 10, strikeAtSeconds: 11 });
        expect(groundStrikeProgress(strike, 10.5)).toBeCloseTo(0.5);
    });

    it("is 1 once the strike time is reached", () => {
        const strike = makeStrike({ startSeconds: 10, strikeAtSeconds: 11 });
        expect(groundStrikeProgress(strike, 11)).toBe(1);
    });

    it("clamps to 1 past the strike time", () => {
        const strike = makeStrike({ startSeconds: 10, strikeAtSeconds: 11 });
        expect(groundStrikeProgress(strike, 20)).toBe(1);
    });
});
