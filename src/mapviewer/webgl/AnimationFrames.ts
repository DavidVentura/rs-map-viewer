import { DrawRange } from "./DrawRange";

export type AnimationFrames = {
    frames: DrawRange[];
    framesAlpha: DrawRange[] | undefined;
};

export type SeqAnimation = {
    seqId: number;
    anim: AnimationFrames;
};

export function resolveAnimationFrames(
    seqId: number,
    animations: readonly SeqAnimation[],
    fallback: AnimationFrames,
): AnimationFrames {
    for (const animation of animations) {
        if (animation.seqId === seqId) {
            return animation.anim;
        }
    }
    return fallback;
}
