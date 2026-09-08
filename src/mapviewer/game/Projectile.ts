import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";
import { CombatEvent, applyDamage } from "./CombatEvent";
import { Combatant, Faction } from "./Combatant";
import { combatantsHitByGroundStrike } from "./GroundStrike";
import { VisualEffectKind } from "./VisualEffect";
import {
    ProjectileArcProfile,
    ProjectileArcShape,
    computeArcOffset,
    computeProjectilePitch,
    directionToRotation,
    findLandingHit,
    findSweepHit,
    pitchRadiansToRotationUnits,
    reaimTowardTarget,
} from "./projectileMath";

export enum ProjectileKind {
    ARROW,
    MAGIC,
    POWER_SHOT,
    JAD_MAGE_BLAST,
    JAD_RANGED_ROCK,
    TOK_XIL_SHOT,
    KET_ZEK_FIRE_BLAST,
}

export enum ProjectileOutcome {
    ALIVE = 0,
    HIT = 1,
    EXPIRED = 2,
}

export const FIRE_BOLT_TRAVEL_SEQ_ID = 661;
export const FIRE_BOLT_HIT_SEQ_ID = 662;

export type ProjectileHitEffect = {
    readonly kind: VisualEffectKind;
    readonly seqId: number;
    readonly height: number;
};

// A projectile either arcs to a landing point (no in-flight collision, damage resolved once on
// arrival), flies flat with the classic swept collision along its path, or drops straight down from
// a fixed height onto a point, damaging in radius on arrival. Piercing and homing only make sense
// for the straight case, so they live on that variant rather than as flags an arc or drop could
// accidentally be given. An arc's landing point is either fixed at fire time or kept tracking its
// target's current position as it flies (see Projectile.retargetArcLanding).
export type ProjectileFlight =
    | {
          readonly kind: "ARC";
          readonly profile: ProjectileArcProfile;
          readonly landing: "FIXED_POINT" | "TRACK_TARGET";
          readonly shape: ProjectileArcShape;
      }
    | { readonly kind: "STRAIGHT"; readonly piercing: boolean; readonly homing: boolean }
    | { readonly kind: "DROP"; readonly startHeight: number };

export type ProjectileSpec = {
    kind: ProjectileKind;
    speed: number;
    range: number;
    hitRadius: number;
    damage: number;
    flight: ProjectileFlight;
    travelSeqId: number;
    hitEffect?: ProjectileHitEffect;
};

export const ARROW_SPEC: ProjectileSpec = {
    kind: ProjectileKind.ARROW,
    speed: 2048,
    range: 4096,
    hitRadius: 16,
    damage: 8,
    flight: {
        kind: "ARC",
        profile: { baseHeight: 204.8, heightPerDistance: 0.12, maxHeight: 614.4 },
        landing: "TRACK_TARGET",
        shape: "SYMMETRIC",
    },
    travelSeqId: -1,
};

// Volley fires a spread of arrows at once; unlike the single aimed basic shot, each arrow in the
// spread keeps flying (and can be swept-collided with) along its own diverging line rather than
// arcing down onto one landing point.
export const VOLLEY_ARROW_SPEC: ProjectileSpec = {
    ...ARROW_SPEC,
    flight: { kind: "STRAIGHT", piercing: false, homing: false },
};

export const MAGIC_SPEC: ProjectileSpec = {
    kind: ProjectileKind.MAGIC,
    speed: 3072,
    range: 4096,
    hitRadius: 16,
    damage: 12,
    flight: { kind: "STRAIGHT", piercing: false, homing: false },
    travelSeqId: FIRE_BOLT_TRAVEL_SEQ_ID,
    hitEffect: { kind: VisualEffectKind.MAGIC_HIT, seqId: FIRE_BOLT_HIT_SEQ_ID, height: 124 },
};

export const POWER_SHOT_SPEC: ProjectileSpec = {
    kind: ProjectileKind.POWER_SHOT,
    speed: 1792,
    range: 4096,
    hitRadius: 24,
    damage: 20,
    flight: { kind: "STRAIGHT", piercing: true, homing: false },
    travelSeqId: -1,
};

// TzTok-Jad's mage blast: a slow, big, non-homing fireball that leaves his mouth already at the
// apex (DESCENDING shape, not the arrow's up-then-down SYMMETRIC one) and falls from there onto the
// player's position at cast end, travelling 8 tiles in 1.5s so it can be sidestepped (the landing
// point is fixed at cast end, not tracked, so moving away from it dodges the hit). Uses Jad's own
// fire graphic (SpotAnimType ids 449 travel / 450 impact, both driven by sequence JAD_FIRE_SEQ_ID)
// rather than the player's fire bolt spell graphic. damage is overridden per cast by
// JadMageBlastEffect.damageMin/Max; this fixed value is never actually applied.
const JAD_MAGE_BLAST_TRAVEL_TILES = 8;
const JAD_MAGE_BLAST_TRAVEL_SECONDS = 1.5;
export const JAD_FIRE_SEQ_ID = 2659;

export const JAD_MAGE_BLAST_SPEC: ProjectileSpec = {
    kind: ProjectileKind.JAD_MAGE_BLAST,
    speed: (JAD_MAGE_BLAST_TRAVEL_TILES * 128) / JAD_MAGE_BLAST_TRAVEL_SECONDS,
    range: 12 * 128,
    hitRadius: 48,
    damage: 32,
    flight: {
        kind: "ARC",
        profile: { baseHeight: 400, heightPerDistance: 0.3, maxHeight: 900 },
        landing: "FIXED_POINT",
        shape: "DESCENDING",
    },
    travelSeqId: JAD_FIRE_SEQ_ID,
    hitEffect: { kind: VisualEffectKind.JAD_FIRE_HIT, seqId: JAD_FIRE_SEQ_ID, height: 124 },
};

// TzTok-Jad's ranged attack: a boulder (SpotAnimType id 451) that spawns high above the target and
// falls straight down, damaging every combatant in radius on landing rather than sweeping or arcing.
// damage is overridden per cast by JAD_RANGED_STOMP's damageMin/Max; this fixed value is never
// actually applied. range matches the old ground-strike's cast range so Jad still engages at the
// same distance (see Enemy.enemyAttackRange).
const JAD_RANGED_ROCK_FALL_HEIGHT = 3000;
const JAD_RANGED_ROCK_FALL_SECONDS = 1.6;
export const JAD_RANGED_ROCK_SEQ_ID = 2660;

export const JAD_RANGED_ROCK_SPEC: ProjectileSpec = {
    kind: ProjectileKind.JAD_RANGED_ROCK,
    speed: JAD_RANGED_ROCK_FALL_HEIGHT / JAD_RANGED_ROCK_FALL_SECONDS,
    range: 10 * 128,
    hitRadius: 1.5 * 128,
    damage: 30,
    flight: { kind: "DROP", startHeight: JAD_RANGED_ROCK_FALL_HEIGHT },
    travelSeqId: JAD_RANGED_ROCK_SEQ_ID,
};

// Tok-Xil's ranged shot: a straight, non-homing bolt (SpotAnimType ids 446 travel / 445 hit, both
// found next to the confirmed TzHaar block 444/448-451 - see EnemyType.ts's TOK_XIL comment; medium
// confidence only, not visually confirmed through the animation viewer). range matches the old
// ground-strike's cast range so Tok-Xil still engages at the same distance (see
// Enemy.enemyAttackRange). damage is overridden per cast by TOK_XIL_RANGED_SHOT's damageMin/Max;
// this fixed value is never actually applied.
export const TOK_XIL_SHOT_TRAVEL_SEQ_ID = 2649;
export const TOK_XIL_SHOT_HIT_SEQ_ID = 2648;

export const TOK_XIL_SHOT_SPEC: ProjectileSpec = {
    kind: ProjectileKind.TOK_XIL_SHOT,
    speed: 2048,
    range: 11 * 128,
    hitRadius: 128,
    damage: 6,
    flight: { kind: "STRAIGHT", piercing: false, homing: false },
    travelSeqId: TOK_XIL_SHOT_TRAVEL_SEQ_ID,
    hitEffect: {
        kind: VisualEffectKind.TOK_XIL_SHOT_HIT,
        seqId: TOK_XIL_SHOT_HIT_SEQ_ID,
        height: 96,
    },
};

// Ket-Zek's fire blast: a straight, non-homing bolt (SpotAnimType ids 452 travel / 453 hit, both
// found next to the confirmed TzHaar block - see EnemyType.ts's KET_ZEK comment; medium confidence
// only, not visually confirmed through the animation viewer). Slower than Tok-Xil's shot for a
// heavier-feeling cast. range matches the old ground-strike's cast range (see
// Enemy.enemyAttackRange). damage is overridden per cast by KET_ZEK_FIRE_BLAST's damageMin/Max;
// this fixed value is never actually applied.
export const KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID = 2718;
export const KET_ZEK_FIRE_BLAST_HIT_SEQ_ID = 2719;

export const KET_ZEK_FIRE_BLAST_SPEC: ProjectileSpec = {
    kind: ProjectileKind.KET_ZEK_FIRE_BLAST,
    speed: 1024,
    range: 10 * 128,
    hitRadius: 128,
    damage: 18,
    flight: { kind: "STRAIGHT", piercing: false, homing: false },
    travelSeqId: KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    hitEffect: {
        kind: VisualEffectKind.KET_ZEK_FIRE_BLAST_HIT,
        seqId: KET_ZEK_FIRE_BLAST_HIT_SEQ_ID,
        height: 124,
    },
};

export class Projectile {
    static readonly START_HEIGHT = 128;

    x: number;
    y: number;
    height: number;
    rotation: number;
    pitch: number = 0;
    hitTarget?: Combatant;
    readonly animation: AnimationState;

    private directionX: number;
    private directionY: number;
    private readonly launchX: number;
    private readonly launchY: number;
    private distanceTraveled = 0;
    private readonly piercedCombatants = new Set<Combatant>();

    constructor(
        readonly spec: ProjectileSpec,
        readonly sourceFaction: Faction,
        readonly level: number,
        startX: number,
        startY: number,
        directionX: number,
        directionY: number,
        private referenceDistance: number,
        private readonly homingTarget?: Combatant,
    ) {
        this.x = startX;
        this.y = startY;
        this.launchX = startX;
        this.launchY = startY;
        const length = Math.hypot(directionX, directionY);
        this.directionX = length === 0 ? 0 : directionX / length;
        this.directionY = length === 0 ? 0 : directionY / length;
        this.rotation = directionToRotation(this.directionX, this.directionY);
        this.height =
            spec.flight.kind === "DROP" ? spec.flight.startHeight : Projectile.START_HEIGHT;
        this.animation = new AnimationState(spec.travelSeqId);
    }

    update(
        dtSeconds: number,
        combatants: readonly Combatant[],
        events: CombatEvent[],
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): ProjectileOutcome {
        this.animation.advance(dtSeconds, seqTypeLoader, seqFrameLoader, AnimationPlayback.LOOP);

        if (
            this.spec.flight.kind === "STRAIGHT" &&
            this.spec.flight.homing &&
            this.homingTarget &&
            this.homingTarget.health > 0
        ) {
            const reaimed = reaimTowardTarget(
                this.directionX,
                this.directionY,
                this.x,
                this.y,
                this.homingTarget.x,
                this.homingTarget.y,
            );
            this.directionX = reaimed.x;
            this.directionY = reaimed.y;
            this.rotation = directionToRotation(this.directionX, this.directionY);
        }

        const stepDistance = this.spec.speed * dtSeconds;
        switch (this.spec.flight.kind) {
            case "ARC":
                return this.updateArcFlight(
                    stepDistance,
                    this.spec.flight.profile,
                    this.spec.flight.landing,
                    this.spec.flight.shape,
                    combatants,
                    events,
                );
            case "STRAIGHT":
                return this.updateStraightFlight(
                    stepDistance,
                    this.spec.flight.piercing,
                    combatants,
                    events,
                );
            case "DROP":
                return this.updateDropFlight(stepDistance, combatants, events);
        }
    }

    // Flies to a landing point, either fixed at fire time or (for TRACK_TARGET) re-aimed onto the
    // target's current position every step, with no in-flight collision; damage resolves once, on
    // arrival, against whatever is in radius there.
    private updateArcFlight(
        stepDistance: number,
        profile: ProjectileArcProfile,
        landing: "FIXED_POINT" | "TRACK_TARGET",
        shape: ProjectileArcShape,
        combatants: readonly Combatant[],
        events: CombatEvent[],
    ): ProjectileOutcome {
        if (landing === "TRACK_TARGET" && this.homingTarget && this.homingTarget.health > 0) {
            this.retargetArcLanding(this.homingTarget.x, this.homingTarget.y);
        }

        const remainingDistance = this.referenceDistance - this.distanceTraveled;
        if (stepDistance < remainingDistance) {
            this.x += this.directionX * stepDistance;
            this.y += this.directionY * stepDistance;
            this.distanceTraveled += stepDistance;
            this.height =
                Projectile.START_HEIGHT +
                computeArcOffset(this.distanceTraveled, this.referenceDistance, profile, shape);
            this.pitch = pitchRadiansToRotationUnits(
                computeProjectilePitch(
                    this.distanceTraveled,
                    this.referenceDistance,
                    profile,
                    shape,
                ),
            );
            return ProjectileOutcome.ALIVE;
        }

        this.x += this.directionX * remainingDistance;
        this.y += this.directionY * remainingDistance;
        this.distanceTraveled = this.referenceDistance;
        this.height = Projectile.START_HEIGHT;
        this.pitch = pitchRadiansToRotationUnits(
            computeProjectilePitch(this.distanceTraveled, this.referenceDistance, profile, shape),
        );

        const landedOn = findLandingHit(
            this.x,
            this.y,
            this.spec.hitRadius,
            this.level,
            this.sourceFaction,
            combatants,
        );
        if (!landedOn) {
            return ProjectileOutcome.EXPIRED;
        }
        this.hitTarget = landedOn;
        applyDamage(landedOn, this.spec.damage, events);
        return ProjectileOutcome.HIT;
    }

    // Re-aims a TRACK_TARGET arc's landing point onto the target's current position: the reference
    // distance is recomputed from the original launch point, and distanceTraveled is rescaled to the
    // same progress fraction so height/pitch stay continuous rather than jumping.
    private retargetArcLanding(targetX: number, targetY: number): void {
        const deltaX = targetX - this.launchX;
        const deltaY = targetY - this.launchY;
        const newReferenceDistance = Math.hypot(deltaX, deltaY);
        if (newReferenceDistance === 0) {
            return;
        }
        const progress =
            this.referenceDistance > 0 ? this.distanceTraveled / this.referenceDistance : 0;
        this.directionX = deltaX / newReferenceDistance;
        this.directionY = deltaY / newReferenceDistance;
        this.rotation = directionToRotation(this.directionX, this.directionY);
        this.referenceDistance = newReferenceDistance;
        this.distanceTraveled = progress * newReferenceDistance;
        this.x = this.launchX + this.directionX * this.distanceTraveled;
        this.y = this.launchY + this.directionY * this.distanceTraveled;
    }

    private updateStraightFlight(
        stepDistance: number,
        piercing: boolean,
        combatants: readonly Combatant[],
        events: CombatEvent[],
    ): ProjectileOutcome {
        const nextX = this.x + this.directionX * stepDistance;
        const nextY = this.y + this.directionY * stepDistance;

        const hit = findSweepHit(
            this.x,
            this.y,
            nextX,
            nextY,
            this.spec.hitRadius,
            this.level,
            this.sourceFaction,
            combatants,
            piercing ? this.piercedCombatants : undefined,
        );
        const fraction = hit ? hit.fraction : 1;
        this.x += (nextX - this.x) * fraction;
        this.y += (nextY - this.y) * fraction;
        this.distanceTraveled += stepDistance * fraction;
        if (hit) {
            this.hitTarget = hit.combatant;
            applyDamage(hit.combatant, this.spec.damage, events);
            if (piercing) {
                this.piercedCombatants.add(hit.combatant);
            } else {
                return ProjectileOutcome.HIT;
            }
        }
        return this.distanceTraveled < this.spec.range
            ? ProjectileOutcome.ALIVE
            : ProjectileOutcome.EXPIRED;
    }

    // Falls straight down from its starting height with no horizontal movement, then resolves
    // damage once, on landing, against every combatant in radius (not just the closest one).
    private updateDropFlight(
        stepDistance: number,
        combatants: readonly Combatant[],
        events: CombatEvent[],
    ): ProjectileOutcome {
        const remainingHeight = this.height;
        if (stepDistance < remainingHeight) {
            this.height -= stepDistance;
            return ProjectileOutcome.ALIVE;
        }
        this.height = 0;

        const hits = combatantsHitByGroundStrike(
            {
                x: this.x,
                y: this.y,
                level: this.level,
                radius: this.spec.hitRadius,
                sourceFaction: this.sourceFaction,
            },
            combatants,
        );
        if (hits.length === 0) {
            return ProjectileOutcome.EXPIRED;
        }
        for (const hit of hits) {
            this.hitTarget = hit;
            applyDamage(hit, this.spec.damage, events);
        }
        return ProjectileOutcome.HIT;
    }
}
