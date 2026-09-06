import { Stance } from "../../game/Ability";
import { StanceSeqIds, StanceSeqIdsByStance } from "../../game/Player";
import { AnimationFrames, resolveAnimationFrames } from "../AnimationFrames";

export type StanceAnimationSet = StanceSeqIds & {
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames;
    runAnim: AnimationFrames;
    attackAnim: AnimationFrames;
};

export type PlayerRenderData = {
    x: number;
    y: number;
    level: number;
    id: number;
    stances: Record<Stance, StanceAnimationSet>;
};

export function getStanceSeqIds(data: PlayerRenderData): StanceSeqIdsByStance {
    return data.stances;
}

export function getPlayerAnimationFrames(
    data: PlayerRenderData,
    stance: Stance,
    seqId: number,
): AnimationFrames {
    const set = data.stances[stance];
    return resolveAnimationFrames(
        seqId,
        [
            { seqId: set.walkSeqId, anim: set.walkAnim },
            { seqId: set.runSeqId, anim: set.runAnim },
            { seqId: set.attackSeqId, anim: set.attackAnim },
        ],
        set.idleAnim,
    );
}
