import { ModelInfo } from "../buffer/SceneBuffer";
import { SkinAnimation } from "../skin/SkinAnimation";

export type LocAnimatedData = {
    placement: ModelInfo;
    animation: SkinAnimation;

    seqId: number;
    randomStart: boolean;
};
