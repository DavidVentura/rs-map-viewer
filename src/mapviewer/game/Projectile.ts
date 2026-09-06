import { Combatant, Faction } from "./Combatant";
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
}

export type ProjectileSpec = {
    kind: ProjectileKind;
    speed: number;
    range: number;
    hitRadius: number;
    damage: number;
    arc: ProjectileArcProfile;
    homing: boolean;
};

export const ARROW_SPEC: ProjectileSpec = {
    kind: ProjectileKind.ARROW,
    speed: 2048,
    range: 4096,
    hitRadius: 16,
    damage: 8,
    arc: { baseHeight: 256, heightPerDistance: 0.15, maxHeight: 768 },
    homing: false,
};

export const MAGIC_SPEC: ProjectileSpec = {
    kind: ProjectileKind.MAGIC,
    speed: 3072,
    range: 4096,
    hitRadius: 16,
    damage: 12,
    arc: { baseHeight: 0, heightPerDistance: 0, maxHeight: 0 },
    homing: false,
};

export class Projectile {
    static readonly START_HEIGHT = 128;

    x: number;
    y: number;
    height: number = Projectile.START_HEIGHT;
    rotation: number;

    private directionX: number;
    private directionY: number;
    private distanceTraveled = 0;

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
    }

    update(dtSeconds: number, combatants: readonly Combatant[]): boolean {
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
        );
        const fraction = hit ? hit.fraction : 1;
        this.x += (nextX - this.x) * fraction;
        this.y += (nextY - this.y) * fraction;
        this.distanceTraveled += stepDistance * fraction;
        this.height =
            Projectile.START_HEIGHT +
            computeArcOffset(this.distanceTraveled, this.referenceDistance, this.spec.arc);
        if (hit) {
            hit.combatant.health -= this.spec.damage;
            return false;
        }
        return this.distanceTraveled < this.spec.range;
    }
}
