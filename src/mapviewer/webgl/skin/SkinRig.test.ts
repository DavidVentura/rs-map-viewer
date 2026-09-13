import { Model } from "../../../rs/model/Model";
import { SeqBase } from "../../../rs/model/seq/SeqBase";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqTransformType } from "../../../rs/model/seq/SeqTransformType";
import { FrameSampledCurve } from "../../../rs/model/skeletal/SkeletalPlayback";
import { SkeletalSeq } from "../../../rs/model/skeletal/SkeletalSeq";
import { PoseableSeq, SeqPoseKind, SkeletalSkinRig, rigSeqs } from "./SkinRig";

function skeletalSeq(
    seqId: number,
    skeletonId: number,
    boneCount: number,
    alphaCurves: readonly FrameSampledCurve[] = [],
): PoseableSeq {
    const seq = {
        base: {
            id: skeletonId,
            count: alphaCurves.length,
            types: alphaCurves.map(() => SeqTransformType.ALPHA),
            labels: alphaCurves.map((_, group) => [group]),
        },
        skeletalBase: { bones: new Array(boneCount) },
        curves: alphaCurves.map((curve) => [curve]),
        boneCurves: [],
    } as unknown as SkeletalSeq;
    return { kind: SeqPoseKind.SKELETAL, seqId, seq, frameCount: 10 };
}

function framesSeq(seqId: number): PoseableSeq {
    const base = new SeqBase(
        0,
        1,
        [SeqTransformType.TRANSLATE],
        [true],
        new Uint16Array([0xffff]),
        [[0]],
    );
    return {
        kind: SeqPoseKind.FRAMES,
        seqId,
        frames: [new SeqFrame(1, base, 1, [0], [4], [0], [0], [-1], false)],
    };
}

function riggedModel(groups: readonly (readonly number[])[], weights: readonly number[][]): Model {
    const model = new Model();
    model.verticesCount = groups.length;
    model.animMayaGroups = groups.map((bones) => Int32Array.from(bones));
    model.animMayaScales = weights.map((values) => Int32Array.from(values));
    model.faceCount = 2;
    model.faceLabels = [new Int32Array([0]), new Int32Array([1])];
    return model;
}

function skeletalRig(model: Model, seqs: readonly PoseableSeq[]): SkeletalSkinRig {
    const rigged = rigSeqs([model], seqs);
    if (rigged.kind !== SeqPoseKind.SKELETAL) {
        throw new Error("Expected a skeletal rig");
    }
    return rigged.rig;
}

describe("SkeletalSkinRig", () => {
    const model = riggedModel([[], [5], [9, 5, 2]], [[], [255], [100, 100, 55]]);

    it("gives referenced bones compact rows after the rest row, in bone order", () => {
        expect(skeletalRig(model, [skeletalSeq(1, 2062, 12)]).bones).toEqual([2, 5, 9]);
    });

    it("maps a vertex's bones and weights to rows, and a boneless vertex to the rest row", () => {
        const binding = skeletalRig(model, [skeletalSeq(1, 2062, 12)]).bind(model);

        expect(binding.vertexInfluences(0)).toEqual([{ matrixIndex: 0, weight: 255 }]);
        expect(binding.vertexInfluences(1)).toEqual([{ matrixIndex: 2, weight: 255 }]);
        expect(binding.vertexInfluences(2)).toEqual([
            { matrixIndex: 3, weight: 100 },
            { matrixIndex: 2, weight: 100 },
            { matrixIndex: 1, weight: 55 },
        ]);
    });

    it("rejects a bone outside the skeleton", () => {
        expect(() => rigSeqs([model], [skeletalSeq(1, 2062, 9)])).toThrow(
            "Model bone 9 is outside skeleton 2062 of 9 bones",
        );
    });

    it("gives alpha rows only to labels some curve actually fades", () => {
        const still = { getValue: () => 0 };
        const fading = { getValue: (frame: number) => frame / 10 };
        const rig = skeletalRig(model, [skeletalSeq(1, 2062, 12, [still, fading])]);

        expect(rig.alphaSourceLabels).toEqual([1]);
        expect(rig.bind(model).faceAlphaIndex(0)).toBe(0);
        expect(rig.bind(model).faceAlphaIndex(1)).toBe(1);
    });

    it("rejects old-style and skeletal seqs on one rig", () => {
        expect(() => rigSeqs([model], [framesSeq(1), skeletalSeq(2, 2062, 12)])).toThrow(
            /one rig poses only one kind/,
        );
    });

    it("rejects seqs of different skeletons on one rig", () => {
        expect(() =>
            rigSeqs([model], [skeletalSeq(1, 2062, 12), skeletalSeq(2, 2063, 12)]),
        ).toThrow(/span several skeletons/);
    });
});
