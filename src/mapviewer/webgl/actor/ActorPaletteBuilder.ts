import {
    AffineTransform,
    VertexLabelStats,
    buildFramePalette,
} from "../../../rs/model/animation/FramePalette";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { ActorFrame } from "./ActorRenderData";
import { ActorRig } from "./ActorRig";

export class ActorPaletteBuilder {
    private readonly values: number[] = [];

    addFrame(
        stats: VertexLabelStats,
        rig: ActorRig,
        frame: SeqFrame | undefined,
        postTransform: AffineTransform,
    ): ActorFrame {
        const palette = frame ? buildFramePalette(stats, frame, postTransform) : undefined;
        const matrixOffset = this.values.length / 4;
        for (const sourceLabel of rig.matrixSourceLabels) {
            const matrix =
                sourceLabel === ActorRig.REST_MATRIX_SOURCE_LABEL
                    ? postTransform
                    : palette?.matrices[sourceLabel] ?? postTransform;
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
