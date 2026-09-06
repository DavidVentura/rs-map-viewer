import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";
import { Combatant, Faction } from "./Combatant";
import { Terrain } from "./Terrain";
import { resolveMovement } from "./movement";
import { directionToRotation } from "./projectileMath";

export enum EnemyState {
    IDLE = 0,
    CHASE = 1,
    DEAD = 2,
}

export function decideEnemyState(
    current: EnemyState,
    health: number,
    distanceToPlayer: number,
    aggroRadius: number,
): EnemyState {
    if (health <= 0) {
        return EnemyState.DEAD;
    }
    if (current === EnemyState.DEAD) {
        return EnemyState.DEAD;
    }
    if (current === EnemyState.IDLE && distanceToPlayer <= aggroRadius) {
        return EnemyState.CHASE;
    }
    return current;
}

export function computeChaseMovement(
    deltaX: number,
    deltaY: number,
    distanceToPlayer: number,
    stopDistance: number,
): { x: number; y: number } {
    if (distanceToPlayer === 0 || distanceToPlayer <= stopDistance) {
        return { x: 0, y: 0 };
    }
    return { x: deltaX / distanceToPlayer, y: deltaY / distanceToPlayer };
}

export function computeFacingRotation(deltaX: number, deltaY: number): number {
    return (directionToRotation(deltaX, deltaY) + 1024) & 2047;
}

export class Enemy implements Combatant {
    static readonly SIZE_TILES = 1;
    static readonly HIT_RADIUS = 64;
    static readonly MAX_HEALTH = 20;
    static readonly WALK_SPEED = 288 * 1.6;
    static readonly AGGRO_RADIUS = 5 * 128;
    static readonly STOP_DISTANCE_MARGIN = 32;

    readonly faction = Faction.ENEMY;
    readonly hitRadius = Enemy.HIT_RADIUS;
    readonly maxHealth = Enemy.MAX_HEALTH;
    readonly sizeTiles = Enemy.SIZE_TILES;
    health = Enemy.MAX_HEALTH;

    state: EnemyState = EnemyState.IDLE;
    rotation = 0;
    readonly animation: AnimationState;

    constructor(
        readonly id: number,
        public x: number,
        public y: number,
        readonly level: number,
        readonly spawnX: number,
        readonly spawnY: number,
        readonly idleSeqId: number,
        readonly walkSeqId: number,
        readonly deathSeqId: number,
    ) {
        this.animation = new AnimationState(idleSeqId);
    }

    update(
        player: Combatant | undefined,
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        terrain: Terrain,
    ): void {
        const distanceToPlayer = this.distanceTo(player);
        this.state = decideEnemyState(
            this.state,
            this.health,
            distanceToPlayer,
            Enemy.AGGRO_RADIUS,
        );

        if (this.state === EnemyState.DEAD) {
            this.animation.setSequence(this.deathSeqId);
            this.animation.advance(
                deltaTimeSeconds,
                seqTypeLoader,
                seqFrameLoader,
                AnimationPlayback.ONCE,
            );
            return;
        }

        if (this.state !== EnemyState.CHASE || !player) {
            this.animation.setSequence(this.idleSeqId);
            this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        const deltaX = player.x - this.x;
        const deltaY = player.y - this.y;
        const stopDistance = Enemy.STOP_DISTANCE_MARGIN + this.hitRadius + player.hitRadius;
        const movement = computeChaseMovement(deltaX, deltaY, distanceToPlayer, stopDistance);
        this.rotation = computeFacingRotation(deltaX, deltaY);

        if (movement.x === 0 && movement.y === 0) {
            this.animation.setSequence(this.idleSeqId);
            this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        const position = resolveMovement(
            terrain,
            this.level,
            this.x,
            this.y,
            movement.x * Enemy.WALK_SPEED * deltaTimeSeconds,
            movement.y * Enemy.WALK_SPEED * deltaTimeSeconds,
        );
        this.x = position.x;
        this.y = position.y;
        this.animation.setSequence(this.walkSeqId);
        this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
    }

    private distanceTo(player: Combatant | undefined): number {
        if (!player || player.level !== this.level) {
            return Infinity;
        }
        return Math.hypot(player.x - this.x, player.y - this.y);
    }
}
