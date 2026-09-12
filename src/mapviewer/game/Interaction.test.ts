import {
    IDLE_INTERACTION,
    WorldObjectKind,
    WorldObjectVariant,
    beginExecution,
    beginInteraction,
    cancelInteraction,
    completeInteraction,
    createInteraction,
    createInteractionId,
    createWorldObject,
    createWorldObjectId,
    createWorldPosition,
    isWorldObjectVisible,
    worldObjectApproachPose,
    worldObjectRotationUnits,
    worldObjectVariant,
} from "./Interaction";
import { createPhaseId } from "./Phase";
import { directionToRotation } from "./projectileMath";

describe("world objects", () => {
    it("faces its approach tile, and the approach pose faces back at it", () => {
        const lever = createWorldObject(
            createWorldObjectId(1),
            WorldObjectKind.LEVER,
            createWorldPosition(0, 0, 0),
            1,
        );

        expect(worldObjectRotationUnits(lever)).toBe(512);
        const approach = worldObjectApproachPose(lever);
        expect(approach.position).toEqual({ x: 128, y: 0, level: 0 });
        // The approach tile is east of the lever, so the player faces west, toward it.
        expect(approach.facingRotation).toBe(directionToRotation(-1, 0));
    });

    it("derives every orientation's approach tile consistently", () => {
        const positions = ([0, 1, 2, 3] as const).map((orientation) => {
            const object = createWorldObject(
                createWorldObjectId(orientation + 1),
                WorldObjectKind.CHEST,
                createWorldPosition(1000, 1000, 0),
                orientation,
            );
            return worldObjectApproachPose(object).position;
        });
        expect(positions).toEqual([
            { x: 1000, y: 1128, level: 0 },
            { x: 1128, y: 1000, level: 0 },
            { x: 1000, y: 872, level: 0 },
            { x: 872, y: 1000, level: 0 },
        ]);
    });
});

describe("world object visuals", () => {
    const phaseId = createPhaseId("first");
    const lever = createWorldObject(
        createWorldObjectId(1),
        WorldObjectKind.LEVER,
        createWorldPosition(0, 0, 0),
        1,
    );
    const chest = createWorldObject(
        createWorldObjectId(2),
        WorldObjectKind.CHEST,
        createWorldPosition(1000, 0, 0),
        3,
    );
    const startLever = createInteraction(
        createInteractionId("start_first"),
        lever.id,
        "Pull Lever",
        { kind: "START_PHASE", phaseId },
        834,
    );
    const claimChest = createInteraction(
        createInteractionId("claim_first"),
        chest.id,
        "Open Chest",
        { kind: "ACTIVATE_PHASE_REWARDS", phaseId },
        536,
    );

    it("is always visible, and only shows its activated variant while its own interaction executes", () => {
        expect(isWorldObjectVisible(lever, [startLever], IDLE_INTERACTION, false)).toBe(true);
        expect(worldObjectVariant(lever, IDLE_INTERACTION, false)).toBe(WorldObjectVariant.REST);

        const approaching = beginInteraction(
            IDLE_INTERACTION,
            startLever,
            worldObjectApproachPose(lever),
        );
        expect(worldObjectVariant(lever, approaching, false)).toBe(WorldObjectVariant.REST);

        const executing = beginExecution(approaching, approaching.pose.position, 0, 0.8);
        expect(worldObjectVariant(lever, executing, false)).toBe(WorldObjectVariant.ACTIVATED);
    });

    it("the chest is hidden until its reward interaction is active, and stays open while rewards are being claimed", () => {
        expect(isWorldObjectVisible(chest, [], IDLE_INTERACTION, false)).toBe(false);
        expect(isWorldObjectVisible(chest, [claimChest], IDLE_INTERACTION, false)).toBe(true);
        expect(worldObjectVariant(chest, IDLE_INTERACTION, false)).toBe(WorldObjectVariant.REST);

        const approaching = beginInteraction(
            IDLE_INTERACTION,
            claimChest,
            worldObjectApproachPose(chest),
        );
        expect(isWorldObjectVisible(chest, [claimChest], approaching, false)).toBe(true);

        const executing = beginExecution(approaching, approaching.pose.position, 0, 0.9);
        expect(worldObjectVariant(chest, executing, false)).toBe(WorldObjectVariant.ACTIVATED);

        expect(isWorldObjectVisible(chest, [], IDLE_INTERACTION, true)).toBe(true);
        expect(worldObjectVariant(chest, IDLE_INTERACTION, true)).toBe(
            WorldObjectVariant.ACTIVATED,
        );
    });
});

describe("interactions", () => {
    const phaseId = createPhaseId("first");
    const lever = createWorldObject(
        createWorldObjectId(1),
        WorldObjectKind.LEVER,
        createWorldPosition(10, 0, 0),
        1,
    );
    const approachPose = worldObjectApproachPose(lever);
    const interaction = createInteraction(
        createInteractionId("start_first"),
        lever.id,
        "Pull Lever",
        { kind: "START_PHASE", phaseId },
        123,
    );

    it("begins approaching at the object's approach pose", () => {
        const approaching = beginInteraction(IDLE_INTERACTION, interaction, approachPose);
        expect(approaching.pose).toBe(approachPose);
    });

    it("requires the exact approach position before executing and only emits actions on completion", () => {
        const approaching = beginInteraction(IDLE_INTERACTION, interaction, approachPose);

        expect(() =>
            beginExecution(
                approaching,
                createWorldPosition(approachPose.position.x + 1, approachPose.position.y, 0),
                10,
                1.5,
            ),
        ).toThrow(RangeError);

        const executing = beginExecution(approaching, approachPose.position, 10, 1.5);
        expect(executing.kind).toBe("EXECUTING");
        expect(executing.completesAtSeconds).toBe(11.5);
        expect(() => completeInteraction(executing, 11.49)).toThrow(RangeError);
        expect(completeInteraction(executing, 11.5)).toEqual({
            state: IDLE_INTERACTION,
            action: { kind: "START_PHASE", phaseId },
        });
    });

    it("cancels an approach without emitting its action", () => {
        const approaching = beginInteraction(IDLE_INTERACTION, interaction, approachPose);

        expect(cancelInteraction(approaching)).toBe(IDLE_INTERACTION);
    });

    it("rejects a non-positive execution duration", () => {
        const approaching = beginInteraction(IDLE_INTERACTION, interaction, approachPose);
        expect(() => beginExecution(approaching, approachPose.position, 10, 0)).toThrow(RangeError);
    });

    it("rejects an empty label", () => {
        expect(() =>
            createInteraction(
                createInteractionId("blank"),
                lever.id,
                "  ",
                { kind: "START_PHASE", phaseId },
                1,
            ),
        ).toThrow(TypeError);
    });
});
