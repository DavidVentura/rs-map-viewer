import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import { SeqTimingLoaders } from "./Animation";
import { loadSeqCatalog } from "./SeqCatalog";

function loaderWithSeqs(seqIds: readonly number[]): SeqTimingLoaders {
    const seqTypeLoader = {
        load: (seqId: number) => {
            if (!seqIds.includes(seqId)) {
                throw new Error(`SeqType ${seqId} is missing from config archive 12`);
            }
            return { isSkeletalSeq: () => false, frameIds: [0, 1], getFrameLength: () => 3 };
        },
    } as unknown as SeqTypeLoader;
    return {
        seqTypeLoader,
        seqFrameLoader: {} as SeqFrameLoader,
        skeletalSeqLoader: {} as SkeletalSeqLoader,
    };
}

describe("loadSeqCatalog", () => {
    it("hands out the timing of every declared sequence", () => {
        const catalog = loadSeqCatalog([7, 9], loaderWithSeqs([7, 9]));
        expect(catalog.get(9)).toEqual({ seqId: 9, frameTicks: [3, 3] });
    });

    it("throws for a sequence the game uses without declaring it", () => {
        const catalog = loadSeqCatalog([7], loaderWithSeqs([7, 834]));
        expect(() => catalog.get(834)).toThrow(/834 is used by the game but not declared/);
    });

    it("fails while loading when a declared sequence is missing from the pack", () => {
        expect(() => loadSeqCatalog([7, 8], loaderWithSeqs([7]))).toThrow(/SeqType 8/);
    });
});
