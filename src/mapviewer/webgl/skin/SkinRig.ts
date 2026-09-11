import { Model } from "../../../rs/model/Model";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqTransformType } from "../../../rs/model/seq/SeqTransformType";

const MOVING_TRANSFORMS: ReadonlySet<SeqTransformType> = new Set([
    SeqTransformType.TRANSLATE,
    SeqTransformType.ROTATE,
    SeqTransformType.SCALE,
]);

// Maps a rig's source labels to compact matrix and alpha rows. Only labels that have geometry in
// the rig's models and that some frame moves (or fades) get a row of their own; every other
// labelled vertex shares the rest row, so the per-frame table stays proportional to what animates.
export class SkinRig {
    static readonly REST_MATRIX_SOURCE_LABEL = -1;

    private constructor(
        readonly matrixSourceLabels: readonly number[],
        readonly alphaSourceLabels: readonly number[],
        private readonly modelVertexLabels: ReadonlySet<number>,
        private readonly matrixIndices: ReadonlyMap<number, number>,
        private readonly alphaIndices: ReadonlyMap<number, number>,
    ) {}

    static oldStyle(models: readonly Model[], frames: readonly SeqFrame[]): SkinRig {
        const modelVertexLabels = new Set<number>();
        const modelFaceLabels = new Set<number>();
        for (const model of models) {
            (model.vertexLabels ?? []).forEach((vertices, label) => {
                if (vertices.length > 0) {
                    modelVertexLabels.add(label);
                }
            });
            (model.faceLabels ?? []).forEach((faces, label) => {
                if (faces.length > 0) {
                    modelFaceLabels.add(label);
                }
            });
        }
        const movedLabels = new Set<number>();
        const fadedLabels = new Set<number>();
        for (const frame of frames) {
            for (let index = 0; index < frame.transformCount; index++) {
                const group = frame.transformGroups[index];
                const type = frame.base.types[group];
                if (MOVING_TRANSFORMS.has(type)) {
                    frame.base.labels[group].forEach((label) => movedLabels.add(label));
                } else if (type === SeqTransformType.ALPHA) {
                    frame.base.labels[group].forEach((label) => fadedLabels.add(label));
                }
            }
        }
        const matrixLabels = [...modelVertexLabels]
            .filter((label) => movedLabels.has(label))
            .sort((a, b) => a - b);
        const alphaSourceLabels = [...modelFaceLabels]
            .filter((label) => fadedLabels.has(label))
            .sort((a, b) => a - b);
        if (matrixLabels.length + 1 > 0x10000) {
            throw new Error(
                `Skin rig has ${matrixLabels.length + 1} matrices; the format allows 65536`,
            );
        }
        if (alphaSourceLabels.length > 0xff) {
            throw new Error(
                `Skin rig has ${alphaSourceLabels.length} alpha labels; the format allows 255`,
            );
        }
        const matrixSourceLabels = [SkinRig.REST_MATRIX_SOURCE_LABEL, ...matrixLabels];
        return new SkinRig(
            matrixSourceLabels,
            alphaSourceLabels,
            modelVertexLabels,
            compactIndices(matrixSourceLabels, 0),
            compactIndices(alphaSourceLabels, 1),
        );
    }

    matrixIndex(sourceLabel: number): number {
        const index = this.matrixIndices.get(sourceLabel);
        if (index !== undefined) {
            return index;
        }
        if (!this.modelVertexLabels.has(sourceLabel)) {
            throw new Error(`Vertex label ${sourceLabel} is absent from its skin rig's models`);
        }
        return this.matrixIndices.get(SkinRig.REST_MATRIX_SOURCE_LABEL)!;
    }

    alphaIndex(sourceLabel: number): number {
        return this.alphaIndices.get(sourceLabel) ?? 0;
    }
}

function compactIndices(labels: readonly number[], start: number): ReadonlyMap<number, number> {
    return new Map(labels.map((label, index) => [label, index + start]));
}
