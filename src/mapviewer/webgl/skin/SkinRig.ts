import { Model } from "../../../rs/model/Model";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqTransformType } from "../../../rs/model/seq/SeqTransformType";

export class SkinRig {
    static readonly REST_MATRIX_SOURCE_LABEL = -1;

    private constructor(
        readonly matrixSourceLabels: readonly number[],
        readonly alphaSourceLabels: readonly number[],
        private readonly matrixIndices: ReadonlyMap<number, number>,
        private readonly alphaIndices: ReadonlyMap<number, number>,
    ) {}

    static oldStyle(models: readonly Model[], frames: readonly SeqFrame[]): SkinRig {
        const matrixLabels = new Set<number>();
        const alphaLabels = new Set<number>();
        for (const model of models) {
            for (let label = 0; label < (model.vertexLabels?.length ?? 0); label++) {
                if (model.vertexLabels[label].length > 0) {
                    matrixLabels.add(label);
                }
            }
        }
        for (const frame of frames) {
            for (let group = 0; group < frame.base.count; group++) {
                const type = frame.base.types[group];
                if (type !== SeqTransformType.ALPHA && type !== SeqTransformType.LIGHT) {
                    for (const label of frame.base.labels[group]) {
                        matrixLabels.add(label);
                    }
                }
            }
            for (let index = 0; index < frame.transformCount; index++) {
                const group = frame.transformGroups[index];
                if (frame.base.types[group] !== SeqTransformType.ALPHA) {
                    continue;
                }
                for (const label of frame.base.labels[group]) {
                    alphaLabels.add(label);
                }
            }
        }
        if (matrixLabels.size > 0xffff) {
            throw new Error(`Actor rig has ${matrixLabels.size} matrices; the format allows 65536`);
        }
        if (alphaLabels.size > 0xff) {
            throw new Error(
                `Actor rig has ${alphaLabels.size} alpha labels; the format allows 255`,
            );
        }
        const matrixSourceLabels = [
            SkinRig.REST_MATRIX_SOURCE_LABEL,
            ...[...matrixLabels].sort((a, b) => a - b),
        ];
        const alphaSourceLabels = [...alphaLabels].sort((a, b) => a - b);
        return new SkinRig(
            matrixSourceLabels,
            alphaSourceLabels,
            compactIndices(matrixSourceLabels, 0),
            compactIndices(alphaSourceLabels, 1),
        );
    }

    matrixIndex(sourceLabel: number): number {
        if (sourceLabel === SkinRig.REST_MATRIX_SOURCE_LABEL) {
            return 0;
        }
        const index = this.matrixIndices.get(sourceLabel);
        if (index === undefined) {
            throw new Error(`Vertex label ${sourceLabel} is absent from its actor rig`);
        }
        return index;
    }

    alphaIndex(sourceLabel: number): number {
        return this.alphaIndices.get(sourceLabel) ?? 0;
    }
}

function compactIndices(labels: readonly number[], start: number): ReadonlyMap<number, number> {
    return new Map(labels.map((label, index) => [label, index + start]));
}
