import { Model } from "../Model";
import { SeqBase } from "../seq/SeqBase";
import { SeqFrame } from "../seq/SeqFrame";
import { SeqTransformType } from "../seq/SeqTransformType";
import {
    AffineTransform,
    FramePalette,
    FramePoser,
    PoseSpace,
    VertexLabelStats,
} from "./FramePalette";

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

function matrixAt(palette: FramePalette, index: number): AffineTransform {
    return AffineTransform.fromRows(
        Array.from(palette.matrices.subarray(index * 12, index * 12 + 12)),
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
        const palette = new FramePoser(
            VertexLabelStats.fromModel(rest),
            PoseSpace.identity(),
            [0, 1, 2],
            [0, 1],
        ).pose(animation);

        for (let label = 0; label < rest.vertexLabels.length; label++) {
            for (const vertex of rest.vertexLabels[label]) {
                const actual = matrixAt(palette, label).transformPoint(
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

    it("poses in a rotated space the way the loc loader rotates, animates and rotates back", () => {
        const rest = modelWithLabels();
        const animated = Model.copyAnimated(rest, true, true);
        const animation = frame(
            [SeqTransformType.ORIGIN, SeqTransformType.ROTATE, SeqTransformType.TRANSLATE],
            [[0], [0, 1], [2]],
            [
                [0, 0, 0],
                [0, 40, 0],
                [7, 0, -3],
            ],
        );
        animated.rotate270();
        animated.animate(animation, undefined, false);
        animated.rotate90();

        const toPose = AffineTransform.fromRows([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0]);
        const fromPose = AffineTransform.fromRows([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0]);
        const palette = new FramePoser(
            VertexLabelStats.fromModel(rest),
            PoseSpace.between(toPose, fromPose),
            [0, 1, 2],
            [],
        ).pose(animation);

        for (let label = 0; label < rest.vertexLabels.length; label++) {
            for (const vertex of rest.vertexLabels[label]) {
                const actual = matrixAt(palette, label).transformPoint(
                    rest.verticesX[vertex],
                    rest.verticesY[vertex],
                    rest.verticesZ[vertex],
                );
                expect(Math.abs(actual[0] - animated.verticesX[vertex])).toBeLessThanOrEqual(2);
                expect(Math.abs(actual[1] - animated.verticesY[vertex])).toBeLessThanOrEqual(2);
                expect(Math.abs(actual[2] - animated.verticesZ[vertex])).toBeLessThanOrEqual(2);
            }
        }
    });

    it("averages labels the frame never moves at their rest positions and leaves them at rest", () => {
        const rest = modelWithLabels();
        const animated = Model.copyAnimated(rest, true, true);
        const animation = frame(
            [SeqTransformType.TRANSLATE, SeqTransformType.ORIGIN, SeqTransformType.ROTATE],
            [[0], [0, 1], [0]],
            [
                [9, -4, 6],
                [0, 0, 0],
                [30, 0, 50],
            ],
        );
        animated.rotate270();
        animated.animate(animation, undefined, false);
        animated.rotate90();

        const space = PoseSpace.between(
            AffineTransform.fromRows([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0]),
            AffineTransform.fromRows([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0]),
        );
        const labels = [-1, 0, 1, 2, 7];
        const palette = new FramePoser(VertexLabelStats.fromModel(rest), space, labels, []).pose(
            animation,
        );

        const restRows = Array.from(space.restTransform().toRows());
        for (const index of [0, 2, 3, 4]) {
            expect(Array.from(matrixAt(palette, index).toRows())).toEqual(restRows);
        }
        for (let label = 0; label < rest.vertexLabels.length; label++) {
            for (const vertex of rest.vertexLabels[label]) {
                const actual = matrixAt(palette, labels.indexOf(label)).transformPoint(
                    rest.verticesX[vertex],
                    rest.verticesY[vertex],
                    rest.verticesZ[vertex],
                );
                expect(Math.abs(actual[0] - animated.verticesX[vertex])).toBeLessThanOrEqual(2);
                expect(Math.abs(actual[1] - animated.verticesY[vertex])).toBeLessThanOrEqual(2);
                expect(Math.abs(actual[2] - animated.verticesZ[vertex])).toBeLessThanOrEqual(2);
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
        const alpha = new FramePoser(new VertexLabelStats([]), PoseSpace.identity(), [], [0]).pose(
            animation,
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
        const palette = new FramePoser(
            new VertexLabelStats([{ positionSum: [0, 0, 0], vertexCount: 1 }]),
            PoseSpace.between(
                AffineTransform.identity(),
                AffineTransform.fromRows([2, 0, 0, 10, 0, 2, 0, 20, 0, 0, 2, 30]),
            ),
            [0],
            [],
        ).pose(animation);

        expect(matrixAt(palette, 0).transformPoint(1, 1, 1)).toEqual([16, 28, 40]);
    });

    it("checks reset-origin masks independently from operation masks", () => {
        const stats = new VertexLabelStats([
            { positionSum: [10, 0, 0], vertexCount: 1 },
            { positionSum: [20, 0, 0], vertexCount: 1 },
        ]);
        const paletteForMasks = (originMask: number, resetCarrierMask: number) => {
            const base = new SeqBase(
                0,
                3,
                [SeqTransformType.ORIGIN, SeqTransformType.TRANSLATE, SeqTransformType.SCALE],
                [true, true, true],
                new Uint16Array([originMask, resetCarrierMask, 0xffff]),
                [[0], [], [1]],
            );
            const animation = new SeqFrame(
                1,
                base,
                2,
                [1, 2],
                [0, 256],
                [0, 128],
                [0, 128],
                [0, -1],
                false,
            );
            const palette = new FramePoser(stats, PoseSpace.identity(), [0, 1], []).pose(animation);
            return matrixAt(palette, 1).transformPoint(20, 0, 0)[0];
        };

        expect(paletteForMasks(0xffff, 0xfffe)).toBe(30);
        expect(paletteForMasks(0xfffe, 0xffff)).toBe(40);
    });
});
