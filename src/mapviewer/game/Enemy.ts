import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityDefinition, AbilityEffectKind } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { AnimationPlayback, AnimationState } from "./Animation";
import { Combatant, Faction } from "./Combatant";
import { EnemyStatsOverride, EnemyType, resolveEnemyStats } from "./EnemyType";
import { Terrain } from "./Terrain";
import { ENEMY_MELEE } from "./abilities";
import { resolveMovement } from "./movement";
import { directionToRotation } from "./projectileMath";
import { SteeringBody, steerChase } from "./steering";

export enum EnemyState {
    IDLE = 0,
    CHASE = 1,
    DEAD = 2,
    WINDUP = 3,
    RECOVERY = 4,
}

export type EnemyDecisionInputs = {
    readonly health: number;
    readonly distanceToPlayer: number;
    readonly hasPlayer: boolean;
    readonly attackReach: number;
    readonly frozen: boolean;
    readonly attackReady: boolean;
    readonly windupComplete: boolean;
};

export function decideEnemyState(current: EnemyState, inputs: EnemyDecisionInputs): EnemyState {
    if (inputs.health <= 0) {
        return EnemyState.DEAD;
    }
    if (current === EnemyState.DEAD) {
        return EnemyState.DEAD;
    }
    if (current === EnemyState.WINDUP) {
        if (inputs.frozen) {
            return EnemyState.CHASE;
        }
        return inputs.windupComplete ? EnemyState.RECOVERY : EnemyState.WINDUP;
    }
    if (current === EnemyState.RECOVERY) {
        return inputs.attackReady ? EnemyState.CHASE : EnemyState.RECOVERY;
    }
    if (inputs.frozen) {
        return current;
    }
    if (current === EnemyState.IDLE) {
        return inputs.hasPlayer ? EnemyState.CHASE : EnemyState.IDLE;
    }
    if (inputs.distanceToPlayer <= inputs.attackReach && inputs.attackReady) {
        return EnemyState.WINDUP;
    }
    return EnemyState.CHASE;
}

export function enemyAttackRange(
    definition: AbilityDefinition,
    casterHitRadius: number,
    targetHitRadius: number,
): number {
    switch (definition.effect.kind) {
        case AbilityEffectKind.MELEE:
            return definition.effect.reach + casterHitRadius + targetHitRadius;
        case AbilityEffectKind.PROJECTILE:
            return definition.effect.spec.range;
        default:
            throw new Error(`Unsupported enemy attack effect: ${definition.effect.kind}`);
    }
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

export class Enemy implements Combatant, SteeringBody {
    static readonly STOP_DISTANCE_MARGIN = 32;

    readonly faction = Faction.ENEMY;
    readonly hitRadius: number;
    readonly maxHealth: number;
    health: number;
    walkSpeed: number;

    state: EnemyState = EnemyState.IDLE;
    rotation = 0;
    frozenUntil?: number;
    respawnAt?: number;
    readonly animation: AnimationState;
    readonly abilityRuntime = new AbilityRuntime();

    constructor(
        readonly id: number,
        public x: number,
        public y: number,
        readonly level: number,
        readonly spawnX: number,
        readonly spawnY: number,
        readonly type: EnemyType,
        readonly attackDefinition: AbilityDefinition = ENEMY_MELEE,
        statsOverride?: EnemyStatsOverride,
    ) {
        const stats = resolveEnemyStats(type, statsOverride);
        this.hitRadius = type.hitRadius;
        this.maxHealth = stats.maxHealth;
        this.health = stats.maxHealth;
        this.walkSpeed = stats.walkSpeed;
        this.animation = new AnimationState(type.idleSeqId);
    }

    get idleSeqId(): number {
        return this.type.idleSeqId;
    }

    get walkSeqId(): number {
        return this.type.walkSeqId;
    }

    get deathSeqId(): number {
        return this.type.deathSeqId;
    }

    get attackSeqId(): number {
        return this.type.attackSeqId;
    }

    isFrozen(timeSeconds: number): boolean {
        return this.frozenUntil !== undefined && timeSeconds < this.frozenUntil;
    }

    update(
        player: Combatant | undefined,
        neighbours: readonly SteeringBody[],
        deltaTimeSeconds: number,
        timeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        terrain: Terrain,
    ): void {
        const frozen = this.state !== EnemyState.DEAD && this.isFrozen(timeSeconds);
        const distanceToPlayer = frozen ? Infinity : this.distanceTo(player);
        const hasPlayer = !frozen && player !== undefined && player.level === this.level;
        const attackReach = this.attackReachFor(player);
        const attackReady = this.abilityRuntime.canUse(this.attackDefinition, 0, timeSeconds);
        const windupComplete =
            this.state === EnemyState.WINDUP && !this.abilityRuntime.isBusy(timeSeconds);

        const nextState = decideEnemyState(this.state, {
            health: this.health,
            distanceToPlayer,
            hasPlayer,
            attackReach,
            frozen,
            attackReady,
            windupComplete,
        });

        if (this.state === EnemyState.WINDUP && nextState === EnemyState.CHASE) {
            this.abilityRuntime.reset();
        }
        if (nextState === EnemyState.WINDUP && this.state !== EnemyState.WINDUP && player) {
            this.abilityRuntime.use(
                this.attackDefinition,
                { x: player.x, y: player.y },
                timeSeconds,
            );
        }
        this.state = nextState;

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

        if (frozen || this.state === EnemyState.RECOVERY) {
            this.animation.setSequence(this.idleSeqId);
            this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        if (this.state === EnemyState.WINDUP) {
            if (player) {
                const deltaX = player.x - this.x;
                const deltaY = player.y - this.y;
                if (deltaX !== 0 || deltaY !== 0) {
                    this.rotation = directionToRotation(deltaX, deltaY);
                }
            }
            this.animation.setSequence(this.attackSeqId);
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
        const chaseDirection =
            distanceToPlayer > 0
                ? { x: deltaX / distanceToPlayer, y: deltaY / distanceToPlayer }
                : { x: 0, y: 0 };
        const touchingPlayer = distanceToPlayer <= stopDistance;
        this.rotation = directionToRotation(deltaX, deltaY);

        const movement = steerChase(
            chaseDirection.x,
            chaseDirection.y,
            touchingPlayer,
            this,
            neighbours,
        );

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
            movement.x * this.walkSpeed * deltaTimeSeconds,
            movement.y * this.walkSpeed * deltaTimeSeconds,
        );
        this.x = position.x;
        this.y = position.y;
        this.animation.setSequence(this.walkSeqId);
        this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
    }

    respawn(): void {
        this.x = this.spawnX;
        this.y = this.spawnY;
        this.health = this.maxHealth;
        this.state = EnemyState.IDLE;
        this.frozenUntil = undefined;
        this.respawnAt = undefined;
        this.abilityRuntime.reset();
        this.animation.restart(this.idleSeqId);
    }

    private attackReachFor(player: Combatant | undefined): number {
        if (!player) {
            return 0;
        }
        return enemyAttackRange(this.attackDefinition, this.hitRadius, player.hitRadius);
    }

    private distanceTo(player: Combatant | undefined): number {
        if (!player || player.level !== this.level) {
            return Infinity;
        }
        return Math.hypot(player.x - this.x, player.y - this.y);
    }
}
