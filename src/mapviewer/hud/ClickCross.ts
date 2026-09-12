// The OSRS click cross: a small animated marker at the point clicked, yellow for a plain "walk
// here" and red for an action (attack, take, pull, open) - see assets/HudAssets.ts for the sprite
// it is decoded from.
export enum ClickCrossKind {
    WALK = "WALK",
    ACTION = "ACTION",
}

// Exactly 4 frames per kind, so the frame count is enforced by the type rather than checked at
// each call site.
export type CrossFrameSet = readonly [
    CanvasImageSource,
    CanvasImageSource,
    CanvasImageSource,
    CanvasImageSource,
];

export type CrossSprites = Readonly<Record<ClickCrossKind, CrossFrameSet>>;

export const CLICK_CROSS_FRAMES_PER_KIND = 4;
export const CLICK_CROSS_FRAME_SECONDS = 0.1;
export const CLICK_CROSS_DURATION_SECONDS =
    CLICK_CROSS_FRAMES_PER_KIND * CLICK_CROSS_FRAME_SECONDS;

// The frame to show at `ageSeconds` since the cross was spawned, or undefined once its animation
// (CLICK_CROSS_FRAMES_PER_KIND frames at CLICK_CROSS_FRAME_SECONDS each) has finished.
export function clickCrossFrameIndex(ageSeconds: number): number | undefined {
    if (ageSeconds < 0 || ageSeconds >= CLICK_CROSS_DURATION_SECONDS) {
        return undefined;
    }
    return Math.floor(ageSeconds / CLICK_CROSS_FRAME_SECONDS);
}

// What a press resolved to, in the same terms the renderer's own input builders already computed
// (buildMovementInput/buildCombatInput/buildPickupInput/buildInteractionInput) - deriving the cross
// from a second hit test would risk disagreeing with what the click actually did. A press captured
// by the right-click menu (opening it, or selecting/cancelling an entry) shows no cross of its own;
// a selected entry shows one later, at the menu's anchor, once its queued action reaches the sim
// (see WebGLMapViewerRenderer.updateClickCross).
export type PressResolution = {
    readonly capturedByMenu: boolean;
    readonly interactionStarted: boolean;
    readonly attackingEnemy: boolean;
    readonly pickingUpItem: boolean;
    readonly moving: boolean;
};

export function classifyPressCross(resolution: PressResolution): ClickCrossKind | undefined {
    if (resolution.capturedByMenu) {
        return undefined;
    }
    if (resolution.interactionStarted || resolution.attackingEnemy || resolution.pickingUpItem) {
        return ClickCrossKind.ACTION;
    }
    if (resolution.moving) {
        return ClickCrossKind.WALK;
    }
    return undefined;
}

// What a click resolved to, before it's turned into a playing/pending cross - the renderer's own
// screen-space press point plus the kind classifyPressCross (or the menu path) already picked.
export type ClickCrossSpawn = {
    readonly kind: ClickCrossKind;
    readonly screenX: number;
    readonly screenY: number;
};

type ActiveClickCross = ClickCrossSpawn & { readonly startTimeSeconds: number };

// A rate-limited player for click crosses: at most one cross plays at a time, and at most one more
// is remembered to play once it finishes (never a growing queue) - see requestClickCross.
export type ClickCrossPlaybackState =
    | { readonly kind: "IDLE" }
    | {
          readonly kind: "PLAYING";
          readonly active: ActiveClickCross;
          readonly pending?: ClickCrossSpawn;
      };

export const IDLE_CLICK_CROSS_STATE: ClickCrossPlaybackState = { kind: "IDLE" };

// A click that resolved to a cross: starts playing immediately if nothing is animating, otherwise
// replaces whatever cross (if any) was already waiting to play next - a spam of clicks while one
// plays never grows a queue, only the latest click's cross plays once the current one finishes.
export function requestClickCross(
    state: ClickCrossPlaybackState,
    spawn: ClickCrossSpawn,
    nowSeconds: number,
): ClickCrossPlaybackState {
    if (state.kind === "IDLE") {
        return { kind: "PLAYING", active: { ...spawn, startTimeSeconds: nowSeconds } };
    }
    return { ...state, pending: spawn };
}

// Advances playback to `nowSeconds`: once the active cross's animation has run to completion, the
// pending cross (if any) starts right away, otherwise playback returns to idle. Must be called
// once per frame regardless of whether a click happened this frame, so a finished animation hands
// off to its pending cross without waiting for the next click to notice.
export function advanceClickCross(
    state: ClickCrossPlaybackState,
    nowSeconds: number,
): ClickCrossPlaybackState {
    if (state.kind === "IDLE") {
        return state;
    }
    if (clickCrossFrameIndex(nowSeconds - state.active.startTimeSeconds) !== undefined) {
        return state;
    }
    if (!state.pending) {
        return IDLE_CLICK_CROSS_STATE;
    }
    return { kind: "PLAYING", active: { ...state.pending, startTimeSeconds: nowSeconds } };
}

// The cross to display right now (undefined while idle) - call after advanceClickCross so a just-
// finished animation's hand-off to its pending cross is already reflected.
export function currentClickCrossFrame(
    state: ClickCrossPlaybackState,
    nowSeconds: number,
): (ClickCrossSpawn & { readonly frameIndex: number }) | undefined {
    if (state.kind === "IDLE") {
        return undefined;
    }
    const frameIndex = clickCrossFrameIndex(nowSeconds - state.active.startTimeSeconds);
    if (frameIndex === undefined) {
        return undefined;
    }
    const { kind, screenX, screenY } = state.active;
    return { kind, screenX, screenY, frameIndex };
}
