import {
    CLICK_CROSS_DURATION_SECONDS,
    CLICK_CROSS_FRAME_SECONDS,
    ClickCrossKind,
    IDLE_CLICK_CROSS_STATE,
    advanceClickCross,
    classifyPressCross,
    clickCrossFrameIndex,
    currentClickCrossFrame,
    requestClickCross,
} from "./ClickCross";

describe("clickCrossFrameIndex", () => {
    it("steps through every frame across the animation's duration", () => {
        expect(clickCrossFrameIndex(0)).toBe(0);
        expect(clickCrossFrameIndex(CLICK_CROSS_FRAME_SECONDS * 0.5)).toBe(0);
        expect(clickCrossFrameIndex(CLICK_CROSS_FRAME_SECONDS)).toBe(1);
        expect(clickCrossFrameIndex(CLICK_CROSS_FRAME_SECONDS * 2)).toBe(2);
        expect(clickCrossFrameIndex(CLICK_CROSS_FRAME_SECONDS * 3)).toBe(3);
    });

    it("expires once the duration has elapsed", () => {
        expect(clickCrossFrameIndex(CLICK_CROSS_DURATION_SECONDS - 0.001)).toBe(3);
        expect(clickCrossFrameIndex(CLICK_CROSS_DURATION_SECONDS)).toBeUndefined();
        expect(clickCrossFrameIndex(CLICK_CROSS_DURATION_SECONDS + 1)).toBeUndefined();
    });

    it("rejects an age before the cross was spawned", () => {
        expect(clickCrossFrameIndex(-0.001)).toBeUndefined();
    });
});

describe("classifyPressCross", () => {
    const BASE = {
        capturedByMenu: false,
        interactionStarted: false,
        attackingEnemy: false,
        pickingUpItem: false,
        moving: false,
    };

    it("shows no cross for a press the menu captured, regardless of what else it resolved to", () => {
        expect(classifyPressCross({ ...BASE, capturedByMenu: true, moving: true })).toBeUndefined();
    });

    it("shows a walk cross for a press that only started movement", () => {
        expect(classifyPressCross({ ...BASE, moving: true })).toBe(ClickCrossKind.WALK);
    });

    it("shows an action cross for a press that started an interaction", () => {
        expect(classifyPressCross({ ...BASE, interactionStarted: true })).toBe(
            ClickCrossKind.ACTION,
        );
    });

    it("shows an action cross for a press that attacked an enemy", () => {
        expect(classifyPressCross({ ...BASE, attackingEnemy: true })).toBe(ClickCrossKind.ACTION);
    });

    it("shows an action cross for a press that picked up an item", () => {
        expect(classifyPressCross({ ...BASE, pickingUpItem: true })).toBe(ClickCrossKind.ACTION);
    });

    it("prefers an action cross over movement when a press somehow resolves to both", () => {
        expect(classifyPressCross({ ...BASE, interactionStarted: true, moving: true })).toBe(
            ClickCrossKind.ACTION,
        );
    });

    it("shows no cross for a press that resolved to nothing", () => {
        expect(classifyPressCross(BASE)).toBeUndefined();
    });
});

describe("click cross playback state", () => {
    const WALK_SPAWN = { kind: ClickCrossKind.WALK, screenX: 10, screenY: 20 };
    const ACTION_SPAWN = { kind: ClickCrossKind.ACTION, screenX: 30, screenY: 40 };

    it("plays a cross to the end and returns to idle with nothing pending", () => {
        let state = requestClickCross(IDLE_CLICK_CROSS_STATE, WALK_SPAWN, 0);

        state = advanceClickCross(state, CLICK_CROSS_DURATION_SECONDS - 0.001);
        expect(currentClickCrossFrame(state, CLICK_CROSS_DURATION_SECONDS - 0.001)).toEqual({
            ...WALK_SPAWN,
            frameIndex: 3,
        });

        state = advanceClickCross(state, CLICK_CROSS_DURATION_SECONDS);
        expect(state).toEqual(IDLE_CLICK_CROSS_STATE);
        expect(currentClickCrossFrame(state, CLICK_CROSS_DURATION_SECONDS)).toBeUndefined();
    });

    it("starts a cross immediately from idle at frame 0", () => {
        const state = requestClickCross(IDLE_CLICK_CROSS_STATE, WALK_SPAWN, 5);
        expect(currentClickCrossFrame(state, 5)).toEqual({ ...WALK_SPAWN, frameIndex: 0 });
    });

    it("queues a click that arrives while one is playing instead of restarting it", () => {
        let state = requestClickCross(IDLE_CLICK_CROSS_STATE, WALK_SPAWN, 0);
        const midPlayTime = CLICK_CROSS_FRAME_SECONDS * 1.5;

        state = requestClickCross(state, ACTION_SPAWN, midPlayTime);

        // The playing cross is untouched - no restart, still WALK's frame at this age.
        expect(currentClickCrossFrame(state, midPlayTime)).toEqual({ ...WALK_SPAWN, frameIndex: 1 });
    });

    it("replaces a previously queued pending cross with the latest click, never growing a queue", () => {
        let state = requestClickCross(IDLE_CLICK_CROSS_STATE, WALK_SPAWN, 0);
        state = requestClickCross(state, ACTION_SPAWN, CLICK_CROSS_FRAME_SECONDS);
        const thirdSpawn = { kind: ClickCrossKind.WALK, screenX: 99, screenY: 99 };
        state = requestClickCross(state, thirdSpawn, CLICK_CROSS_FRAME_SECONDS * 2);

        state = advanceClickCross(state, CLICK_CROSS_DURATION_SECONDS);

        expect(currentClickCrossFrame(state, CLICK_CROSS_DURATION_SECONDS)).toEqual({
            ...thirdSpawn,
            frameIndex: 0,
        });
    });

    it("starts the pending cross right after the current one finishes", () => {
        let state = requestClickCross(IDLE_CLICK_CROSS_STATE, WALK_SPAWN, 0);
        state = requestClickCross(state, ACTION_SPAWN, CLICK_CROSS_FRAME_SECONDS);

        // Still mid-animation: the pending cross must not have started yet.
        state = advanceClickCross(state, CLICK_CROSS_DURATION_SECONDS - 0.001);
        expect(currentClickCrossFrame(state, CLICK_CROSS_DURATION_SECONDS - 0.001)).toEqual({
            ...WALK_SPAWN,
            frameIndex: 3,
        });

        // The instant the active cross finishes, the pending one takes over at frame 0.
        state = advanceClickCross(state, CLICK_CROSS_DURATION_SECONDS);
        expect(currentClickCrossFrame(state, CLICK_CROSS_DURATION_SECONDS)).toEqual({
            ...ACTION_SPAWN,
            frameIndex: 0,
        });
    });

    it("does nothing on advance when there's no pending cross once the current one finishes", () => {
        let state = requestClickCross(IDLE_CLICK_CROSS_STATE, WALK_SPAWN, 0);

        state = advanceClickCross(state, CLICK_CROSS_DURATION_SECONDS);

        expect(state).toEqual(IDLE_CLICK_CROSS_STATE);
        state = advanceClickCross(state, CLICK_CROSS_DURATION_SECONDS + 10);
        expect(state).toEqual(IDLE_CLICK_CROSS_STATE);
    });

    it("stays idle when advanced without ever receiving a click", () => {
        expect(advanceClickCross(IDLE_CLICK_CROSS_STATE, 42)).toEqual(IDLE_CLICK_CROSS_STATE);
    });
});
