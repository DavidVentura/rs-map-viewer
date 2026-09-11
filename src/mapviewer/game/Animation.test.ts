import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { sequenceDurationSeconds, sequenceTimeToFrameSeconds } from "./Animation";

const seqFrameLoader = {} as SeqFrameLoader;

// Frame lengths in client ticks (20ms each), e.g. seq 426's bow shot is 4,4,4,4,15,10,5,4,4,4.
function loaderWithFrameTicks(ticks: readonly number[]): SeqTypeLoader {
    return {
        load: () => ({
            frameIds: ticks.map((_, index) => index),
            getFrameLength: (_loader: SeqFrameLoader, frame: number) => ticks[frame],
        }),
    } as unknown as SeqTypeLoader;
}

describe("sequenceDurationSeconds", () => {
    it("sums every frame's ticks at 20ms per tick", () => {
        const loader = loaderWithFrameTicks([4, 4, 4, 4, 15, 10, 5, 4, 4, 4]);
        expect(sequenceDurationSeconds(426, loader, seqFrameLoader)).toBeCloseTo(1.16);
    });

    it("is zero for a sequence without frames", () => {
        const loader = { load: () => ({ frameIds: undefined }) } as unknown as SeqTypeLoader;
        expect(sequenceDurationSeconds(1, loader, seqFrameLoader)).toBe(0);
    });
});

describe("sequenceTimeToFrameSeconds", () => {
    const loader = loaderWithFrameTicks([4, 4, 4, 4, 15, 10, 5, 4, 4, 4]);

    it("is zero for the first frame", () => {
        expect(sequenceTimeToFrameSeconds(426, 0, loader, seqFrameLoader)).toBe(0);
    });

    it("sums only the frames before the requested one", () => {
        expect(sequenceTimeToFrameSeconds(426, 5, loader, seqFrameLoader)).toBeCloseTo(0.62);
        expect(sequenceTimeToFrameSeconds(426, 9, loader, seqFrameLoader)).toBeCloseTo(1.08);
    });

    it("rejects a frame outside the sequence", () => {
        expect(() => sequenceTimeToFrameSeconds(426, 10, loader, seqFrameLoader)).toThrow();
        expect(() => sequenceTimeToFrameSeconds(426, -1, loader, seqFrameLoader)).toThrow();
        expect(() => sequenceTimeToFrameSeconds(426, 2.5, loader, seqFrameLoader)).toThrow();
    });

    it("rejects any frame of a sequence without frames", () => {
        const empty = { load: () => ({ frameIds: undefined }) } as unknown as SeqTypeLoader;
        expect(() => sequenceTimeToFrameSeconds(1, 0, empty, seqFrameLoader)).toThrow();
    });
});
