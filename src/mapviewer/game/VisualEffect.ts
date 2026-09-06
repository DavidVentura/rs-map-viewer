import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";

export enum VisualEffectKind {
    MAGIC_HIT = 0,
}

export class VisualEffect {
    readonly animation: AnimationState;

    constructor(
        readonly kind: VisualEffectKind,
        readonly level: number,
        readonly x: number,
        readonly y: number,
        readonly height: number,
        seqId: number,
    ) {
        this.animation = new AnimationState(seqId);
    }

    update(
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): boolean {
        const completed = this.animation.advance(
            deltaTimeSeconds,
            seqTypeLoader,
            seqFrameLoader,
            AnimationPlayback.ONCE,
        );
        return !completed;
    }
}
