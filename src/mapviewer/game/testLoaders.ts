import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";

export type StubSequenceLoaders = {
    readonly seqTypeLoader: SeqTypeLoader;
    readonly seqFrameLoader: SeqFrameLoader;
};

export const STUB_FRAME_COUNT = 20;
export const STUB_TICKS_PER_FRAME = 4;
export const STUB_FRAME_SECONDS = STUB_TICKS_PER_FRAME * 0.02;

// Test stand-in for the cache's sequence loaders: every sequence id has STUB_FRAME_COUNT frames of
// STUB_TICKS_PER_FRAME ticks each, so a contact frame N resolves at N * STUB_FRAME_SECONDS at
// castSpeed 1 and every sequence lasts STUB_FRAME_COUNT * STUB_FRAME_SECONDS.
export function stubSequenceLoaders(): StubSequenceLoaders {
    const sequence = {
        frameIds: new Array<number>(STUB_FRAME_COUNT).fill(0),
        getFrameLength: () => STUB_TICKS_PER_FRAME,
    };
    return {
        seqTypeLoader: { load: () => sequence } as unknown as SeqTypeLoader,
        seqFrameLoader: {} as SeqFrameLoader,
    };
}
