import { SeqTiming } from "./Animation";
import {
    WardenSlamTarget,
    WardenSlamTempo,
    WardenSlamTiming,
    WardenStance,
    WardenStanceTiming,
} from "./WardenP3Director";

export type WardenSlamSeq = {
    readonly seqId: number;
    // The frame the Warden's fist meets the floor, where the floor wave sets off.
    readonly impactFrame: number;
};

export type WardenStanceSeqs = {
    readonly transitionSeqId: number;
    // Loops in place of the Warden's idle until the next stance change.
    readonly holdSeqId: number;
};

// The Wardens P3 script's own Warden animations, as the encounter declares them.
export type WardenP3AnimationIds = {
    readonly slams: Readonly<
        Record<WardenSlamTempo, Readonly<Record<WardenSlamTarget, WardenSlamSeq>>>
    >;
    readonly stances: Readonly<Record<WardenStance, WardenStanceSeqs>>;
};

export type ResolvedWardenSlam = WardenSlamTiming & { readonly seq: SeqTiming };

export type ResolvedWardenStance = WardenStanceTiming & {
    readonly transition: SeqTiming;
    readonly hold: SeqTiming;
};

// Resolved when the encounter loads (see assets/encounterAnimations.ts). Its slams and stances
// double as the director's slam cadence and stance pauses, so the director times the fight off
// the very sequences the Warden plays.
export type WardenP3Animations = {
    readonly slams: Readonly<
        Record<WardenSlamTempo, Readonly<Record<WardenSlamTarget, ResolvedWardenSlam>>>
    >;
    readonly stances: Readonly<Record<WardenStance, ResolvedWardenStance>>;
};

export function wardenP3AnimationSeqIds(ids: WardenP3AnimationIds): readonly number[] {
    const slamSeqIds = Object.values(ids.slams).flatMap((slams) =>
        Object.values(slams).map((slam) => slam.seqId),
    );
    const stanceSeqIds = Object.values(ids.stances).flatMap((stance) => [
        stance.transitionSeqId,
        stance.holdSeqId,
    ]);
    return [...new Set([...slamSeqIds, ...stanceSeqIds])];
}
