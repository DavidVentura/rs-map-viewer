import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { Model } from "../../../rs/model/Model";
import { FramePoser, PoseSpace, VertexLabelStats } from "../../../rs/model/animation/FramePalette";
import { SkeletalPoser } from "../../../rs/model/animation/SkeletalPalette";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { loadSkeletalPlayback } from "../../../rs/model/skeletal/SkeletalPlayback";
import { SkeletalSeqLoader } from "../../../rs/model/skeletal/SkeletalSeqLoader";
import { SkinAnimation, SkinAnimationSet, SkinFrame } from "./SkinAnimation";
import { SkinPaletteBuilder } from "./SkinPaletteBuilder";
import { PoseableSeq, RiggedSeqs, SeqPoseKind, rigSeqs } from "./SkinRig";
import { SkinFaceSelection, SkinnedMesh, SkinnedMeshBuilder } from "./SkinnedMeshBuilder";

export interface SkinMeshSource {
    readonly model: Model;
    readonly selection: SkinFaceSelection;
}

// Everything a worker hands the main thread to draw skinned meshes: see SkinGpu.
export interface SkinnedGeometry {
    readonly vertices: Uint8Array;
    readonly indices: Int32Array;
    readonly influences: Uint32Array;
    readonly matrixTable: Float32Array;
}

export function skinnedGeometryTransferables(geometry: SkinnedGeometry): ArrayBuffer[] {
    return [
        geometry.vertices.buffer,
        geometry.indices.buffer,
        geometry.influences.buffer,
        geometry.matrixTable.buffer,
    ] as ArrayBuffer[];
}

export interface SkinnedRig {
    readonly meshes: readonly SkinnedMesh[];
    readonly restFrame: SkinFrame;
    readonly animationsBySeqId: ReadonlyMap<number, readonly SkinFrame[]>;
}

type RigFrames = Omit<SkinnedRig, "meshes">;

export class Skinning {
    constructor(
        readonly meshes: SkinnedMeshBuilder,
        readonly palettes: SkinPaletteBuilder,
        private readonly seqTypes: SeqTypeLoader,
        private readonly seqFrames: SeqFrameLoader,
        private readonly skeletalSeqs: SkeletalSeqLoader,
    ) {}

    // Several meshes posed by one set of matrices, computed from poseModel's vertex labels (or its
    // bones). The player's items share the body's rig this way.
    addRig(
        poseModel: Model,
        meshSources: readonly SkinMeshSource[],
        seqs: readonly PoseableSeq[],
        space: PoseSpace,
    ): SkinnedRig {
        const seqIds = new Set(seqs.map((seq) => seq.seqId));
        if (seqIds.size !== seqs.length) {
            throw new Error(`A rig poses each seq once, received ${seqs.map((seq) => seq.seqId)}`);
        }
        const rigged = rigSeqs([poseModel, ...meshSources.map((source) => source.model)], seqs);
        const meshes = meshSources.map((source) =>
            this.meshes.addModel(source.model, rigged.rig, source.selection),
        );
        return { meshes, ...this.addFrames(poseModel, rigged, space) };
    }

    addAnimationSet(
        model: Model,
        seqs: readonly PoseableSeq[],
        space: PoseSpace,
    ): SkinAnimationSet {
        const rig = this.addRig(
            model,
            [{ model, selection: SkinFaceSelection.all() }],
            seqs,
            space,
        );
        return { mesh: rig.meshes[0], animationsBySeqId: rig.animationsBySeqId };
    }

    addStatic(model: Model): SkinAnimation {
        const rig = this.addRig(
            model,
            [{ model, selection: SkinFaceSelection.all() }],
            [],
            PoseSpace.identity(),
        );
        return { mesh: rig.meshes[0], frames: [rig.restFrame] };
    }

    addAnimation(model: Model, seqId: number): SkinAnimation {
        const set = this.addAnimationSet(model, [this.requireSeq(seqId)], PoseSpace.identity());
        return { mesh: set.mesh, frames: set.animationsBySeqId.get(seqId)! };
    }

    build(): { readonly geometry: SkinnedGeometry; readonly usedTextureIds: ReadonlySet<number> } {
        const meshData = this.meshes.build();
        return {
            geometry: {
                vertices: meshData.vertices,
                indices: meshData.indices,
                influences: meshData.influences,
                matrixTable: this.palettes.build(),
            },
            usedTextureIds: meshData.usedTextureIds,
        };
    }

    // Undefined when the cache has nothing poseable for the sequence: no frames, or an old-style
    // frame that fails to load.
    loadSeq(seqId: number): PoseableSeq | undefined {
        const sequence = this.seqTypes.load(seqId);
        if (sequence.isSkeletalSeq()) {
            const playback = loadSkeletalPlayback(sequence, this.skeletalSeqs);
            return playback.frameCount > 0
                ? { kind: SeqPoseKind.SKELETAL, seqId, ...playback }
                : undefined;
        }
        if (!sequence.frameIds || sequence.frameIds.length === 0) {
            return undefined;
        }
        const frames: SeqFrame[] = [];
        for (const frameId of sequence.frameIds) {
            const frame = this.seqFrames.load(frameId);
            if (!frame) {
                return undefined;
            }
            frames.push(frame);
        }
        return { kind: SeqPoseKind.FRAMES, seqId, frames };
    }

    requireSeq(seqId: number): PoseableSeq {
        const seq = this.loadSeq(seqId);
        if (!seq) {
            throw new Error(`Sequence ${seqId} has no poseable frames`);
        }
        return seq;
    }

    private addFrames(poseModel: Model, rigged: RiggedSeqs, space: PoseSpace): RigFrames {
        const animationsBySeqId = new Map<number, readonly SkinFrame[]>();
        switch (rigged.kind) {
            case SeqPoseKind.FRAMES: {
                const poser = new FramePoser(
                    VertexLabelStats.fromModel(poseModel),
                    space,
                    rigged.rig.matrixSourceLabels,
                    rigged.rig.alphaSourceLabels,
                );
                for (const { seqId, frames } of rigged.seqs) {
                    animationsBySeqId.set(
                        seqId,
                        frames.map((frame) => this.palettes.addFrame(poser.pose(frame))),
                    );
                }
                return { restFrame: this.palettes.addFrame(poser.rest()), animationsBySeqId };
            }
            case SeqPoseKind.SKELETAL: {
                const poser = new SkeletalPoser(
                    space,
                    rigged.rig.bones,
                    rigged.rig.alphaSourceLabels,
                );
                for (const { seqId, seq, frameCount } of rigged.seqs) {
                    animationsBySeqId.set(
                        seqId,
                        Array.from({ length: frameCount }, (_, frame) =>
                            this.palettes.addFrame(poser.pose(seq, frame)),
                        ),
                    );
                }
                return { restFrame: this.palettes.addFrame(poser.rest()), animationsBySeqId };
            }
        }
    }
}
