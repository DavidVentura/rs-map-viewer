import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";
import { CombatEvent, applyDamage } from "./CombatEvent";
import { Combatant, Faction } from "./Combatant";
import { VisualEffectKind } from "./VisualEffect";
import {
    ProjectileArcProfile,
    computeArcOffset,
    directionToRotation,
    findSweepHit,
    reaimTowardTarget,
} from "./projectileMath";

export enum ProjectileKind {
    ARROW,
    MAGIC,
    POWER_SHOT,
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

export type ProjectileSpec = {
    kind: ProjectileKind;
    speed: number;
    range: number;
    hitRadius: number;
    damage: number;
    arc: ProjectileArcProfile;
    homing: boolean;
    piercing: boolean;
    travelSeqId: number;
    hitEffect?: ProjectileHitEffect;
};

export const ARROW_SPEC: ProjectileSpec = {
    kind: ProjectileKind.ARROW,
    speed: 2048,
    range: 4096,
    hitRadius: 16,
    damage: 8,
    arc: { baseHeight: 256, heightPerDistance: 0.15, maxHeight: 768 },
    homing: false,
    piercing: false,
    travelSeqId: -1,
};

export const MAGIC_SPEC: ProjectileSpec = {
    kind: ProjectileKind.MAGIC,
    speed: 3072,
    range: 4096,
    hitRadius: 16,
    damage: 12,
    arc: { baseHeight: 0, heightPerDistance: 0, maxHeight: 0 },
    homing: false,
    piercing: false,
    travelSeqId: FIRE_BOLT_TRAVEL_SEQ_ID,
    hitEffect: { kind: VisualEffectKind.MAGIC_HIT, seqId: FIRE_BOLT_HIT_SEQ_ID, height: 124 },
};

export const POWER_SHOT_SPEC: ProjectileSpec = {
    kind: ProjectileKind.POWER_SHOT,
    speed: 1792,
    range: 4096,
    hitRadius: 24,
    damage: 20,
    arc: { baseHeight: 256, heightPerDistance: 0.15, maxHeight: 768 },
    homing: false,
    piercing: true,
    travelSeqId: -1,
};

export class Projectile {
    static readonly START_HEIGHT = 128;

    x: number;
    y: number;
    height: number = Projectile.START_HEIGHT;
    rotation: number;
    hitTarget?: Combatant;
    readonly animation: AnimationState;

    private directionX: number;
    private directionY: number;
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
        private readonly referenceDistance: number,
        private readonly homingTarget?: Combatant,
    ) {
        this.x = startX;
        this.y = startY;
        const length = Math.hypot(directionX, directionY);
        this.directionX = directionX / length;
        this.directionY = directionY / length;
        this.rotation = directionToRotation(this.directionX, this.directionY);
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

        if (this.spec.homing && this.homingTarget && this.homingTarget.health > 0) {
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
            this.spec.piercing ? this.piercedCombatants : undefined,
        );
        const fraction = hit ? hit.fraction : 1;
        this.x += (nextX - this.x) * fraction;
        this.y += (nextY - this.y) * fraction;
        this.distanceTraveled += stepDistance * fraction;
        this.height =
            Projectile.START_HEIGHT +
            computeArcOffset(this.distanceTraveled, this.referenceDistance, this.spec.arc);
        if (hit) {
            this.hitTarget = hit.combatant;
            applyDamage(hit.combatant, this.spec.damage, events);
            if (this.spec.piercing) {
                this.piercedCombatants.add(hit.combatant);
            } else {
                return ProjectileOutcome.HIT;
            }
        }
        return this.distanceTraveled < this.spec.range
            ? ProjectileOutcome.ALIVE
            : ProjectileOutcome.EXPIRED;
    }
}
