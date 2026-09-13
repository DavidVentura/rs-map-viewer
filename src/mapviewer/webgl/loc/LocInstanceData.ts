import { LocTransform } from "../../game/LocTransform";
import { ModelInfo, encodeModelInfo } from "../buffer/SceneBuffer";
import { SkinFrame } from "../skin/SkinAnimation";

// The loc's placement, packed like the static model info texels with a hidden flag in the fourth
// word, followed by its skinned frame's matrix/alpha offsets, its lift and its two tilts. Lift and
// tilts are 16-bit fixed point biased by 0x8000, so the shader decodes them without sign
// extension. The skinned loc shader receives the sizes and scales as defines.
export const LOC_INSTANCE_TEXELS = 2;
export const LOC_LIFT_UNITS_PER_WORLD_UNIT = 16;
export const LOC_TILT_UNITS_PER_RADIAN = 8192;
const LOC_INSTANCE_COMPONENTS = LOC_INSTANCE_TEXELS * 4;
const FIXED_POINT_BIAS = 0x8000;
const LOC_HIDDEN_FLAG = 1;

function encodeFixedPoint(value: number, unitsPerValue: number, description: string): number {
    const units = Math.round(value * unitsPerValue);
    if (units < -FIXED_POINT_BIAS || units >= FIXED_POINT_BIAS) {
        throw new RangeError(`Loc ${description} ${value} does not fit its 16-bit encoding`);
    }
    return units + FIXED_POINT_BIAS;
}

export function writeLocInstance(
    data: Uint32Array,
    instanceIndex: number,
    placement: ModelInfo,
    frame: SkinFrame,
    transform: LocTransform,
): void {
    const offset = instanceIndex * LOC_INSTANCE_COMPONENTS;
    const [x, z, heightPriority] = encodeModelInfo(placement);
    data[offset] = x;
    data[offset + 1] = z;
    data[offset + 2] = heightPriority;
    data[offset + 4] = frame.matrixOffset;
    data[offset + 5] = frame.alphaOffset;
    switch (transform.kind) {
        case "HIDDEN":
            data[offset + 3] = LOC_HIDDEN_FLAG;
            data[offset + 6] = FIXED_POINT_BIAS;
            data[offset + 7] = FIXED_POINT_BIAS | (FIXED_POINT_BIAS << 16);
            return;
        case "SHOWN":
            data[offset + 3] = 0;
            data[offset + 6] = encodeFixedPoint(
                transform.lift,
                LOC_LIFT_UNITS_PER_WORLD_UNIT,
                "lift",
            );
            data[offset + 7] =
                encodeFixedPoint(transform.northTilt, LOC_TILT_UNITS_PER_RADIAN, "north tilt") |
                (encodeFixedPoint(transform.eastTilt, LOC_TILT_UNITS_PER_RADIAN, "east tilt") <<
                    16);
            return;
    }
}
