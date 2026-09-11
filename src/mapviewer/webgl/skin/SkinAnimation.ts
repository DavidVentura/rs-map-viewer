import { SkinnedMesh } from "./SkinnedMeshBuilder";

export interface SkinFrame {
    readonly matrixOffset: number;
    readonly alphaOffset: number;
}

export interface SkinAnimation {
    readonly mesh: SkinnedMesh;
    readonly frames: readonly SkinFrame[];
}

export interface SkinAnimationSet {
    readonly mesh: SkinnedMesh;
    readonly animationsBySeqId: ReadonlyMap<number, readonly SkinFrame[]>;
}
