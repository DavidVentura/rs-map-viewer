import { SeqTiming } from "./Animation";
import { VisualEffectKind } from "./VisualEffect";
import {
    WardenPhantom,
    WardenPhantomAttackTiming,
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

export type WardenPhantomAttackSeq = {
    readonly seqId: number;
    // The frame the phantom lets its attack go: Zebak's projectile leaves, Ba-Ba's rocks drop.
    readonly releaseFrame: number;
};

// A rock graphic that animates its own fall, so the rock lands when the graphic reaches
// landingFrame rather than at a travel time of the game's choosing.
export type WardenRockFallGraphic = {
    readonly effect: VisualEffectKind;
    readonly landingFrame: number;
};

// The Wardens P3 script's phantom animations, as the encounter declares them.
export type WardenPhantomAnimationIds = {
    readonly attacks: Readonly<Record<WardenPhantom, WardenPhantomAttackSeq>>;
    readonly rockFall: WardenRockFallGraphic;
};

// The shadow that grows on a siphon's tile from the moment it is thrown, landing the siphon as it
// reaches landingFrame.
export type WardenSiphonLandingShadow = {
    readonly effect: VisualEffectKind;
    readonly landingFrame: number;
};

// The Wardens P3 script's siphon intermission beats, as the encounter declares them.
export type WardenSiphonAnimationIds = {
    // The frame of the Warden's charge (its CHARGING transition) the siphons leave its chest.
    readonly launchFrame: number;
    readonly landingShadow: WardenSiphonLandingShadow;
    // A landed hostile siphon leeches the Warden on this frame of every loop of its idle.
    readonly leechFrame: number;
    // The frame of the Warden's release (its STANDING transition) the siphons fly back into it.
    readonly recallFrame: number;
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

export type ResolvedWardenPhantomAttack = WardenPhantomAttackTiming & { readonly seq: SeqTiming };

export type ResolvedWardenRockFall = {
    readonly effect: VisualEffectKind;
    readonly landingSeconds: number;
};

export type WardenPhantomAnimations = {
    readonly attacks: Readonly<Record<WardenPhantom, ResolvedWardenPhantomAttack>>;
    readonly rockFall: ResolvedWardenRockFall;
};

export type WardenSiphonLeechTiming = {
    // Counted from landing, where each siphon's idle restarts.
    readonly firstSeconds: number;
    readonly intervalSeconds: number;
};

export type WardenSiphonAnimations = {
    // From the start of the Warden's charge.
    readonly launchSeconds: number;
    readonly landingShadow: VisualEffectKind;
    readonly flightSeconds: number;
    readonly leech: WardenSiphonLeechTiming;
    // From the start of the Warden's release.
    readonly recallSeconds: number;
};

// Resolved when the encounter loads (see assets/encounterAnimations.ts). Its slams, stances,
// phantom attacks and siphon launch double as the director's slam cadence, stance pauses, phantom
// windups and siphon throw, so the director times the fight off the very sequences the Warden and
// its phantoms play.
export type WardenP3Animations = {
    readonly slams: Readonly<
        Record<WardenSlamTempo, Readonly<Record<WardenSlamTarget, ResolvedWardenSlam>>>
    >;
    readonly stances: Readonly<Record<WardenStance, ResolvedWardenStance>>;
    readonly phantoms: WardenPhantomAnimations;
    readonly siphons: WardenSiphonAnimations;
    // A pulled enrage tile's flight lasts its graphic's tumble.
    readonly pulledTileFlightSeconds: number;
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
