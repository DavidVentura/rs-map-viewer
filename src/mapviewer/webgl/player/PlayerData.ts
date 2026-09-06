import { AnimationFrames } from "../AnimationFrames";

export type PlayerData = {
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
