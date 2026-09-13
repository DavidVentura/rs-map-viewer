import { AnimationPlayback, AnimationState, SeqTiming } from "./Animation";
import { ResolvedEnemyType } from "./EnemyType";
import { EnergySiphon } from "./EnergySiphon";

export enum EncounterActorKind {
    ENERGY_SIPHON = "energy_siphon",
    PHANTOM = "phantom",
}

type EncounterActorCommon = {
    readonly id: number;
    x: number;
    y: number;
    readonly level: number;
    rotation: number;
    readonly type: ResolvedEnemyType;
    readonly animation: AnimationState;
    // Overrides the idle loop for one playthrough (e.g. a phantom's attack windup), reverting to
    // idle once it completes. Set via playEncounterActorSeq.
    activeSeq?: SeqTiming;
};

// A non-combat encounter prop: it has a position/rotation/animation like an Enemy, but never
// enters combatants(), enemy AI, wave/kill bookkeeping or damage paths. A siphon carries its own
// interaction state; a phantom carries nothing beyond the common fields, since it is never
// targeted and only ever plays an animation.
export type EncounterActor =
    | (EncounterActorCommon & {
          readonly kind: EncounterActorKind.ENERGY_SIPHON;
          siphon: EnergySiphon;
          // The rotation the siphon turns to once reversed (the layout's authored facing; the
          // actor spawns facing the opposite way, see createEnergySiphonActor).
          readonly reversedRotation: number;
      })
    | (EncounterActorCommon & { readonly kind: EncounterActorKind.PHANTOM });

export type EnergySiphonActor = Extract<EncounterActor, { kind: EncounterActorKind.ENERGY_SIPHON }>;

export function createEnergySiphonActor(
    id: number,
    x: number,
    y: number,
    level: number,
    type: ResolvedEnemyType,
    facingRotation: number,
    siphon: EnergySiphon,
): EnergySiphonActor {
    return {
        kind: EncounterActorKind.ENERGY_SIPHON,
        id,
        x,
        y,
        level,
        type,
        animation: new AnimationState(type.seqs.idle),
        // The siphon spawns facing away from its reversed pose, and turns to face
        // reversedRotation once a basic melee attack reverses it.
        rotation: (facingRotation + 1024) % 2048,
        reversedRotation: facingRotation,
        siphon,
    };
}

export function createPhantomActor(
    id: number,
    x: number,
    y: number,
    level: number,
    type: ResolvedEnemyType,
    rotation: number,
): EncounterActor {
    return {
        kind: EncounterActorKind.PHANTOM,
        id,
        x,
        y,
        level,
        type,
        rotation,
        animation: new AnimationState(type.seqs.idle),
    };
}

export function encounterActorProjectileLaunchHeight(actor: EncounterActor): number {
    return actor.type.projectileLaunchHeight;
}

// Tells the actor to play a sequence once - e.g. a phantom's attack windup, whose launch
// position/timing a caller can then read straight off the actor (x/y/projectileLaunchHeight) in
// step with this animation, rather than needing a separate command/state channel.
export function playEncounterActorSeq(actor: EncounterActor, seq: SeqTiming): void {
    actor.activeSeq = seq;
}

// Advances the actor's animation for one tick: whatever activeSeq was last set to plays once and
// then falls back to idle, otherwise idle loops continuously.
export function updateEncounterActor(actor: EncounterActor, deltaTimeSeconds: number): void {
    if (actor.activeSeq) {
        actor.animation.setSequence(actor.activeSeq);
        if (actor.animation.advance(deltaTimeSeconds, AnimationPlayback.ONCE)) {
            actor.activeSeq = undefined;
        }
        return;
    }
    actor.animation.setSequence(actor.type.seqs.idle);
    actor.animation.advance(deltaTimeSeconds);
}
