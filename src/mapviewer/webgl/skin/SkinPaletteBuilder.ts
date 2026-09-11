import {
    PoseSpace,
    VertexLabelStats,
    buildFramePalette,
} from "../../../rs/model/animation/FramePalette";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SkinFrame } from "./SkinAnimation";
import { SkinRig } from "./SkinRig";

export class SkinPaletteBuilder {
    private readonly values: number[] = [];

    addFrame(
        stats: VertexLabelStats,
        rig: SkinRig,
        frame: SeqFrame | undefined,
        space: PoseSpace,
    ): SkinFrame {
        const palette = frame ? buildFramePalette(stats, frame, space) : undefined;
        const restTransform = space.restTransform();
        const matrixOffset = this.values.length / 4;
        for (const sourceLabel of rig.matrixSourceLabels) {
            const matrix =
                sourceLabel === SkinRig.REST_MATRIX_SOURCE_LABEL
                    ? restTransform
                    : palette?.matrices[sourceLabel] ?? restTransform;
            this.values.push(...matrix.toRows());
        }
        const alphaOffset = this.values.length / 4;
        for (const sourceLabel of rig.alphaSourceLabels) {
            const alpha = palette?.alphaTransforms[sourceLabel] ?? {
                delta: 0,
                lower: 0,
                upper: 255,
            };
            this.values.push(alpha.delta, alpha.lower, alpha.upper, 0);
        }
        return { matrixOffset, alphaOffset };
    }

    build(): Float32Array {
        return Float32Array.from(this.values);
    }
}
