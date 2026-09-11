import { AnimationFrames } from "../AnimationFrames";

export type LocAnimatedData = {
    drawRangeIndex: number;
    drawRangeAlphaIndex: number;

    anim: AnimationFrames;

    seqId: number;
    randomStart: boolean;
};
