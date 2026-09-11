import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { Model } from "../../../rs/model/Model";
import { PoseSpace, VertexLabelStats } from "../../../rs/model/animation/FramePalette";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { SkinAnimation, SkinAnimationSet, SkinFrame } from "./SkinAnimation";
import { SkinPaletteBuilder } from "./SkinPaletteBuilder";
import { SkinRig } from "./SkinRig";
import { SkinFaceSelection, SkinnedMesh, SkinnedMeshBuilder } from "./SkinnedMeshBuilder";

// One entry per frame of a sequence. Skeletal sequences are not posed yet, so each of their frames
// is undefined and renders the rest pose.
export type SkinSeqFrames = readonly (SeqFrame | undefined)[];

export interface SkinMeshSource {
    readonly model: Model;
    readonly selection: SkinFaceSelection;
}

export interface SkinnedRig {
    readonly meshes: readonly SkinnedMesh[];
    readonly restFrame: SkinFrame;
    readonly animationsBySeqId: ReadonlyMap<number, readonly SkinFrame[]>;
}

export class Skinning {
    constructor(
        readonly meshes: SkinnedMeshBuilder,
        readonly palettes: SkinPaletteBuilder,
        private readonly seqTypes: SeqTypeLoader,
        private readonly seqFrames: SeqFrameLoader,
    ) {}

    // Several meshes posed by one set of matrices, computed from poseModel's vertex labels. The
    // player's items share the body's rig this way.
    addRig(
        poseModel: Model,
        meshSources: readonly SkinMeshSource[],
        framesBySeqId: ReadonlyMap<number, SkinSeqFrames>,
        space: PoseSpace,
    ): SkinnedRig {
        const rig = SkinRig.oldStyle(
            [poseModel, ...meshSources.map((source) => source.model)],
            [...framesBySeqId.values()].flat().filter((frame): frame is SeqFrame => !!frame),
        );
        const meshes = meshSources.map((source) =>
            this.meshes.addModel(source.model, rig, source.selection),
        );
        const stats = VertexLabelStats.fromModel(poseModel);
        const restFrame = this.palettes.addFrame(stats, rig, undefined, space);
        const animationsBySeqId = new Map<number, readonly SkinFrame[]>();
        for (const [seqId, frames] of framesBySeqId) {
            animationsBySeqId.set(
                seqId,
                frames.map((frame) =>
                    frame ? this.palettes.addFrame(stats, rig, frame, space) : restFrame,
                ),
            );
        }
        return { meshes, restFrame, animationsBySeqId };
    }

    addAnimationSet(
        model: Model,
        framesBySeqId: ReadonlyMap<number, SkinSeqFrames>,
        space: PoseSpace,
    ): SkinAnimationSet {
        const rig = this.addRig(
            model,
            [{ model, selection: SkinFaceSelection.all() }],
            framesBySeqId,
            space,
        );
        return { mesh: rig.meshes[0], animationsBySeqId: rig.animationsBySeqId };
    }

    addStatic(model: Model): SkinAnimation {
        const rig = this.addRig(
            model,
            [{ model, selection: SkinFaceSelection.all() }],
            new Map(),
            PoseSpace.identity(),
        );
        return { mesh: rig.meshes[0], frames: [rig.restFrame] };
    }

    addAnimation(model: Model, seqId: number): SkinAnimation {
        const set = this.addAnimationSet(
            model,
            new Map([[seqId, this.requireFrames(seqId)]]),
            PoseSpace.identity(),
        );
        return { mesh: set.mesh, frames: set.animationsBySeqId.get(seqId)! };
    }

    // Undefined when the cache has nothing poseable for the sequence: no frames, or a frame that
    // fails to load.
    loadFrames(seqId: number): SkinSeqFrames | undefined {
        const sequence = this.seqTypes.load(seqId);
        if (sequence.isSkeletalSeq()) {
            const duration = sequence.getSkeletalDuration();
            return duration > 0 ? new Array<undefined>(duration).fill(undefined) : undefined;
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
        return frames;
    }

    requireFrames(seqId: number): SkinSeqFrames {
        const frames = this.loadFrames(seqId);
        if (!frames) {
            throw new Error(`Sequence ${seqId} has no poseable frames`);
        }
        return frames;
    }
}
