import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { Model } from "../../../rs/model/Model";
import { AffineTransform, VertexLabelStats } from "../../../rs/model/animation/FramePalette";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { ActorFaceSelection, ActorMeshBuilder } from "../actor/ActorMeshBuilder";
import { ActorPaletteBuilder } from "../actor/ActorPaletteBuilder";
import { ActorAnimation, ActorAnimationSet, ActorFrame } from "../actor/ActorRenderData";
import { ActorRig } from "../actor/ActorRig";

export class ActorSkinning {
    constructor(
        readonly meshes: ActorMeshBuilder,
        readonly palettes: ActorPaletteBuilder,
        private readonly seqTypes: SeqTypeLoader,
        private readonly seqFrames: SeqFrameLoader,
    ) {}

    addAnimationSet(
        model: Model,
        seqIds: readonly number[],
        selection: ActorFaceSelection,
        postTransform: AffineTransform,
    ): ActorAnimationSet {
        const framesBySeqId = new Map<number, readonly (SeqFrame | undefined)[]>();
        for (const seqId of new Set(seqIds)) {
            framesBySeqId.set(seqId, this.loadFrames(seqId));
        }
        const rig = ActorRig.oldStyle(
            [model],
            [...framesBySeqId.values()].flat().filter((frame): frame is SeqFrame => !!frame),
        );
        const mesh = this.meshes.addModel(model, rig, selection);
        const stats = VertexLabelStats.fromModel(model);
        const animationsBySeqId = new Map<number, readonly ActorFrame[]>();
        for (const [seqId, frames] of framesBySeqId) {
            animationsBySeqId.set(
                seqId,
                frames.map((frame) => this.palettes.addFrame(stats, rig, frame, postTransform)),
            );
        }
        return { mesh, animationsBySeqId };
    }

    addAnimation(model: Model, seqId: number | undefined): ActorAnimation {
        if (seqId === undefined) {
            const rig = ActorRig.oldStyle([model], []);
            const stats = VertexLabelStats.fromModel(model);
            return {
                mesh: this.meshes.addModel(model, rig, ActorFaceSelection.all()),
                frames: [this.palettes.addFrame(stats, rig, undefined, AffineTransform.identity())],
            };
        }
        const set = this.addAnimationSet(
            model,
            [seqId],
            ActorFaceSelection.all(),
            AffineTransform.identity(),
        );
        return { mesh: set.mesh, frames: set.animationsBySeqId.get(seqId)! };
    }

    loadFrames(seqId: number): readonly (SeqFrame | undefined)[] {
        const sequence = this.seqTypes.load(seqId);
        if (sequence.isSkeletalSeq()) {
            return [undefined];
        }
        if (!sequence.frameIds || sequence.frameIds.length === 0) {
            throw new Error(`Actor sequence ${seqId} has no frames`);
        }
        return sequence.frameIds.map((frameId) => {
            const frame = this.seqFrames.load(frameId);
            if (!frame) {
                throw new Error(`Actor sequence ${seqId} is missing frame ${frameId}`);
            }
            return frame;
        });
    }
}
