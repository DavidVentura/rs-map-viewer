import { AnimationFrames, resolveAnimationFrames } from "../AnimationFrames";

export type PlayerRenderData = {
    x: number;
    y: number;
    level: number;
    id: number;
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames;
    runAnim: AnimationFrames;
    attackAnim: AnimationFrames;
    idleSeqId: number;
    walkSeqId: number;
    runSeqId: number;
    attackSeqId: number;
};

export function getPlayerAnimationFrames(data: PlayerRenderData, seqId: number): AnimationFrames {
    return resolveAnimationFrames(
        seqId,
        [
            { seqId: data.walkSeqId, anim: data.walkAnim },
            { seqId: data.runSeqId, anim: data.runAnim },
            { seqId: data.attackSeqId, anim: data.attackAnim },
        ],
        data.idleAnim,
    );
}
