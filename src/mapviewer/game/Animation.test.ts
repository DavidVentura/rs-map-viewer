import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import {
    SeqTiming,
    loadSeqTiming,
    sequenceDurationSeconds,
    sequenceTimeToFrameSeconds,
} from "./Animation";

const seqFrameLoader = {} as SeqFrameLoader;

// Seq 426's bow shot frame lengths in client ticks (20ms each).
const BOW_SHOT: SeqTiming = { seqId: 426, frameTicks: [4, 4, 4, 4, 15, 10, 5, 4, 4, 4] };
const NO_FRAMES: SeqTiming = { seqId: 1, frameTicks: [] };

describe("loadSeqTiming", () => {
    it("reads every frame's length from the cache", () => {
        const loader = {
            load: () => ({
                frameIds: BOW_SHOT.frameTicks.map((_, index) => index),
                getFrameLength: (_loader: SeqFrameLoader, frame: number) =>
                    BOW_SHOT.frameTicks[frame],
            }),
        } as unknown as SeqTypeLoader;
        expect(loadSeqTiming(426, loader, seqFrameLoader)).toEqual(BOW_SHOT);
    });

    it("has no frames for a sequence without frame data", () => {
        const loader = { load: () => ({ frameIds: undefined }) } as unknown as SeqTypeLoader;
        expect(loadSeqTiming(1, loader, seqFrameLoader)).toEqual(NO_FRAMES);
    });
});

describe("sequenceDurationSeconds", () => {
    it("sums every frame's ticks at 20ms per tick", () => {
        expect(sequenceDurationSeconds(BOW_SHOT)).toBeCloseTo(1.16);
    });

    it("is zero for a sequence without frames", () => {
        expect(sequenceDurationSeconds(NO_FRAMES)).toBe(0);
    });
});

describe("sequenceTimeToFrameSeconds", () => {
    it("is zero for the first frame", () => {
        expect(sequenceTimeToFrameSeconds(BOW_SHOT, 0)).toBe(0);
    });

    it("sums only the frames before the requested one", () => {
        expect(sequenceTimeToFrameSeconds(BOW_SHOT, 5)).toBeCloseTo(0.62);
        expect(sequenceTimeToFrameSeconds(BOW_SHOT, 9)).toBeCloseTo(1.08);
    });

    it("rejects a frame outside the sequence", () => {
        expect(() => sequenceTimeToFrameSeconds(BOW_SHOT, 10)).toThrow();
        expect(() => sequenceTimeToFrameSeconds(BOW_SHOT, -1)).toThrow();
        expect(() => sequenceTimeToFrameSeconds(BOW_SHOT, 2.5)).toThrow();
    });

    it("rejects any frame of a sequence without frames", () => {
        expect(() => sequenceTimeToFrameSeconds(NO_FRAMES, 0)).toThrow();
    });
});
