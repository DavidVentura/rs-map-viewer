import { AnimationFrames, resolveAnimationFrames } from "../AnimationFrames";

export type EnemyRenderData = {
    id: number;
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames;
    deathAnim: AnimationFrames;
    idleSeqId: number;
    walkSeqId: number;
    deathSeqId: number;
};

export function getEnemyAnimationFrames(data: EnemyRenderData, seqId: number): AnimationFrames {
    return resolveAnimationFrames(
        seqId,
        [
            { seqId: data.walkSeqId, anim: data.walkAnim },
            { seqId: data.deathSeqId, anim: data.deathAnim },
        ],
        data.idleAnim,
    );
}
