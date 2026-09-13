import { Model } from "../../../rs/model/Model";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqTransformType } from "../../../rs/model/seq/SeqTransformType";
import { SkeletalPlayback, skeletalAlphaGroups } from "../../../rs/model/skeletal/SkeletalPlayback";

const MOVING_TRANSFORMS: ReadonlySet<SeqTransformType> = new Set([
    SeqTransformType.TRANSLATE,
    SeqTransformType.ROTATE,
    SeqTransformType.SCALE,
]);

const REST_MATRIX_INDEX = 0;
const MAX_MATRIX_COUNT = 0x10000;
const MAX_ALPHA_LABELS = 0xff;

export enum SeqPoseKind {
    FRAMES = "FRAMES",
    SKELETAL = "SKELETAL",
}

export type FramesPoseableSeq = {
    readonly kind: SeqPoseKind.FRAMES;
    readonly seqId: number;
    readonly frames: readonly SeqFrame[];
};

export type SkeletalPoseableSeq = SkeletalPlayback & {
    readonly kind: SeqPoseKind.SKELETAL;
    readonly seqId: number;
};

export type PoseableSeq = FramesPoseableSeq | SkeletalPoseableSeq;

// What a rig's matrices are computed from: old-style frames of any base, or the curves of one
// skeleton.
export type PoseRigKey =
    | { readonly kind: SeqPoseKind.FRAMES }
    | { readonly kind: SeqPoseKind.SKELETAL; readonly skeletonId: number };

export function poseRigKey(seq: PoseableSeq): PoseRigKey {
    switch (seq.kind) {
        case SeqPoseKind.FRAMES:
            return { kind: SeqPoseKind.FRAMES };
        case SeqPoseKind.SKELETAL:
            return { kind: SeqPoseKind.SKELETAL, skeletonId: seq.seq.base.id };
    }
}

export function describePoseRig(key: PoseRigKey): string {
    switch (key.kind) {
        case SeqPoseKind.FRAMES:
            return "old-style frames";
        case SeqPoseKind.SKELETAL:
            return `skeleton ${key.skeletonId}`;
    }
}

export function samePoseRig(a: PoseRigKey, b: PoseRigKey): boolean {
    if (a.kind === SeqPoseKind.SKELETAL && b.kind === SeqPoseKind.SKELETAL) {
        return a.skeletonId === b.skeletonId;
    }
    return a.kind === b.kind;
}

export interface SkinInfluence {
    readonly matrixIndex: number;
    readonly weight: number;
}

// One model's vertices and faces, resolved to the rows of the rig it was bound to.
export interface SkinModelBinding {
    vertexInfluences(vertex: number): readonly SkinInfluence[];
    faceAlphaIndex(face: number): number;
}

const REST_INFLUENCES: readonly SkinInfluence[] = [
    { matrixIndex: REST_MATRIX_INDEX, weight: 0xff },
];

// Maps a rig's source labels to compact matrix and alpha rows. Only labels that have geometry in
// the rig's models and that some frame moves (or fades) get a row of their own; every other
// labelled vertex shares the rest row, so the per-frame table stays proportional to what animates.
export class OldStyleSkinRig {
    static readonly REST_MATRIX_SOURCE_LABEL = -1;

    readonly kind = SeqPoseKind.FRAMES;

    private constructor(
        readonly matrixSourceLabels: readonly number[],
        readonly alphaSourceLabels: readonly number[],
        private readonly modelVertexLabels: ReadonlySet<number>,
        private readonly matrixIndices: ReadonlyMap<number, number>,
        private readonly alphaIndices: ReadonlyMap<number, number>,
    ) {}

    static create(models: readonly Model[], frames: readonly SeqFrame[]): OldStyleSkinRig {
        const modelVertexLabels = new Set<number>();
        for (const model of models) {
            (model.vertexLabels ?? []).forEach((vertices, label) => {
                if (vertices.length > 0) {
                    modelVertexLabels.add(label);
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
        const alphaSourceLabels = fadedFaceLabels(models, fadedLabels);
        checkMatrixCount(matrixLabels.length + 1);
        const matrixSourceLabels = [OldStyleSkinRig.REST_MATRIX_SOURCE_LABEL, ...matrixLabels];
        return new OldStyleSkinRig(
            matrixSourceLabels,
            alphaSourceLabels,
            modelVertexLabels,
            compactIndices(matrixSourceLabels, REST_MATRIX_INDEX),
            compactIndices(alphaSourceLabels, 1),
        );
    }

    bind(model: Model): SkinModelBinding {
        const vertexLabels = sourceVertexLabels(model);
        const faceLabels = sourceFaceLabels(model);
        return {
            vertexInfluences: (vertex) => [
                { matrixIndex: this.matrixIndex(vertexLabels[vertex]), weight: 0xff },
            ],
            faceAlphaIndex: (face) => this.alphaIndices.get(faceLabels[face]) ?? 0,
        };
    }

    private matrixIndex(sourceLabel: number): number {
        const index = this.matrixIndices.get(sourceLabel);
        if (index !== undefined) {
            return index;
        }
        if (!this.modelVertexLabels.has(sourceLabel)) {
            throw new Error(`Vertex label ${sourceLabel} is absent from its skin rig's models`);
        }
        return REST_MATRIX_INDEX;
    }
}

// Row 0 is the rest transform, for vertices no bone influences; every bone some vertex of the
// rig's models references gets a row after it, in bone order. Bones no vertex references are left
// out even when they move, since nothing reads them.
export class SkeletalSkinRig {
    readonly kind = SeqPoseKind.SKELETAL;

    private constructor(
        readonly skeletonId: number,
        readonly bones: readonly number[],
        readonly alphaSourceLabels: readonly number[],
        private readonly boneRows: ReadonlyMap<number, number>,
        private readonly alphaIndices: ReadonlyMap<number, number>,
    ) {}

    static create(
        models: readonly Model[],
        skeletonId: number,
        boneCount: number,
        seqs: readonly SkeletalPlayback[],
    ): SkeletalSkinRig {
        const referencedBones = new Set<number>();
        for (const model of models) {
            for (const group of model.animMayaGroups ?? []) {
                for (const bone of group ?? []) {
                    if (bone < 0 || bone >= boneCount) {
                        throw new Error(
                            `Model bone ${bone} is outside skeleton ${skeletonId} of ${boneCount} bones`,
                        );
                    }
                    referencedBones.add(bone);
                }
            }
        }
        const bones = [...referencedBones].sort((a, b) => a - b);
        checkMatrixCount(bones.length + 1);
        const alphaSourceLabels = fadedFaceLabels(models, skeletalFadedLabels(seqs));
        return new SkeletalSkinRig(
            skeletonId,
            bones,
            alphaSourceLabels,
            compactIndices(bones, REST_MATRIX_INDEX + 1),
            compactIndices(alphaSourceLabels, 1),
        );
    }

    bind(model: Model): SkinModelBinding {
        const faceLabels = sourceFaceLabels(model);
        return {
            vertexInfluences: (vertex) => {
                const group = model.animMayaGroups?.[vertex];
                if (!group || group.length === 0) {
                    return REST_INFLUENCES;
                }
                const weights = model.animMayaScales[vertex];
                return Array.from(group, (bone, index) => ({
                    matrixIndex: this.boneRow(bone),
                    weight: weights[index],
                }));
            },
            faceAlphaIndex: (face) => this.alphaIndices.get(faceLabels[face]) ?? 0,
        };
    }

    private boneRow(bone: number): number {
        const row = this.boneRows.get(bone);
        if (row === undefined) {
            throw new Error(`Bone ${bone} is absent from its skin rig's models`);
        }
        return row;
    }
}

export type SkinRig = OldStyleSkinRig | SkeletalSkinRig;

// A rig together with the sequences it poses, which are all of its kind.
export type RiggedSeqs =
    | {
          readonly kind: SeqPoseKind.FRAMES;
          readonly rig: OldStyleSkinRig;
          readonly seqs: readonly FramesPoseableSeq[];
      }
    | {
          readonly kind: SeqPoseKind.SKELETAL;
          readonly rig: SkeletalSkinRig;
          readonly seqs: readonly SkeletalPoseableSeq[];
      };

// One rig poses every sequence of a model, so they must share one way of computing its matrices.
// Without sequences the models are posed only at rest, which old-style rigs cover.
export function rigSeqs(models: readonly Model[], seqs: readonly PoseableSeq[]): RiggedSeqs {
    const frameSeqs = seqs.filter(
        (seq): seq is FramesPoseableSeq => seq.kind === SeqPoseKind.FRAMES,
    );
    const skeletalSeqs = seqs.filter(
        (seq): seq is SkeletalPoseableSeq => seq.kind === SeqPoseKind.SKELETAL,
    );
    if (skeletalSeqs.length === 0) {
        return {
            kind: SeqPoseKind.FRAMES,
            rig: OldStyleSkinRig.create(
                models,
                frameSeqs.flatMap((seq) => seq.frames),
            ),
            seqs: frameSeqs,
        };
    }
    if (frameSeqs.length > 0) {
        throw new Error(
            `Seqs ${frameSeqs.map((seq) => seq.seqId).join(", ")} use old-style frames but seqs ` +
                `${skeletalSeqs
                    .map((seq) => seq.seqId)
                    .join(", ")} are skeletal; one rig poses only one kind`,
        );
    }
    const skeletonIds = new Set(skeletalSeqs.map((seq) => seq.seq.base.id));
    if (skeletonIds.size > 1) {
        throw new Error(
            `Seqs ${skeletalSeqs
                .map((seq) => `${seq.seqId} (skeleton ${seq.seq.base.id})`)
                .join(", ")} ` + `span several skeletons; one rig poses only one`,
        );
    }
    const skeleton = skeletalSeqs[0].seq;
    return {
        kind: SeqPoseKind.SKELETAL,
        rig: SkeletalSkinRig.create(
            models,
            skeleton.base.id,
            skeleton.skeletalBase.bones.length,
            skeletalSeqs,
        ),
        seqs: skeletalSeqs,
    };
}

function checkMatrixCount(count: number): void {
    if (count > MAX_MATRIX_COUNT) {
        throw new Error(`Skin rig has ${count} matrices; the format allows ${MAX_MATRIX_COUNT}`);
    }
}

// Many skeletal alpha curves stay at zero, fading nothing, and must not cost an alpha row.
function skeletalFadedLabels(seqs: readonly SkeletalPlayback[]): Set<number> {
    const labels = new Set<number>();
    for (const { seq, frameCount } of seqs) {
        for (const group of skeletalAlphaGroups(seq)) {
            let fades = false;
            for (let frame = 0; frame < frameCount && !fades; frame++) {
                fades = group.curve.getValue(frame) !== 0;
            }
            if (fades) {
                group.labels.forEach((label) => labels.add(label));
            }
        }
    }
    return labels;
}

function fadedFaceLabels(models: readonly Model[], fadedLabels: ReadonlySet<number>): number[] {
    const modelFaceLabels = new Set<number>();
    for (const model of models) {
        (model.faceLabels ?? []).forEach((faces, label) => {
            if (faces.length > 0) {
                modelFaceLabels.add(label);
            }
        });
    }
    const labels = [...modelFaceLabels]
        .filter((label) => fadedLabels.has(label))
        .sort((a, b) => a - b);
    if (labels.length > MAX_ALPHA_LABELS) {
        throw new Error(
            `Skin rig has ${labels.length} alpha labels; the format allows ${MAX_ALPHA_LABELS}`,
        );
    }
    return labels;
}

function compactIndices(labels: readonly number[], start: number): ReadonlyMap<number, number> {
    return new Map(labels.map((label, index) => [label, index + start]));
}

function sourceVertexLabels(model: Model): Int32Array {
    const labels = new Int32Array(model.verticesCount).fill(-1);
    if (!model.vertexLabels || model.vertexLabels.length === 0) {
        return labels;
    }
    for (let label = 0; label < model.vertexLabels.length; label++) {
        for (const vertex of model.vertexLabels[label]) {
            if (labels[vertex] !== -1) {
                throw new Error(`Actor vertex ${vertex} has more than one label`);
            }
            labels[vertex] = label;
        }
    }
    return labels;
}

function sourceFaceLabels(model: Model): Int32Array {
    const labels = new Int32Array(model.faceCount).fill(-1);
    for (let label = 0; label < (model.faceLabels?.length ?? 0); label++) {
        for (const face of model.faceLabels[label]) {
            if (labels[face] !== -1) {
                throw new Error(`Actor face ${face} has more than one alpha label`);
            }
            labels[face] = label;
        }
    }
    return labels;
}
