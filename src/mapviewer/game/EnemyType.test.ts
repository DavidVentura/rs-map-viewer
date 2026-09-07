import { BossPhase, EnemyTypeId, resolveTriggeredBossPhase } from "./EnemyType";

function phase(healthFraction: number, label: string): BossPhase {
    return {
        healthFraction,
        label,
        spawnAdds: { enemyTypeId: EnemyTypeId.YT_HURKOT, count: 2, offsetTiles: 2 },
    };
}

describe("resolveTriggeredBossPhase", () => {
    it("returns undefined above every phase's threshold", () => {
        const phases = [phase(0.5, "Healers")];
        expect(resolveTriggeredBossPhase(phases, 600, 1000, new Set())).toBeUndefined();
    });

    it("triggers once health drops to or below the threshold", () => {
        const phases = [phase(0.5, "Healers")];
        expect(resolveTriggeredBossPhase(phases, 500, 1000, new Set())).toBe(0);
        expect(resolveTriggeredBossPhase(phases, 400, 1000, new Set())).toBe(0);
    });

    it("does not retrigger a phase already marked as triggered", () => {
        const phases = [phase(0.5, "Healers")];
        expect(resolveTriggeredBossPhase(phases, 400, 1000, new Set([0]))).toBeUndefined();
    });

    it("triggers phases one at a time, lowest threshold not yet crossed first", () => {
        const phases = [phase(0.75, "Adds 1"), phase(0.25, "Adds 2")];
        // Health crashes straight past both thresholds in one hit; only phase 0 fires this call.
        expect(resolveTriggeredBossPhase(phases, 100, 1000, new Set())).toBe(0);
        // Once phase 0 is marked triggered, the next call picks up phase 1.
        expect(resolveTriggeredBossPhase(phases, 100, 1000, new Set([0]))).toBe(1);
    });

    it("returns undefined when the boss declares no phases", () => {
        expect(resolveTriggeredBossPhase(undefined, 0, 1000, new Set())).toBeUndefined();
    });
});
