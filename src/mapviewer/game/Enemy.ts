import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityDefinition, AbilityEffectKind } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { AnimationPlayback, AnimationState } from "./Animation";
import { Combatant, Faction } from "./Combatant";
import {
    EnemyBehaviour,
    EnemyStatsOverride,
    EnemyType,
    isBandedEnemyType,
    isBossEnemyType,
    resolveEnemyStats,
} from "./EnemyType";
import { TILE_SIZE } from "./GroundStrike";
import { Terrain } from "./Terrain";
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
    readonly attackReachMin: number;
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
    if (
        inputs.distanceToPlayer >= inputs.attackReachMin &&
        inputs.distanceToPlayer <= inputs.attackReach &&
        inputs.attackReady
    ) {
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
        case AbilityEffectKind.GROUND_STRIKE:
            return definition.effect.range;
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

// A kiter/caster's movement: retreat when the player has closed inside minRange, approach when
// beyond maxRange, hold ground inside the band (where it attacks instead of moving).
export function computeKeepDistanceMovement(
    deltaX: number,
    deltaY: number,
    distance: number,
    minRange: number,
    maxRange: number,
): { x: number; y: number } {
    if (distance === 0) {
        return { x: 0, y: 0 };
    }
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    if (distance < minRange) {
        return { x: -directionX, y: -directionY };
    }
    if (distance > maxRange) {
        return { x: directionX, y: directionY };
    }
    return { x: 0, y: 0 };
}

export type PatternAbilitySelection = {
    readonly ability: AbilityDefinition;
    readonly nextIndex: number;
};

// A BOSS enemy cycles its pattern in order instead of picking the first ready ability: starting at
// startIndex, tries each pattern entry in turn (wrapping around at most once), returning the first
// one isUsable accepts and the index the pattern should resume from next time. An entry whose own
// cooldown isn't up yet or whose range condition fails is skipped without being consumed, so it's
// tried again on its next turn through the cycle.
export function selectPatternAbility(
    pattern: readonly AbilityDefinition[],
    startIndex: number,
    isUsable: (ability: AbilityDefinition, index: number) => boolean,
): PatternAbilitySelection | undefined {
    for (let offset = 0; offset < pattern.length; offset++) {
        const index = (startIndex + offset) % pattern.length;
        if (isUsable(pattern[index], index)) {
            return { ability: pattern[index], nextIndex: (index + 1) % pattern.length };
        }
    }
    return undefined;
}

type AttackWindow = { readonly min: number; readonly max: number };

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
    despawnAt?: number;
    readonly animation: AnimationState;
    readonly abilityRuntime = new AbilityRuntime();

    // Which entry of a BOSS type's pattern is tried first next turn (see selectPatternAbility).
    patternIndex = 0;

    // Set by the animation viewer (see AnimPreview.ts) to pin this enemy to a single sequence,
    // looped or played once, instead of running the normal AI/state machine.
    previewSeqId?: number;
    previewPlayback: AnimationPlayback = AnimationPlayback.LOOP;

    constructor(
        readonly id: number,
        public x: number,
        public y: number,
        readonly level: number,
        readonly spawnX: number,
        readonly spawnY: number,
        readonly type: EnemyType,
        readonly abilities: readonly AbilityDefinition[] = type.abilities,
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

    // The cast/recovery sequence to show at `time`: the actively-playing cast's own castSeqId (see
    // AbilityRuntime.activeCastAnimation, which outlives the cast's pendingCast/effect resolution
    // through its recovery), falling back to the type's cast/basic-attack sequence once nothing is
    // playing.
    castSeqIdAt(time: number): number {
        return (
            this.abilityRuntime.activeCastAnimation(time)?.definition.castSeqId ??
            this.type.castSeqId ??
            this.type.attackSeqId
        );
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
        if (this.previewSeqId !== undefined) {
            this.animation.setSequence(this.previewSeqId);
            this.animation.advance(
                deltaTimeSeconds,
                seqTypeLoader,
                seqFrameLoader,
                this.previewPlayback,
            );
            return;
        }

        const frozen = this.state !== EnemyState.DEAD && this.isFrozen(timeSeconds);
        const distanceToPlayer = frozen ? Infinity : this.distanceTo(player);
        const hasPlayer = !frozen && player !== undefined && player.level === this.level;

        let readyAbility: AbilityDefinition | undefined;
        let attackWindow: AttackWindow | undefined;
        let patternSelection: PatternAbilitySelection | undefined;
        const bossType = isBossEnemyType(this.type) ? this.type : undefined;
        if (!frozen && player) {
            if (bossType) {
                patternSelection = this.selectBossPatternAbility(
                    bossType,
                    distanceToPlayer,
                    player,
                    timeSeconds,
                );
                readyAbility = patternSelection?.ability;
            } else {
                readyAbility = this.selectReadyAbility(timeSeconds);
            }
            if (readyAbility) {
                attackWindow = this.attackWindowFor(readyAbility, player);
            }
        }
        const windupComplete =
            this.state === EnemyState.WINDUP && !this.abilityRuntime.isBusy(timeSeconds);

        const nextState = decideEnemyState(this.state, {
            health: this.health,
            distanceToPlayer,
            hasPlayer,
            attackReach: attackWindow?.max ?? 0,
            attackReachMin: attackWindow?.min ?? 0,
            frozen,
            attackReady: readyAbility !== undefined,
            windupComplete,
        });

        if (this.state === EnemyState.WINDUP && nextState === EnemyState.CHASE) {
            this.abilityRuntime.reset();
        }
        if (
            nextState === EnemyState.WINDUP &&
            this.state !== EnemyState.WINDUP &&
            player &&
            readyAbility
        ) {
            this.abilityRuntime.use(readyAbility, { x: player.x, y: player.y }, timeSeconds);
            if (patternSelection) {
                this.patternIndex = patternSelection.nextIndex;
            }
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

        if (frozen) {
            this.animation.setSequence(this.idleSeqId);
            this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        // WINDUP and RECOVERY are one continuous animation while it's still playing (see
        // AbilityRuntime.activeCastAnimation): WINDUP is the portion up to impact, RECOVERY is the
        // remainder up to castAnimationSeconds. RECOVERY commonly outlasts the animation itself
        // (the ATTACK lock's own recovery time on top of it), so once activeCastAnimation expires
        // the enemy shows idle for the rest of RECOVERY rather than holding the cast's last frame.
        // setSequence no-ops once the sequence is already playing, so this doesn't restart it on
        // every tick.
        if (this.state === EnemyState.WINDUP || this.state === EnemyState.RECOVERY) {
            if (this.state === EnemyState.WINDUP && player) {
                const deltaX = player.x - this.x;
                const deltaY = player.y - this.y;
                if (deltaX !== 0 || deltaY !== 0) {
                    this.rotation = directionToRotation(deltaX, deltaY);
                }
            }
            const activeCast = this.abilityRuntime.activeCastAnimation(timeSeconds);
            if (!activeCast) {
                this.animation.setSequence(this.idleSeqId);
                this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
                return;
            }
            this.animation.setSequence(this.castSeqIdAt(timeSeconds));
            this.animation.advance(
                deltaTimeSeconds,
                seqTypeLoader,
                seqFrameLoader,
                AnimationPlayback.ONCE,
                activeCast.definition.castSpeed,
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
        this.rotation = directionToRotation(deltaX, deltaY);

        const movement = isBandedEnemyType(this.type)
            ? this.computeBandedMovement(deltaX, deltaY, distanceToPlayer, player, neighbours)
            : bossType
            ? this.computeBossMovement(bossType, deltaX, deltaY, distanceToPlayer, neighbours)
            : this.computeRushMovement(deltaX, deltaY, distanceToPlayer, player, neighbours);

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
        this.patternIndex = 0;
        this.abilityRuntime.reset();
        this.animation.restart(this.idleSeqId);
    }

    // The first ability (in priority order) whose own cooldown/resource gate is currently open,
    // independent of distance to the player. Distance is applied separately via attackWindowFor,
    // so a ready-but-out-of-range ability still blocks lower-priority ones from being picked.
    private selectReadyAbility(timeSeconds: number): AbilityDefinition | undefined {
        return this.abilities.find((ability) =>
            this.abilityRuntime.canUse(ability, 0, timeSeconds),
        );
    }

    // A BOSS's ability selection: unlike selectReadyAbility, both the cooldown gate and the range
    // condition are checked here (see selectPatternAbility), since the pattern must skip an entry
    // that's out of range (e.g. melee while the player is at range) rather than wait on it.
    private selectBossPatternAbility(
        type: Extract<EnemyType, { behaviour: EnemyBehaviour.BOSS }>,
        distanceToPlayer: number,
        player: Combatant,
        timeSeconds: number,
    ): PatternAbilitySelection | undefined {
        return selectPatternAbility(type.pattern, this.patternIndex, (ability) => {
            if (!this.abilityRuntime.canUse(ability, 0, timeSeconds)) {
                return false;
            }
            return distanceToPlayer <= enemyAttackRange(ability, this.hitRadius, player.hitRadius);
        });
    }

    private attackWindowFor(ability: AbilityDefinition, player: Combatant): AttackWindow {
        if (ability.effect.kind === AbilityEffectKind.HEAL_ALLIES) {
            return { min: 0, max: Infinity };
        }
        const max = enemyAttackRange(ability, this.hitRadius, player.hitRadius);
        const min = isBandedEnemyType(this.type) ? this.type.engagement.minRange : 0;
        return { min, max };
    }

    private computeBossMovement(
        type: Extract<EnemyType, { behaviour: EnemyBehaviour.BOSS }>,
        deltaX: number,
        deltaY: number,
        distanceToPlayer: number,
        neighbours: readonly SteeringBody[],
    ): { x: number; y: number } {
        const leashRange = type.engagement.leashRangeTiles * TILE_SIZE;
        const direction = computeKeepDistanceMovement(
            deltaX,
            deltaY,
            distanceToPlayer,
            0,
            leashRange,
        );
        return steerChase(direction.x, direction.y, false, this, neighbours);
    }

    private computeBandedMovement(
        deltaX: number,
        deltaY: number,
        distanceToPlayer: number,
        player: Combatant,
        neighbours: readonly SteeringBody[],
    ): { x: number; y: number } {
        if (!isBandedEnemyType(this.type)) {
            return { x: 0, y: 0 };
        }
        const maxRange = enemyAttackRange(this.abilities[0], this.hitRadius, player.hitRadius);
        const kiteDirection = computeKeepDistanceMovement(
            deltaX,
            deltaY,
            distanceToPlayer,
            this.type.engagement.minRange,
            maxRange,
        );
        return steerChase(kiteDirection.x, kiteDirection.y, false, this, neighbours);
    }

    private computeRushMovement(
        deltaX: number,
        deltaY: number,
        distanceToPlayer: number,
        player: Combatant,
        neighbours: readonly SteeringBody[],
    ): { x: number; y: number } {
        const stopDistance = Enemy.STOP_DISTANCE_MARGIN + this.hitRadius + player.hitRadius;
        const chaseDirection =
            distanceToPlayer > 0
                ? { x: deltaX / distanceToPlayer, y: deltaY / distanceToPlayer }
                : { x: 0, y: 0 };
        const touchingPlayer = distanceToPlayer <= stopDistance;
        return steerChase(chaseDirection.x, chaseDirection.y, touchingPlayer, this, neighbours);
    }

    private distanceTo(player: Combatant | undefined): number {
        if (!player || player.level !== this.level) {
            return Infinity;
        }
        return Math.hypot(player.x - this.x, player.y - this.y);
    }
}
