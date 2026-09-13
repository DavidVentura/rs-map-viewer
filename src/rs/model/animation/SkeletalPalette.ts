import { ReadonlyMat4 } from "gl-matrix";

import { SkeletalAlphaGroup, skeletalAlphaGroups } from "../skeletal/SkeletalPlayback";
import { SkeletalSeq } from "../skeletal/SkeletalSeq";
import {
    AffineTransform,
    AlphaFolder,
    AlphaTransform,
    FramePalette,
    PoseSpace,
    restPalette,
} from "./FramePalette";

// A bone's final matrix (gl-matrix, column-major) acts on model positions with y and z negated, as
// Model.transformVertex applies it; the rows fold that flip in on both sides.
export function skeletalBoneTransform(m: ReadonlyMat4): AffineTransform {
    return AffineTransform.fromRows([
        m[0],
        -m[4],
        -m[8],
        m[12],
        -m[1],
        m[5],
        m[9],
        -m[13],
        -m[2],
        m[6],
        m[10],
        -m[14],
    ]);
}

// Model.transformSkeletalAlpha adds each group's curve value (a fraction of 255) to the face alpha
// and clamps, group after group.
export function foldSkeletalAlpha(
    folder: AlphaFolder,
    groups: readonly SkeletalAlphaGroup[],
    frame: number,
): AlphaTransform[] {
    const transforms = folder.unchanged();
    for (const group of groups) {
        folder.apply(transforms, group.labels, group.curve.getValue(frame) * 255);
    }
    return transforms;
}

// Row 0 is the rest transform, for vertices no bone influences; row i + 1 is bone bones[i].
export class SkeletalPoser {
    private readonly alphas: AlphaFolder;

    constructor(
        private readonly space: PoseSpace,
        private readonly bones: readonly number[],
        alphaLabels: readonly number[],
    ) {
        this.alphas = new AlphaFolder(alphaLabels);
    }

    rest(): FramePalette {
        return restPalette(this.space, this.bones.length + 1, this.alphas.labels.length);
    }

    pose(seq: SkeletalSeq, frame: number): FramePalette {
        const skeleton = seq.skeletalBase;
        // Masks split the skeleton between two sequences playing at once; the game plays one
        // sequence at a time, so every bone takes this one's curves.
        skeleton.updateAnimMatrices(seq, frame);
        const { matrices } = restPalette(this.space, this.bones.length + 1, 0);
        this.bones.forEach((boneIndex, index) => {
            const bone = skeleton.bones[boneIndex];
            if (!bone) {
                throw new Error(`Bone ${boneIndex} is outside skeleton ${seq.base.id}`);
            }
            // The skeleton is shared and mutable, so its matrix is copied out before the next pose.
            const rows = this.space.toPose
                .then(skeletalBoneTransform(bone.getFinalMatrix(seq.poseId)))
                .then(this.space.fromPose)
                .toRows();
            matrices.set(rows, (index + 1) * rows.length);
        });
        return {
            matrices,
            alphaTransforms: foldSkeletalAlpha(this.alphas, skeletalAlphaGroups(seq), frame),
        };
    }
}
