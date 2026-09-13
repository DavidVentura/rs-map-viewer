import { CacheInfo } from "../../cache/CacheInfo";
import { SeqType } from "../../config/seqtype/SeqType";
import {
    FrameSampledCurve,
    SKELETAL_TAIL_HOLD_FRAMES,
    loadSkeletalPlayback,
    playedFrameCount,
} from "./SkeletalPlayback";
import { SkeletalSeqLoader } from "./SkeletalSeqLoader";

function movingUntil(lastMovingTick: number): FrameSampledCurve {
    return { getValue: (tick) => Math.min(tick, lastMovingTick) * 0.1 };
}

const STILL: FrameSampledCurve = { getValue: () => 0.5 };

describe("playedFrameCount", () => {
    it("keeps the motion and a bounded hold of the pose it settles on", () => {
        expect(playedFrameCount([movingUntil(40)], 1000)).toBe(41 + SKELETAL_TAIL_HOLD_FRAMES);
    });

    it("follows whichever curve changes last", () => {
        expect(playedFrameCount([movingUntil(40), movingUntil(300), STILL], 1000)).toBe(
            301 + SKELETAL_TAIL_HOLD_FRAMES,
        );
    });

    it("never plays past the sequence's own length", () => {
        expect(playedFrameCount([movingUntil(90)], 120)).toBe(120);
    });

    it("holds a still sequence's only pose for the bounded hold", () => {
        expect(playedFrameCount([STILL], 1000)).toBe(1 + SKELETAL_TAIL_HOLD_FRAMES);
        expect(playedFrameCount([], 1000)).toBe(1 + SKELETAL_TAIL_HOLD_FRAMES);
    });

    it("counts a curve snapping back after its last key as a change", () => {
        const snapsBack: FrameSampledCurve = { getValue: (tick) => (tick <= 500 ? 1 : 0) };
        expect(playedFrameCount([snapsBack], 1000)).toBe(502 + SKELETAL_TAIL_HOLD_FRAMES);
    });

    it("plays nothing of an empty sequence", () => {
        expect(playedFrameCount([movingUntil(40)], 0)).toBe(0);
    });
});

describe("loadSkeletalPlayback", () => {
    it("fails when the pack lacks the sequence's keyframes", () => {
        const seqType = new SeqType(9654, {
            name: "test",
            game: "oldschool",
            environment: "live",
            revision: 240,
            timestamp: "",
            size: 0,
        } as CacheInfo);
        seqType.skeletalId = 77;
        seqType.skeletalEnd = 100;
        const loader = { load: () => undefined } as unknown as SkeletalSeqLoader;

        expect(() => loadSkeletalPlayback(seqType, loader)).toThrow(
            "Skeletal seq 77 of seq 9654 is missing from the cache",
        );
    });
});
