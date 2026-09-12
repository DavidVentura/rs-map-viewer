import {
    IDLE_INTERACTION,
    beginExecution,
    beginInteraction,
    cancelInteraction,
    completeInteraction,
    createAuthoredLocationTarget,
    createInteraction,
    createInteractionId,
    createInteractionPose,
    createWorldPosition,
} from "./Interaction";
import { createPhaseId } from "./Phase";

describe("interactions", () => {
    const phaseId = createPhaseId("first");
    const firstPose = createInteractionPose(createWorldPosition(10, 10, 0), Math.PI);
    const secondPose = createInteractionPose(createWorldPosition(30, 10, 0), 0);
    const interaction = createInteraction(
        createInteractionId("start_first"),
        createAuthoredLocationTarget("Start first phase", [firstPose, secondPose]),
        { kind: "START_PHASE", phaseId },
        123,
        1.5,
    );

    it("selects the nearest authored pose, preserving authored order as a tie-break", () => {
        const approaching = beginInteraction(
            IDLE_INTERACTION,
            interaction,
            createWorldPosition(20, 10, 0),
        );

        expect(approaching.pose).toBe(firstPose);
    });

    it("requires the selected exact pose before executing and only emits actions on completion", () => {
        const approaching = beginInteraction(
            IDLE_INTERACTION,
            interaction,
            createWorldPosition(12, 10, 0),
        );

        expect(() => beginExecution(approaching, createWorldPosition(11, 10, 0), 10)).toThrow(
            RangeError,
        );

        const executing = beginExecution(approaching, firstPose.position, 10);
        expect(executing.kind).toBe("EXECUTING");
        expect(executing.completesAtSeconds).toBe(11.5);
        expect(() => completeInteraction(executing, 11.49)).toThrow(RangeError);
        expect(completeInteraction(executing, 11.5)).toEqual({
            state: IDLE_INTERACTION,
            action: { kind: "START_PHASE", phaseId },
        });
    });

    it("cancels an approach without emitting its action", () => {
        const approaching = beginInteraction(
            IDLE_INTERACTION,
            interaction,
            createWorldPosition(12, 10, 0),
        );

        expect(cancelInteraction(approaching)).toBe(IDLE_INTERACTION);
    });

    it("rejects targets without a pose on the player level", () => {
        const upstairsInteraction = createInteraction(
            createInteractionId("upstairs"),
            createAuthoredLocationTarget("Upstairs", [
                createInteractionPose(createWorldPosition(1, 1, 1), 0),
            ]),
            { kind: "ACTIVATE_PHASE_REWARDS", phaseId },
            456,
            1,
        );

        expect(() =>
            beginInteraction(IDLE_INTERACTION, upstairsInteraction, createWorldPosition(1, 1, 0)),
        ).toThrow(RangeError);
    });

    it("rejects non-positive interaction durations", () => {
        expect(() =>
            createInteraction(
                createInteractionId("instant"),
                createAuthoredLocationTarget("Instant", [firstPose]),
                { kind: "START_PHASE", phaseId },
                1,
                0,
            ),
        ).toThrow(RangeError);
    });
});
