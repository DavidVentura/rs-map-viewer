import { encodeModelInfo } from "../buffer/SceneBuffer";
import { LocAnimated } from "./LocAnimated";

// The loc's placement, packed like the static model info texels, followed by its skinned frame's
// matrix/alpha offsets; the skinned loc shader receives this as a define.
export const LOC_INSTANCE_TEXELS = 2;
const LOC_INSTANCE_COMPONENTS = LOC_INSTANCE_TEXELS * 4;

export function writeLocInstance(data: Uint32Array, instanceIndex: number, loc: LocAnimated): void {
    const offset = instanceIndex * LOC_INSTANCE_COMPONENTS;
    const [x, z, heightPriority] = encodeModelInfo(loc.placement);
    const frame = loc.currentFrame();
    data[offset] = x;
    data[offset + 1] = z;
    data[offset + 2] = heightPriority;
    data[offset + 3] = 0;
    data[offset + 4] = frame.matrixOffset;
    data[offset + 5] = frame.alphaOffset;
    data[offset + 6] = 0;
    data[offset + 7] = 0;
}
