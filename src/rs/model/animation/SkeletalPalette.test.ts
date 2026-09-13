import { mat4, vec3 } from "gl-matrix";

import { Model } from "../Model";
import { SeqTransformType } from "../seq/SeqTransformType";
import { SkeletalBase } from "../skeletal/SkeletalBase";
import { skeletalAlphaGroups } from "../skeletal/SkeletalPlayback";
import { SkeletalSeq } from "../skeletal/SkeletalSeq";
import { AffineTransform, AlphaFolder, PoseSpace } from "./FramePalette";
import { SkeletalPoser, foldSkeletalAlpha, skeletalBoneTransform } from "./SkeletalPalette";

function boneMatrix(axis: vec3, angle: number, translation: vec3, scale: number): mat4 {
    const matrix = mat4.fromRotation(mat4.create(), angle, axis)!;
    mat4.scale(matrix, matrix, [scale, scale, scale]);
    matrix[12] = translation[0];
    matrix[13] = translation[1];
    matrix[14] = translation[2];
    return matrix;
}

function skeletonOf(matrices: readonly mat4[]): SkeletalBase {
    const bones = matrices.map((matrix) => ({ getFinalMatrix: () => matrix }));
    return {
        bones,
        getBone: (id: number) => bones[id],
        updateAnimMatrices: () => {},
    } as unknown as SkeletalBase;
}

function blend(
    transforms: readonly AffineTransform[],
    weights: readonly number[],
    point: readonly [number, number, number],
): [number, number, number] {
    const result: [number, number, number] = [0, 0, 0];
    transforms.forEach((transform, index) => {
        const posed = transform.transformPoint(...point);
        for (let axis = 0; axis < 3; axis++) {
            result[axis] += (posed[axis] * weights[index]) / 255;
        }
    });
    return result;
}

describe("skeletal bone transforms", () => {
    it("applies the bone in the model's y/z-negated space", () => {
        const quarterTurnAboutZ = mat4.fromRotation(mat4.create(), Math.PI / 2, [0, 0, 1])!;
        quarterTurnAboutZ[12] = 10;
        quarterTurnAboutZ[13] = 20;
        quarterTurnAboutZ[14] = 30;

        // (1, 2, 3) negates to (1, -2, -3), turns to (2, 1, -3), moves to (12, 21, 27) and
        // negates back.
        const posed = skeletalBoneTransform(quarterTurnAboutZ).transformPoint(1, 2, 3);

        expect(posed[0]).toBeCloseTo(12);
        expect(posed[1]).toBeCloseTo(-21);
        expect(posed[2]).toBeCloseTo(-27);
    });

    it("blends two weighted bones like the CPU skeletal path", () => {
        const first = boneMatrix(vec3.normalize(vec3.create(), [1, 2, 0.5]), 0.7, [15, -40, 8], 1);
        const second = boneMatrix(
            vec3.normalize(vec3.create(), [0, 1, 1]),
            -1.3,
            [-60, 5, 90],
            1.2,
        );
        const point: [number, number, number] = [37, -112, 64];
        const weights = [100, 155];
        const model = new Model();
        model.verticesCount = 1;
        model.verticesX = new Int32Array([point[0]]);
        model.verticesY = new Int32Array([point[1]]);
        model.verticesZ = new Int32Array([point[2]]);
        model.animMayaGroups = [new Int32Array([0, 1])];
        model.animMayaScales = [new Int32Array(weights)];

        model.transformSkeletal(skeletonOf([first, second]), 0, 0);
        const blended = blend(
            [skeletalBoneTransform(first), skeletalBoneTransform(second)],
            weights,
            point,
        );

        expect(Math.abs(blended[0] - model.verticesX[0])).toBeLessThanOrEqual(0.5);
        expect(Math.abs(blended[1] - model.verticesY[0])).toBeLessThanOrEqual(0.5);
        expect(Math.abs(blended[2] - model.verticesZ[0])).toBeLessThanOrEqual(0.5);
    });

    it("gives row 0 the rest transform and folds each bone through the pose space", () => {
        const bone = boneMatrix([0, 1, 0], 0.4, [3, 7, -11], 1);
        const doubled = AffineTransform.fromRows([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0]);
        const space = PoseSpace.between(AffineTransform.identity(), doubled);
        const seq = {
            skeletalBase: skeletonOf([mat4.create(), bone]),
            poseId: 0,
            base: { id: 1, count: 0, types: [], labels: [] },
            curves: [],
        } as unknown as SkeletalSeq;

        const { matrices } = new SkeletalPoser(space, [1], []).pose(seq, 0);
        const rest = AffineTransform.fromRows(Array.from(matrices.subarray(0, 12)));
        const boneRow = AffineTransform.fromRows(Array.from(matrices.subarray(12, 24)));

        expect(rest.transformPoint(5, 6, 7)).toEqual([10, 12, 14]);
        const expected = skeletalBoneTransform(bone).transformPoint(5, 6, 7);
        boneRow.transformPoint(5, 6, 7).forEach((value, axis) => {
            expect(value).toBeCloseTo(expected[axis] * 2);
        });
    });
});

describe("skeletal alpha", () => {
    it("folds group after group of clamped curve fades into one clamp", () => {
        const fadeIn = { getValue: () => 1 };
        const fadeOut = { getValue: () => -0.6 };
        const base = {
            id: 1,
            count: 3,
            types: [SeqTransformType.ALPHA, SeqTransformType.ROTATE, SeqTransformType.ALPHA],
            labels: [[0, 1], [0], [1]],
        };
        const seq = {
            base,
            curves: [[fadeIn], [fadeIn], [fadeOut]],
            hasAlphaTransform: true,
        } as unknown as SkeletalSeq;
        const transforms = foldSkeletalAlpha(new AlphaFolder([0, 1]), skeletalAlphaGroups(seq), 0);

        for (const initial of [0, 100, 200]) {
            const model = new Model();
            model.faceCount = 2;
            model.faceLabels = [new Int32Array([0]), new Int32Array([1])];
            model.faceAlphas = new Int8Array([initial, initial]);
            model.transformSkeletalAlpha(seq, 0);

            transforms.forEach((alpha, label) => {
                const folded = Math.max(alpha.lower, Math.min(alpha.upper, initial + alpha.delta));
                expect(Math.abs(folded - (model.faceAlphas[label] & 0xff))).toBeLessThan(1);
            });
        }
        expect(transforms[1].lower).toBeGreaterThan(0);
    });
});
