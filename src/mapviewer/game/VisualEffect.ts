import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";

export enum VisualEffectKind {
    MAGIC_HIT = 0,
    ICE_BARRAGE_HIT = 1,
    JAD_FIRE_HIT = 2,
    TZHAAR_HEAL = 3,
}

export const ICE_BARRAGE_HIT_SEQ_ID = 1965;
export const TZHAAR_HEAL_SEQ_ID = 2640;

export class VisualEffect {
    readonly animation: AnimationState;

    constructor(
        readonly kind: VisualEffectKind,
        readonly level: number,
        readonly x: number,
        readonly y: number,
        readonly height: number,
        seqId: number,
        private readonly holdUntilSeconds?: number,
    ) {
        this.animation = new AnimationState(seqId);
    }

    update(
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        timeSeconds: number,
    ): boolean {
        const completed = this.animation.advance(
            deltaTimeSeconds,
            seqTypeLoader,
            seqFrameLoader,
            AnimationPlayback.ONCE,
        );
        if (this.holdUntilSeconds === undefined) {
            return !completed;
        }
        return timeSeconds < this.holdUntilSeconds;
    }
}
