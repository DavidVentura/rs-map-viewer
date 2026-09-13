import { createSoundEffectId } from "../../rs/sound/SoundEffect";
import { AnimationPlayback, AnimationProgress, AnimationState, SeqTiming } from "../game/Animation";
import { FrameSound, SeqFrameSounds } from "./FrameSounds";
import { crossedFrameSounds, frameSoundGain, heardSoundGain } from "./frameSoundCues";

function sound(soundId: number): FrameSound {
    return { soundId: createSoundEffectId(soundId), plays: 1, rangeTiles: 15 };
}

// Sounds on frames 0, 3 and 9 of a 10-frame sequence.
const SOUNDS: SeqFrameSounds = {
    frameCount: 10,
    byFrame: new Map([
        [0, sound(100)],
        [3, sound(103)],
        [9, sound(109)],
    ]),
};

function progress(framesEntered: number, play = 0): AnimationProgress {
    return { seqId: 1, play, framesEntered };
}

function soundIds(cues: readonly FrameSound[]): number[] {
    return cues.map((cue) => cue.soundId);
}

describe("crossedFrameSounds", () => {
    it("counts a play's first frame on its first reading", () => {
        expect(soundIds(crossedFrameSounds(SOUNDS, undefined, progress(0)))).toEqual([100]);
    });

    it("plays the frames entered after the previous reading up to the current one", () => {
        expect(soundIds(crossedFrameSounds(SOUNDS, progress(2), progress(3)))).toEqual([103]);
        expect(soundIds(crossedFrameSounds(SOUNDS, progress(3), progress(5)))).toEqual([]);
    });

    it("does not replay a frame the previous reading already covered", () => {
        expect(soundIds(crossedFrameSounds(SOUNDS, progress(3), progress(3)))).toEqual([]);
    });

    it("wraps around a loop into the next lap", () => {
        expect(soundIds(crossedFrameSounds(SOUNDS, progress(8), progress(13)))).toEqual([
            109, 100, 103,
        ]);
    });

    it("plays every frame a long step skipped over, lap after lap", () => {
        expect(soundIds(crossedFrameSounds(SOUNDS, progress(1), progress(23)))).toEqual([
            103, 109, 100, 103, 109, 100, 103,
        ]);
    });

    it("starts over from the first frame when the animation restarts", () => {
        expect(soundIds(crossedFrameSounds(SOUNDS, progress(7, 0), progress(4, 1)))).toEqual([
            100, 103,
        ]);
    });

    it("rejects a reading that went backwards within one play", () => {
        expect(() => crossedFrameSounds(SOUNDS, progress(5), progress(4))).toThrow();
    });

    it("follows an AnimationState through a long looping step and a one-shot's end", () => {
        // Frames of 2 client ticks (40 ms) each.
        const seq: SeqTiming = { seqId: 1, frameTicks: new Array(10).fill(2) };
        const animation = new AnimationState(seq);
        const first = animation.progress;
        expect(soundIds(crossedFrameSounds(SOUNDS, undefined, first))).toEqual([100]);

        // Two and a half laps in one step.
        animation.advance(25.5 * 0.04, AnimationPlayback.LOOP);
        const looped = animation.progress;
        expect(soundIds(crossedFrameSounds(SOUNDS, first, looped))).toEqual([
            103, 109, 100, 103, 109, 100, 103,
        ]);

        animation.restart(seq);
        const restarted = animation.progress;
        animation.advance(60 * 0.04, AnimationPlayback.ONCE);
        expect(soundIds(crossedFrameSounds(SOUNDS, looped, animation.progress))).toEqual([
            100, 103, 109,
        ]);
        expect(restarted.play).not.toBe(looped.play);
    });
});

describe("frameSoundGain", () => {
    const TILE = 128;
    // The centre of tile (10, 10).
    const SOURCE = { x: 10 * TILE + 64, y: 10 * TILE + 64 };

    it("plays an unpositioned sound at full volume anywhere", () => {
        expect(frameSoundGain(0, SOURCE, { x: 0, y: 0 })).toBe(1);
    });

    it("keeps full volume within the first tile", () => {
        expect(frameSoundGain(4, SOURCE, SOURCE)).toBe(1);
        expect(frameSoundGain(4, SOURCE, { x: SOURCE.x + TILE, y: SOURCE.y })).toBe(1);
    });

    it("fades linearly over the range by Manhattan distance", () => {
        const listener = { x: SOURCE.x + 2 * TILE, y: SOURCE.y + TILE };
        expect(frameSoundGain(4, SOURCE, listener)).toBeCloseTo(2 / 4);
    });

    it("fades to silence at the end of its range", () => {
        expect(frameSoundGain(4, SOURCE, { x: SOURCE.x + 4 * TILE, y: SOURCE.y })).toBe(1 / 4);
        expect(frameSoundGain(4, SOURCE, { x: SOURCE.x + 5 * TILE, y: SOURCE.y })).toBe(0);
        expect(frameSoundGain(4, SOURCE, { x: SOURCE.x + 9 * TILE, y: SOURCE.y })).toBe(0);
    });

    it("places the source on the tile centre it rounds down to", () => {
        const offCentre = { x: SOURCE.x + 60, y: SOURCE.y - 10 };
        const listener = { x: SOURCE.x + 3 * TILE, y: SOURCE.y };
        expect(frameSoundGain(4, offCentre, listener)).toBeCloseTo(
            frameSoundGain(4, SOURCE, listener) - 1 / 4,
        );
    });
});

describe("heardSoundGain", () => {
    const TILE = 128;
    const ranged = (rangeTiles: number) => ({ ...sound(100), rangeTiles });
    const LISTENER = { x: 10 * TILE + 64, y: 10 * TILE + 64 };
    // 17 tiles off by Manhattan distance, like a phantom at the back of an arena.
    const FAR = { x: LISTENER.x - 9 * TILE, y: LISTENER.y - 8 * TILE };

    it("keeps a sound's own positional fade when the encounter sets no minimum range", () => {
        expect(heardSoundGain(ranged(15), [FAR], LISTENER, 0)).toBe(0);
        const near = { x: LISTENER.x + 4 * TILE, y: LISTENER.y };
        expect(heardSoundGain(ranged(15), [near], LISTENER, 0)).toBeCloseTo(12 / 15);
    });

    it("stretches a sound to the encounter's minimum range so it carries across the arena", () => {
        expect(heardSoundGain(ranged(15), [FAR], LISTENER, 40)).toBeCloseTo(24 / 40);
    });

    it("keeps a sound's own range when it already carries further than the minimum", () => {
        expect(heardSoundGain(ranged(60), [FAR], LISTENER, 40)).toBeCloseTo(44 / 60);
    });

    it("leaves a non-positional sound at full volume", () => {
        expect(heardSoundGain(ranged(0), [FAR], LISTENER, 40)).toBe(1);
    });

    it("plays a sound heard from several points as loud as from the nearest", () => {
        const near = { x: LISTENER.x + 4 * TILE, y: LISTENER.y };
        expect(heardSoundGain(ranged(15), [FAR, near], LISTENER, 0)).toBeCloseTo(12 / 15);
    });
});
