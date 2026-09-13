import { CacheInfo } from "../../rs/cache/CacheInfo";
import { SeqType } from "../../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SeqTransformType } from "../../rs/model/seq/SeqTransformType";
import { SKELETAL_TAIL_HOLD_FRAMES } from "../../rs/model/skeletal/SkeletalPlayback";
import { SkeletalSeq } from "../../rs/model/skeletal/SkeletalSeq";
import { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import {
    SeqTiming,
    SeqTimingLoaders,
    loadSeqTiming,
    sequenceDurationSeconds,
    sequenceTimeToFrameSeconds,
    sequenceTimeToLastFrameSeconds,
} from "./Animation";

const seqFrameLoader = {} as SeqFrameLoader;
const noSkeletalSeqs = {} as SkeletalSeqLoader;

// Seq 426's bow shot frame lengths in client ticks (20ms each).
const BOW_SHOT: SeqTiming = { seqId: 426, frameTicks: [4, 4, 4, 4, 15, 10, 5, 4, 4, 4] };
const NO_FRAMES: SeqTiming = { seqId: 1, frameTicks: [] };

const CACHE_INFO: CacheInfo = {
    name: "test",
    game: "oldschool",
    environment: "live",
    revision: 240,
    timestamp: "",
    size: 0,
};

function oldStyleLoaders(seqTypeLoader: SeqTypeLoader): SeqTimingLoaders {
    return { seqTypeLoader, seqFrameLoader, skeletalSeqLoader: noSkeletalSeqs };
}

function skeletalSeqType(skeletalStart: number, skeletalEnd: number): SeqType {
    const seqType = new SeqType(9654, CACHE_INFO);
    seqType.skeletalId = 77;
    seqType.skeletalStart = skeletalStart;
    seqType.skeletalEnd = skeletalEnd;
    return seqType;
}

// One bone curve that moves until tick `movesUntil` and holds after it.
function skeletalLoaders(seqType: SeqType, movesUntil: number): SeqTimingLoaders {
    const seq = {
        id: 77,
        boneCurves: [[{ getValue: (tick: number) => Math.min(tick, movesUntil) }]],
        curves: [],
        base: { count: 1, types: [SeqTransformType.ROTATE], labels: [[0]] },
    } as unknown as SkeletalSeq;
    return {
        seqTypeLoader: { load: () => seqType } as unknown as SeqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader: {
            load: (id: number) => (id === 77 ? seq : undefined),
        } as SkeletalSeqLoader,
    };
}

describe("loadSeqTiming", () => {
    it("reads every frame's length from the cache", () => {
        const loader = {
            load: () => ({
                isSkeletalSeq: () => false,
                frameIds: BOW_SHOT.frameTicks.map((_, index) => index),
                getFrameLength: (_loader: SeqFrameLoader, frame: number) =>
                    BOW_SHOT.frameTicks[frame],
            }),
        } as unknown as SeqTypeLoader;
        expect(loadSeqTiming(426, oldStyleLoaders(loader))).toEqual(BOW_SHOT);
    });

    it("has no frames for a sequence without frame data", () => {
        const loader = {
            load: () => ({ isSkeletalSeq: () => false, frameIds: undefined }),
        } as unknown as SeqTypeLoader;
        expect(loadSeqTiming(1, oldStyleLoaders(loader))).toEqual(NO_FRAMES);
    });

    it("plays a skeletal sequence one client tick per frame, trimmed after it settles", () => {
        const seqType = skeletalSeqType(0, 1000);
        const timing = loadSeqTiming(9654, skeletalLoaders(seqType, 40));
        expect(timing.frameTicks).toEqual(new Array(41 + SKELETAL_TAIL_HOLD_FRAMES).fill(1));
    });

    it("rejects a skeletal sequence that does not start at tick 0", () => {
        const seqType = skeletalSeqType(5, 1000);
        expect(() => loadSeqTiming(9654, skeletalLoaders(seqType, 40))).toThrow(/starts at tick 5/);
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

describe("sequenceTimeToLastFrameSeconds", () => {
    it("ignores how long the last frame is held", () => {
        const death: SeqTiming = { seqId: 2627, frameTicks: [4, 4, 5, 3, 20000] };
        expect(sequenceTimeToLastFrameSeconds(death)).toBeCloseTo(0.32);
    });

    it("is zero for a sequence without frames", () => {
        expect(sequenceTimeToLastFrameSeconds(NO_FRAMES)).toBe(0);
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
