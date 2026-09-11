import { Model } from "../Model";
import { SeqBase } from "../seq/SeqBase";
import { SeqFrame } from "../seq/SeqFrame";
import { SeqTransformType } from "../seq/SeqTransformType";
import { AffineTransform, VertexLabelStats, buildFramePalette } from "./FramePalette";

function modelWithLabels(): Model {
    const model = new Model();
    model.verticesCount = 5;
    model.usedVertexCount = 5;
    model.verticesX = new Int32Array([10, 30, -20, 15, 45]);
    model.verticesY = new Int32Array([20, 40, 50, -10, 5]);
    model.verticesZ = new Int32Array([30, -10, 5, 25, -30]);
    model.vertexLabels = [new Int32Array([0, 1]), new Int32Array([2, 3]), new Int32Array([4])];
    model.faceCount = 3;
    model.faceLabels = [new Int32Array([0]), new Int32Array([1, 2])];
    model.faceAlphas = new Int8Array([10, 120, -16]);
    return model;
}

function frame(
    types: readonly SeqTransformType[],
    labels: number[][],
    transforms: readonly [number, number, number][],
    resetOriginGroups?: readonly number[],
    masks?: readonly number[],
): SeqFrame {
    const base = new SeqBase(
        0,
        types.length,
        [...types],
        new Array(types.length).fill(true),
        Uint16Array.from(masks ?? new Array(types.length).fill(0xffff)),
        labels,
    );
    return new SeqFrame(
        1,
        base,
        types.length,
        types.map((_, index) => index),
        transforms.map(([x]) => x),
        transforms.map(([, y]) => y),
        transforms.map(([, , z]) => z),
        [...(resetOriginGroups ?? new Array(types.length).fill(-1))],
        types.includes(SeqTransformType.ALPHA),
    );
}

function clamp(value: number, lower: number, upper: number): number {
    return Math.max(lower, Math.min(upper, value));
}

describe("frame palettes", () => {
    it("matches the CPU path for chained origins, translation, rotation, scale, and alpha", () => {
        const rest = modelWithLabels();
        const animated = Model.copyAnimated(rest, false, true);
        const animation = frame(
            [
                SeqTransformType.ORIGIN,
                SeqTransformType.TRANSLATE,
                SeqTransformType.ORIGIN,
                SeqTransformType.ROTATE,
                SeqTransformType.SCALE,
                SeqTransformType.ALPHA,
                SeqTransformType.ALPHA,
            ],
            [[0, 1], [0], [0, 2], [0, 2], [1], [0, 1], [1]],
            [
                [3, -2, 5],
                [12, 8, -4],
                [-4, 6, 2],
                [19, 37, 71],
                [160, 96, 192],
                [20, 0, 0],
                [-40, 0, 0],
            ],
        );

        animated.animate(animation, undefined, false);
        const palette = buildFramePalette(
            VertexLabelStats.fromModel(rest),
            animation,
            AffineTransform.identity(),
        );

        for (let label = 0; label < rest.vertexLabels.length; label++) {
            for (const vertex of rest.vertexLabels[label]) {
                const actual = palette.matrices[label].transformPoint(
                    rest.verticesX[vertex],
                    rest.verticesY[vertex],
                    rest.verticesZ[vertex],
                );
                expect(Math.abs(actual[0] - animated.verticesX[vertex])).toBeLessThanOrEqual(8);
                expect(Math.abs(actual[1] - animated.verticesY[vertex])).toBeLessThanOrEqual(8);
                expect(Math.abs(actual[2] - animated.verticesZ[vertex])).toBeLessThanOrEqual(8);
            }
        }

        for (let label = 0; label < rest.faceLabels.length; label++) {
            const alpha = palette.alphaTransforms[label];
            for (const face of rest.faceLabels[label]) {
                const actual = clamp(
                    (rest.faceAlphas[face] & 0xff) + alpha.delta,
                    alpha.lower,
                    alpha.upper,
                );
                expect(actual).toBe(animated.faceAlphas[face] & 0xff);
            }
        }
    });

    it("folds repeated saturation into one exact alpha clamp", () => {
        const animation = frame(
            [SeqTransformType.ALPHA, SeqTransformType.ALPHA, SeqTransformType.ALPHA],
            [[0], [0], [0]],
            [
                [40, 0, 0],
                [-20, 0, 0],
                [5, 0, 0],
            ],
        );
        const alpha = buildFramePalette(
            new VertexLabelStats([]),
            animation,
            AffineTransform.identity(),
        ).alphaTransforms[0];

        for (let initial = 0; initial <= 255; initial++) {
            const sequential = clamp(
                clamp(clamp(initial + 320, 0, 255) - 160, 0, 255) + 40,
                0,
                255,
            );
            expect(clamp(initial + alpha.delta, alpha.lower, alpha.upper)).toBe(sequential);
        }
    });

    it("skips masked operations and applies the post transform last", () => {
        const animation = frame(
            [SeqTransformType.TRANSLATE, SeqTransformType.TRANSLATE],
            [[0], [0]],
            [
                [100, 0, 0],
                [2, 3, 4],
            ],
            undefined,
            [0xfffe, 0xffff],
        );
        const palette = buildFramePalette(
            new VertexLabelStats([{ positionSum: [0, 0, 0], vertexCount: 1 }]),
            animation,
            AffineTransform.fromRows([2, 0, 0, 10, 0, 2, 0, 20, 0, 0, 2, 30]),
        );

        expect(palette.matrices[0].transformPoint(1, 1, 1)).toEqual([16, 28, 40]);
    });
});
