import { SeqType } from "../../config/seqtype/SeqType";
import { SeqTransformType } from "../seq/SeqTransformType";
import { Curve } from "./Curve";
import { SkeletalSeq } from "./SkeletalSeq";
import { SkeletalSeqLoader } from "./SkeletalSeqLoader";

// Deaths and similar sequences run for up to ~1000 client ticks, mostly holding their final pose
// until the OSRS server despawns the entity. Nothing here waits on a server, so at most 6 game
// ticks of that hold are kept.
export const SKELETAL_TAIL_HOLD_FRAMES = 6 * 30;

export type FrameSampledCurve = Pick<Curve, "getValue">;

// An ALPHA group of the sequence's base and the curve that fades its labels.
export type SkeletalAlphaGroup = {
    readonly labels: readonly number[];
    readonly curve: FrameSampledCurve;
};

export type SkeletalPlayback = {
    readonly seq: SkeletalSeq;
    readonly frameCount: number;
};

// Skeletal frame i is curve tick i and lasts one client tick. Both the game's timings and the
// baked palettes come from here, so their frame counts agree.
export function loadSkeletalPlayback(
    seqType: SeqType,
    skeletalSeqs: SkeletalSeqLoader,
): SkeletalPlayback {
    const frameCount = seqType.skeletalFrameCount();
    const seq = skeletalSeqs.load(seqType.skeletalId);
    if (!seq) {
        throw new Error(
            `Skeletal seq ${seqType.skeletalId} of seq ${seqType.id} is missing from the cache`,
        );
    }
    return { seq, frameCount: playedFrameCount(renderedCurves(seq), frameCount) };
}

// The frames up to the last one at which any curve still changes, then at most
// SKELETAL_TAIL_HOLD_FRAMES more of the pose it settled on.
export function playedFrameCount(curves: readonly FrameSampledCurve[], frameCount: number): number {
    let lastChange = 0;
    for (const curve of curves) {
        for (let frame = frameCount - 1; frame > lastChange; frame--) {
            if (curve.getValue(frame) !== curve.getValue(frame - 1)) {
                lastChange = frame;
                break;
            }
        }
    }
    return Math.min(frameCount, lastChange + 1 + SKELETAL_TAIL_HOLD_FRAMES);
}

// Model.transformSkeletalAlpha decides by the base's group type, not the curve's transform type.
export function skeletalAlphaGroups(seq: SkeletalSeq): SkeletalAlphaGroup[] {
    const groups: SkeletalAlphaGroup[] = [];
    for (let group = 0; group < seq.base.count; group++) {
        const curve = seq.curves[group]?.[0];
        if (seq.base.types[group] === SeqTransformType.ALPHA && curve) {
            groups.push({ labels: seq.base.labels[group], curve });
        }
    }
    return groups;
}

// Light curves are left out, as old-style LIGHT operations are ignored when posing.
function renderedCurves(seq: SkeletalSeq): FrameSampledCurve[] {
    const boneCurves = seq.boneCurves.flatMap((curves) => curves.filter((curve) => !!curve));
    return [...boneCurves, ...skeletalAlphaGroups(seq).map((group) => group.curve)];
}
