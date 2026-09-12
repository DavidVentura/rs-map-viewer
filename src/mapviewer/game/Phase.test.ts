import { Wave } from "./Encounter";
import { EnemyTypeId } from "./EnemyType";
import {
    createPhase,
    createPhaseId,
    currentPhase,
    initialPhaseLifecycle,
    transitionPhase,
} from "./Phase";
import { createExperienceReward, createRewardId } from "./Reward";

const WAVE: Wave = {
    groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
    startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0, delaySeconds: 0 },
};

describe("phases", () => {
    it("moves a rewarded phase through ready, active, rewards, and complete", () => {
        const phase = createPhase(
            createPhaseId("first"),
            "First phase",
            [WAVE],
            { kind: "ALL_WAVES_CLEARED" },
            [createExperienceReward(createRewardId("xp"), 20)],
        );

        const active = transitionPhase(initialPhaseLifecycle([phase]), { kind: "START_PHASE" });
        const rewards = transitionPhase(active, { kind: "PHASE_CLEARED" });
        const complete = transitionPhase(rewards, { kind: "REWARDS_CLAIMED" });

        expect(active.kind).toBe("ACTIVE");
        expect(rewards.kind).toBe("REWARDS");
        expect(complete.kind).toBe("COMPLETE");
    });

    it("completes immediately when a cleared phase has no rewards", () => {
        const phase = createPhase(
            createPhaseId("empty_rewards"),
            "Empty rewards",
            [WAVE],
            { kind: "ALL_WAVES_CLEARED" },
            [],
        );
        const active = transitionPhase(initialPhaseLifecycle([phase]), { kind: "START_PHASE" });

        expect(transitionPhase(active, { kind: "PHASE_CLEARED" }).kind).toBe("COMPLETE");
    });

    it("rejects transitions that violate the lifecycle", () => {
        const phase = createPhase(
            createPhaseId("first"),
            "First phase",
            [WAVE],
            { kind: "ALL_WAVES_CLEARED" },
            [],
        );

        expect(() =>
            transitionPhase(initialPhaseLifecycle([phase]), { kind: "PHASE_CLEARED" }),
        ).toThrow(Error);
    });

    it("rejects empty phase labels and wave groups", () => {
        expect(() =>
            createPhase(createPhaseId("invalid"), "", [WAVE], { kind: "ALL_WAVES_CLEARED" }, []),
        ).toThrow(TypeError);
        expect(() =>
            createPhase(createPhaseId("invalid"), "Invalid", [], { kind: "ALL_WAVES_CLEARED" }, []),
        ).toThrow(RangeError);
    });

    it("advances through authored phases without reconstructing lifecycle state", () => {
        const first = createPhase(
            createPhaseId("first"),
            "First phase",
            [WAVE],
            { kind: "ALL_WAVES_CLEARED" },
            [],
        );
        const second = createPhase(
            createPhaseId("second"),
            "Second phase",
            [WAVE],
            { kind: "ALL_WAVES_CLEARED" },
            [createExperienceReward(createRewardId("xp"), 20)],
        );
        const afterFirst = transitionPhase(
            transitionPhase(initialPhaseLifecycle([first, second]), { kind: "START_PHASE" }),
            { kind: "PHASE_CLEARED" },
        );
        const rewards = transitionPhase(afterFirst, { kind: "START_PHASE" });
        const complete = transitionPhase(transitionPhase(rewards, { kind: "PHASE_CLEARED" }), {
            kind: "REWARDS_CLAIMED",
        });

        expect(afterFirst.kind).toBe("READY");
        expect(afterFirst.phaseIndex).toBe(1);
        expect(currentPhase(afterFirst)).toBe(second);
        expect(complete.kind).toBe("COMPLETE");
        expect(complete.phaseIndex).toBe(1);
    });

    it("rejects an empty authored phase list", () => {
        expect(() => initialPhaseLifecycle([])).toThrow(RangeError);
    });
});
