import { SkinFrame } from "../skin/SkinAnimation";
import { SkinnedMesh } from "../skin/SkinnedMeshBuilder";

export interface NpcSeqAnimation {
    readonly seqId: number;
    readonly frames: readonly SkinFrame[];
}

// walk is absent when the npc has no walk sequence of its own or the cache cannot pose it; the npc
// then keeps playing its idle sequence while it moves.
export interface NpcAnimation {
    readonly mesh: SkinnedMesh;
    readonly idle: NpcSeqAnimation;
    readonly walk?: NpcSeqAnimation;
}
