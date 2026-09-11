import { SkinFrame } from "../skin/SkinAnimation";

// A placement texel (fine x/y, packed info, npc type id) followed by the skinned frame's
// matrix/alpha offsets; the npc shader receives this as a define.
export const NPC_INSTANCE_TEXELS = 2;
const NPC_INSTANCE_COMPONENTS = NPC_INSTANCE_TEXELS * 4;

export interface NpcInstance {
    readonly x: number;
    readonly y: number;
    readonly packedInfo: number;
    readonly npcTypeId: number;
    readonly frame: SkinFrame;
}

export function writeNpcInstance(
    data: Uint32Array,
    instanceIndex: number,
    instance: NpcInstance,
): void {
    const offset = instanceIndex * NPC_INSTANCE_COMPONENTS;
    data[offset] = instance.x;
    data[offset + 1] = instance.y;
    data[offset + 2] = instance.packedInfo;
    data[offset + 3] = instance.npcTypeId;
    data[offset + 4] = instance.frame.matrixOffset;
    data[offset + 5] = instance.frame.alphaOffset;
    data[offset + 6] = 0;
    data[offset + 7] = 0;
}
