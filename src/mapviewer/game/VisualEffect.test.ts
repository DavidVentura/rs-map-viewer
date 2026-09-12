import { SeqTiming } from "./Animation";
import { Combatant, Faction } from "./Combatant";
import { VisualEffect, VisualEffectKind, casterEffectTiming } from "./VisualEffect";

const SEQ: SeqTiming = { seqId: 0, frameTicks: [20] };

function makeCombatant(overrides?: Partial<Combatant>): Combatant {
    return {
        x: 0,
        y: 0,
        rotation: 0,
        level: 0,
        faction: Faction.PLAYER,
        hitRadius: 16,
        projectileLaunchHeight: 40,
        health: 10,
        maxHealth: 10,
        ...overrides,
    };
}

describe("VisualEffect rotation", () => {
    it("captures a combatant anchor's facing once, rather than tracking it live", () => {
        const combatant = makeCombatant({ rotation: 512 });
        const effect = new VisualEffect(
            VisualEffectKind.CRYSTAL_HALBERD_SPECIAL,
            { kind: "COMBATANT", combatant },
            100,
            SEQ,
        );

        expect(effect.rotation).toBe(512);

        combatant.rotation = 1536;

        expect(effect.rotation).toBe(512);
    });

    it("still tracks a combatant anchor's position live, unlike its facing", () => {
        const combatant = makeCombatant({ x: 10, y: 20 });
        const effect = new VisualEffect(
            VisualEffectKind.CRYSTAL_HALBERD_SPECIAL,
            { kind: "COMBATANT", combatant },
            100,
            SEQ,
        );

        combatant.x = 300;
        combatant.y = 400;

        expect(effect.x).toBe(300);
        expect(effect.y).toBe(400);
    });

    it("is unrotated for a point anchor", () => {
        const effect = new VisualEffect(
            VisualEffectKind.MAUL_IMPACT_SPARK,
            { kind: "POINT", x: 0, y: 0, level: 0 },
            0,
            SEQ,
        );

        expect(effect.rotation).toBe(0);
    });
});

describe("casterEffectTiming", () => {
    const swing = { seqId: 1203, frameTicks: [3, 2, 1, 9] };

    it("plays a trail with the swing's frame count on the swing's own frame timings", () => {
        const trail = { seqId: 1204, frameTicks: [3, 3, 2, 10] };
        expect(casterEffectTiming(trail, swing)).toEqual({ seqId: 1204, frameTicks: [3, 2, 1, 9] });
    });

    it("keeps a graphic's own timings when it isn't authored frame for frame against the swing", () => {
        const puff = { seqId: 366, frameTicks: [2, 2] };
        expect(casterEffectTiming(puff, swing)).toBe(puff);
    });
});
