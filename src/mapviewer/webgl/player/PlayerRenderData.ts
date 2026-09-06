import { WeaponStyle } from "../../game/Ability";
import { StanceSeqIds, StanceSeqIdsByStance } from "../../game/Player";
import { AnimationFrames } from "../AnimationFrames";

export type StanceAnimationSet = StanceSeqIds & {
    idleAnim: AnimationFrames;
    animationsBySeqId: ReadonlyMap<number, AnimationFrames>;
};

export type PlayerRenderData = {
    x: number;
    y: number;
    level: number;
    id: number;
    stances: Record<WeaponStyle, StanceAnimationSet>;
};

export function getStanceSeqIds(data: PlayerRenderData): StanceSeqIdsByStance {
    return data.stances;
}

export function getPlayerAnimationFrames(
    data: PlayerRenderData,
    style: WeaponStyle,
    seqId: number,
): AnimationFrames {
    const set = data.stances[style];
    return set.animationsBySeqId.get(seqId) ?? set.idleAnim;
}
