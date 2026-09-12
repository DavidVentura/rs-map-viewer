import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";

export enum AnimationPlayback {
    LOOP = 0,
    ONCE = 1,
}

// A sequence's frame lengths in client ticks (20 ms), read from the cache once. An empty list is a
// sequence without frame data, which counts as already finished.
export type SeqTiming = {
    readonly seqId: number;
    readonly frameTicks: readonly number[];
};

export function loadSeqTiming(
    seqId: number,
    seqTypeLoader: SeqTypeLoader,
    seqFrameLoader: SeqFrameLoader,
): SeqTiming {
    const sequence = seqTypeLoader.load(seqId);
    const frameCount = sequence.frameIds?.length ?? 0;
    const frameTicks = Array.from({ length: frameCount }, (_, frame) =>
        sequence.getFrameLength(seqFrameLoader, frame),
    );
    return { seqId, frameTicks };
}

export class AnimationState {
    frame = 0;

    private frameTime = 0;

    constructor(private seq: SeqTiming) {}

    get seqId(): number {
        return this.seq.seqId;
    }

    setSequence(seq: SeqTiming): void {
        if (this.seq.seqId === seq.seqId) {
            return;
        }
        this.restart(seq);
    }

    restart(seq: SeqTiming): void {
        this.seq = seq;
        this.frame = 0;
        this.frameTime = 0;
    }

    advance(
        deltaTimeSeconds: number,
        playback: AnimationPlayback = AnimationPlayback.LOOP,
        speed: number = 1,
    ): boolean {
        const { frameTicks } = this.seq;
        if (frameTicks.length === 0) {
            return true;
        }

        let completed = false;
        this.frameTime += (deltaTimeSeconds / 0.02) * speed;
        while (this.frameTime > frameTicks[this.frame]) {
            if (playback === AnimationPlayback.ONCE && this.frame === frameTicks.length - 1) {
                completed = true;
                break;
            }
            this.frameTime -= frameTicks[this.frame];
            this.frame = (this.frame + 1) % frameTicks.length;
            completed ||= playback === AnimationPlayback.LOOP && this.frame === 0;
        }
        return completed;
    }
}

export function sequenceDurationSeconds(seq: SeqTiming): number {
    return seq.frameTicks.reduce((total, ticks) => total + ticks, 0) * 0.02;
}

// Seconds from the start of the sequence (at natural speed) until `frame` is first displayed,
// i.e. the summed lengths of the frames before it.
export function sequenceTimeToFrameSeconds(seq: SeqTiming, frame: number): number {
    const frameCount = seq.frameTicks.length;
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
        throw new Error(`Frame ${frame} is outside sequence ${seq.seqId} (${frameCount} frames)`);
    }
    return seq.frameTicks.slice(0, frame).reduce((total, ticks) => total + ticks, 0) * 0.02;
}
