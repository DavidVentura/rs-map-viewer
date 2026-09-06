import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";

export enum AnimationPlayback {
    LOOP = 0,
    ONCE = 1,
}

export class AnimationState {
    seqId: number;
    frame = 0;

    private frameTime = 0;

    constructor(initialSeqId: number) {
        this.seqId = initialSeqId;
    }

    setSequence(seqId: number): void {
        if (this.seqId === seqId) {
            return;
        }
        this.restart(seqId);
    }

    restart(seqId: number): void {
        this.seqId = seqId;
        this.frame = 0;
        this.frameTime = 0;
    }

    advance(
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        playback: AnimationPlayback = AnimationPlayback.LOOP,
        speed: number = 1,
    ): boolean {
        if (this.seqId === -1) {
            return false;
        }
        const sequence = seqTypeLoader.load(this.seqId);
        if (!sequence.frameIds || sequence.frameIds.length === 0) {
            return true;
        }

        let completed = false;
        this.frameTime += (deltaTimeSeconds / 0.02) * speed;
        while (this.frameTime > sequence.getFrameLength(seqFrameLoader, this.frame)) {
            if (
                playback === AnimationPlayback.ONCE &&
                this.frame === sequence.frameIds.length - 1
            ) {
                completed = true;
                break;
            }
            this.frameTime -= sequence.getFrameLength(seqFrameLoader, this.frame);
            this.frame = (this.frame + 1) % sequence.frameIds.length;
            completed ||= playback === AnimationPlayback.LOOP && this.frame === 0;
        }
        return completed;
    }
}

export function sequenceDurationSeconds(
    seqId: number,
    seqTypeLoader: SeqTypeLoader,
    seqFrameLoader: SeqFrameLoader,
): number {
    const sequence = seqTypeLoader.load(seqId);
    if (!sequence.frameIds) {
        return 0;
    }
    let total = 0;
    for (let frame = 0; frame < sequence.frameIds.length; frame++) {
        total += sequence.getFrameLength(seqFrameLoader, frame);
    }
    return total * 0.02;
}
