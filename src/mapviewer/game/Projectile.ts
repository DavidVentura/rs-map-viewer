import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";
import { CombatEvent } from "./CombatEvent";
import { Combatant } from "./Combatant";
import {
    Affects,
    HitEffect,
    Payload,
    applyPayloads,
    combatantsInCircle,
    matchesAffects,
} from "./Effect";
import { TILE_SIZE, Terrain } from "./Terrain";
import { FALLING_SHADOW_SEQ_ID, VisualEffectKind } from "./VisualEffect";
import { RandomSource } from "./abilityRules";
import {
    FlightOrigin,
    FlightPoint,
    FlightState,
    FlightStep,
    directionToRotation,
    findSweepHit,
    launchFlight,
    pitchRadiansToRotationUnits,
    stepFlight,
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

export const FIRE_BOLT_TRAVEL_SEQ_ID = 661;
export const FIRE_BOLT_HIT_SEQ_ID = 662;

// Arrival is baseSeconds + secondsPerTile * distance-in-tiles after launch, the way the OSRS client
// schedules a projectile's end cycle from its start cycle and the tile distance.
export type ProjectileTravelTime = {
    readonly baseSeconds: number;
    readonly secondsPerTile: number;
};

// Where a FIXED_POINT projectile spawns: offset from its caster at the caster's launch height, or
// at the landing point itself at the given height above the ground there (0 when the travel
// sequence animates the whole fall within its own frames, like Jad's boulder).
export type ProjectileOrigin =
    | { readonly kind: "CASTER" }
    | { readonly kind: "AT_TARGET"; readonly height: number };

// TRACKED_COMBATANT follows its target every step and always arrives on it, landing only on it.
// FIXED_POINT flies to the point fixed at cast time and lands on everything the projectile affects
// within hitRadius on arrival, so moving off the point dodges it. FREE_FLIGHT flies toward the
// point at max range with the swept-circle collision along its path; piercing keeps it flying
// through everything it hits.
export type ProjectileLanding =
    | { readonly kind: "TRACKED_COMBATANT"; readonly endHeight: number }
    | {
          readonly kind: "FIXED_POINT";
          readonly endHeight: number;
          readonly hitRadius: number;
          readonly origin: ProjectileOrigin;
          // A ground-anchored visual effect held under the flight path from launch to arrival, so
          // a slow fixed-point projectile (e.g. a dropped rock) telegraphs where it will land.
          readonly telegraph?: HitEffect;
      }
    | { readonly kind: "FREE_FLIGHT"; readonly hitRadius: number; readonly piercing: boolean };

// Whether a projectile's baked model has been reoriented (see ActorRenderDataLoader's arrow
// rotate180) so its own "nose" axis points along the flight direction. Only such a model can carry
// a pitch tilt without it swinging the model's off-origin geometry (built along the vertical axis,
// like every other bake) sideways into a horizontal displacement. A bare spot-anim bake always
// renders LEVEL, whatever its instantaneous flight angle.
export enum ProjectileModelOrientation {
    LEVEL,
    PITCHED,
}

// Purely how a projectile flies and looks; what it does on arrival is the ability's payloads,
// carried per instance (see ProjectileImpact).
export type ProjectileSpec = {
    kind: ProjectileKind;
    launchAngleRadians: number;
    travelTime: ProjectileTravelTime;
    range: number;
    landing: ProjectileLanding;
    travelSeqId: number;
    travelPlayback: AnimationPlayback;
    modelOrientation: ProjectileModelOrientation;
};

const ARROW_LAUNCH_ANGLE_RADIANS = (20 * Math.PI) / 180;

export const ARROW_SPEC: ProjectileSpec = {
    kind: ProjectileKind.ARROW,
    launchAngleRadians: ARROW_LAUNCH_ANGLE_RADIANS,
    travelTime: { baseSeconds: 0.05, secondsPerTile: 1 / 16 },
    range: 4096,
    landing: { kind: "TRACKED_COMBATANT", endHeight: 60 },
    travelSeqId: -1,
    travelPlayback: AnimationPlayback.ONCE,
    modelOrientation: ProjectileModelOrientation.PITCHED,
};

// Volley fires a spread of arrows at once; unlike the single aimed basic shot, each arrow in the
// spread keeps flying (and can be swept-collided with) along its own diverging line rather than
// homing onto one target, so it flies flat instead of lobbing.
export const VOLLEY_ARROW_SPEC: ProjectileSpec = {
    ...ARROW_SPEC,
    launchAngleRadians: 0,
    landing: { kind: "FREE_FLIGHT", hitRadius: 16, piercing: false },
};

export const MAGIC_SPEC: ProjectileSpec = {
    kind: ProjectileKind.MAGIC,
    launchAngleRadians: 0,
    travelTime: { baseSeconds: 0.05, secondsPerTile: 1 / 24 },
    range: 4096,
    landing: { kind: "TRACKED_COMBATANT", endHeight: 80 },
    travelSeqId: FIRE_BOLT_TRAVEL_SEQ_ID,
    travelPlayback: AnimationPlayback.ONCE,
    modelOrientation: ProjectileModelOrientation.LEVEL,
};

export const POWER_SHOT_SPEC: ProjectileSpec = {
    kind: ProjectileKind.POWER_SHOT,
    launchAngleRadians: 0,
    travelTime: { baseSeconds: 0.05, secondsPerTile: 1 / 14 },
    range: 4096,
    landing: { kind: "FREE_FLIGHT", hitRadius: 24, piercing: true },
    travelSeqId: -1,
    travelPlayback: AnimationPlayback.ONCE,
    modelOrientation: ProjectileModelOrientation.PITCHED,
};

// TzTok-Jad's mage blast: a slow, big fireball that leaves his mouth level (angle 0, so from his
// high launch height it only ever descends) and falls onto the player's position at cast end,
// travelling 8 tiles in 1.5s so it can be sidestepped (the landing point is fixed at cast end, not
// tracked, so moving away from it dodges the hit). Uses Jad's own fire graphic (SpotAnimType ids
// 449 travel / 450 impact, both driven by sequence JAD_FIRE_SEQ_ID) rather than the player's fire
// bolt spell graphic.
const JAD_MAGE_BLAST_TRAVEL_TILES = 8;
const JAD_MAGE_BLAST_TRAVEL_SECONDS = 1.5;
export const JAD_FIRE_SEQ_ID = 2659;

export const JAD_MAGE_BLAST_SPEC: ProjectileSpec = {
    kind: ProjectileKind.JAD_MAGE_BLAST,
    launchAngleRadians: 0,
    travelTime: {
        baseSeconds: 0,
        secondsPerTile: JAD_MAGE_BLAST_TRAVEL_SECONDS / JAD_MAGE_BLAST_TRAVEL_TILES,
    },
    range: 12 * TILE_SIZE,
    landing: { kind: "FIXED_POINT", endHeight: 40, hitRadius: 48, origin: { kind: "CASTER" } },
    travelSeqId: JAD_FIRE_SEQ_ID,
    travelPlayback: AnimationPlayback.ONCE,
    modelOrientation: ProjectileModelOrientation.LEVEL,
};

// TzTok-Jad's ranged attack: a boulder (SpotAnimType id 451) landing on every combatant in radius.
// Its sequence 2660 animates the whole fall in its own frames (the model starts ~1150 units up and
// reaches the ground on the last frame, 1.3s in), so the projectile sits at the landing point and
// does not move; it plays the sequence once and arrives as the last frame lands. range matches
// the old ground-strike's cast range so Jad still engages at the same distance (see
// Enemy.enemyAttackRange).
const JAD_RANGED_ROCK_FALL_SECONDS = 1.3;
export const JAD_RANGED_ROCK_SEQ_ID = 2660;

// Grotesque Guardians' falling debris shadow (SpotAnimType id 1446, FALLING_SHADOW_SEQ_ID): the
// closest-duration match (1.8s) to the rock's 1.3s fall among the 1446/1447/2776 candidates,
// telegraphing where it's about to land.
export const JAD_RANGED_ROCK_SPEC: ProjectileSpec = {
    kind: ProjectileKind.JAD_RANGED_ROCK,
    launchAngleRadians: 0,
    travelTime: { baseSeconds: JAD_RANGED_ROCK_FALL_SECONDS, secondsPerTile: 0 },
    range: 10 * TILE_SIZE,
    landing: {
        kind: "FIXED_POINT",
        endHeight: 0,
        hitRadius: 1.5 * TILE_SIZE,
        origin: { kind: "AT_TARGET", height: 0 },
        telegraph: {
            kind: VisualEffectKind.FALLING_SHADOW,
            seqId: FALLING_SHADOW_SEQ_ID,
            height: 0,
        },
    },
    travelSeqId: JAD_RANGED_ROCK_SEQ_ID,
    travelPlayback: AnimationPlayback.ONCE,
    modelOrientation: ProjectileModelOrientation.LEVEL,
};

// Both TzHaar casters throw level (angle 0) from the top of their tall bodies, so the shot only
// descends from their launch height onto the player's position at cast time: no in-flight
// collision, it lands only in radius at the landing point (moving away dodges it).
const TZHAAR_CASTER_LANDING: ProjectileLanding = {
    kind: "FIXED_POINT",
    endHeight: 40,
    hitRadius: TILE_SIZE,
    origin: { kind: "CASTER" },
};

// Tok-Xil's ranged shot: SpotAnimType id 443, a static spike model with no sequence and no impact
// graphic (picked by the user by eye). range matches the old ground-strike's cast range so Tok-Xil
// still engages at the same distance (see Enemy.enemyAttackRange).
export const TOK_XIL_SHOT_SPEC: ProjectileSpec = {
    kind: ProjectileKind.TOK_XIL_SHOT,
    launchAngleRadians: 0,
    travelTime: { baseSeconds: 0.05, secondsPerTile: 1 / 16 },
    range: 11 * TILE_SIZE,
    landing: TZHAAR_CASTER_LANDING,
    travelSeqId: -1,
    travelPlayback: AnimationPlayback.ONCE,
    modelOrientation: ProjectileModelOrientation.LEVEL,
};

// Ket-Zek's fire blast: SpotAnimType id 445 (picked by the user by eye; its sequence 2648 sits
// directly after Ket-Zek's own animation block 2642-2647), with no impact graphic. Slower than
// Tok-Xil's shot for a heavier-feeling cast. range matches the old ground-strike's cast range (see
// Enemy.enemyAttackRange).
export const KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID = 2648;

export const KET_ZEK_FIRE_BLAST_SPEC: ProjectileSpec = {
    kind: ProjectileKind.KET_ZEK_FIRE_BLAST,
    launchAngleRadians: 0,
    travelTime: { baseSeconds: 0.05, secondsPerTile: 1 / 8 },
    range: 10 * TILE_SIZE,
    landing: TZHAAR_CASTER_LANDING,
    travelSeqId: KET_ZEK_FIRE_BLAST_TRAVEL_SEQ_ID,
    travelPlayback: AnimationPlayback.ONCE,
    modelOrientation: ProjectileModelOrientation.LEVEL,
};

export function travelSeconds(travelTime: ProjectileTravelTime, distance: number): number {
    return travelTime.baseSeconds + (travelTime.secondsPerTile * distance) / TILE_SIZE;
}

// What the projectile is currently flying toward. A COMBATANT target's point is re-read every step;
// once it dies the projectile keeps flying to where it was, as a POINT.
export type ProjectileTarget =
    | { readonly kind: "COMBATANT"; readonly combatant: Combatant }
    | { readonly kind: "POINT"; readonly x: number; readonly y: number };

function targetPoint(target: ProjectileTarget): FlightPoint {
    return target.kind === "COMBATANT" ? target.combatant : target;
}

export type ProjectileOutcome =
    | { readonly kind: "ALIVE" }
    | { readonly kind: "HIT_COMBATANT"; readonly combatant: Combatant }
    | { readonly kind: "LANDED"; readonly x: number; readonly y: number }
    | { readonly kind: "EXPIRED" };

// What the projectile does to whoever it lands on, carried over from the ability that fired it.
export type ProjectileImpact = {
    readonly caster: Combatant;
    readonly affects: Affects;
    readonly payloads: readonly Payload[];
    readonly hitEffect?: HitEffect;
};

export class Projectile {
    x: number;
    y: number;
    height: number;
    rotation: number;
    pitch: number;
    readonly animation: AnimationState;

    private flight: FlightState;
    private target: ProjectileTarget;
    private readonly launchHeight: number;
    private readonly piercedCombatants = new Set<Combatant>();

    // Heights are absolute scene heights, like the OSRS client's projectile y: the launch height
    // is added to the ground under the caster once at spawn and the end height to the ground under
    // the target as it flies, so the flight is a clean parabola instead of riding every bump of
    // the terrain it passes over.
    constructor(
        readonly spec: ProjectileSpec,
        readonly impact: ProjectileImpact,
        start: FlightOrigin,
        target: ProjectileTarget,
    ) {
        this.target = target;
        const aim = targetPoint(target);
        const distance = Math.hypot(aim.x - start.x, aim.y - start.y);
        this.flight = launchFlight(
            start,
            aim,
            spec.launchAngleRadians,
            travelSeconds(spec.travelTime, distance),
        );
        this.launchHeight = start.height;
        this.x = start.x;
        this.y = start.y;
        this.height = start.height;
        this.rotation = directionToRotation(aim.x - start.x, aim.y - start.y);
        this.pitch =
            spec.modelOrientation === ProjectileModelOrientation.PITCHED
                ? pitchRadiansToRotationUnits(spec.launchAngleRadians)
                : 0;
        this.animation = new AnimationState(spec.travelSeqId);
    }

    get level(): number {
        return this.impact.caster.level;
    }

    update(
        dtSeconds: number,
        timeSeconds: number,
        combatants: readonly Combatant[],
        events: CombatEvent[],
        random: RandomSource,
        terrain: Terrain,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): ProjectileOutcome {
        this.animation.advance(dtSeconds, seqTypeLoader, seqFrameLoader, this.spec.travelPlayback);

        if (this.target.kind === "COMBATANT" && this.target.combatant.health <= 0) {
            this.target = { kind: "POINT", x: this.target.combatant.x, y: this.target.combatant.y };
        }
        const aim = targetPoint(this.target);
        const step = stepFlight(this.flight, aim, this.endHeightAt(aim, terrain), dtSeconds);

        if (this.spec.landing.kind === "FREE_FLIGHT") {
            const hit = findSweepHit(
                this.x,
                this.y,
                step.state.x,
                step.state.y,
                this.spec.landing.hitRadius,
                this.level,
                this.affectedCandidates(combatants),
                this.piercedCombatants,
            );
            if (hit) {
                this.land(hit.combatant, timeSeconds, random, events);
                if (!this.spec.landing.piercing) {
                    this.x += (step.state.x - this.x) * hit.fraction;
                    this.y += (step.state.y - this.y) * hit.fraction;
                    return { kind: "HIT_COMBATANT", combatant: hit.combatant };
                }
                this.piercedCombatants.add(hit.combatant);
            }
        }

        this.applyStep(step);
        if (!step.arrived) {
            return { kind: "ALIVE" };
        }
        return this.resolveArrival(combatants, timeSeconds, random, events);
    }

    private affectedCandidates(combatants: readonly Combatant[]): Combatant[] {
        return combatants.filter((combatant) =>
            matchesAffects(this.impact.caster, this.impact.affects, combatant),
        );
    }

    private land(
        target: Combatant,
        timeSeconds: number,
        random: RandomSource,
        events: CombatEvent[],
    ): void {
        applyPayloads(target, this.impact.payloads, timeSeconds, random, events);
    }

    private endHeightAt(aim: FlightPoint, terrain: Terrain): number {
        if (this.spec.landing.kind === "FREE_FLIGHT") {
            return this.launchHeight;
        }
        return terrain.getHeight(this.level, aim.x, aim.y) + this.spec.landing.endHeight;
    }

    private applyStep(step: FlightStep): void {
        this.flight = step.state;
        this.x = step.state.x;
        this.y = step.state.y;
        this.height = step.state.height;
        this.rotation = step.rotation;
        this.pitch =
            this.spec.modelOrientation === ProjectileModelOrientation.PITCHED ? step.pitch : 0;
    }

    private resolveArrival(
        combatants: readonly Combatant[],
        timeSeconds: number,
        random: RandomSource,
        events: CombatEvent[],
    ): ProjectileOutcome {
        switch (this.spec.landing.kind) {
            case "TRACKED_COMBATANT": {
                if (
                    this.target.kind !== "COMBATANT" ||
                    !matchesAffects(this.impact.caster, this.impact.affects, this.target.combatant)
                ) {
                    return { kind: "EXPIRED" };
                }
                this.land(this.target.combatant, timeSeconds, random, events);
                return { kind: "HIT_COMBATANT", combatant: this.target.combatant };
            }
            case "FIXED_POINT": {
                const hits = combatantsInCircle(
                    { x: this.x, y: this.y, level: this.level },
                    this.spec.landing.hitRadius,
                    this.affectedCandidates(combatants),
                );
                for (const hit of hits) {
                    this.land(hit, timeSeconds, random, events);
                }
                return { kind: "LANDED", x: this.x, y: this.y };
            }
            case "FREE_FLIGHT":
                return { kind: "EXPIRED" };
        }
    }
}
