import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import {
    AbilityDefinition,
    AbilityEffect,
    AbilityEffectKind,
    AbilityTarget,
    AreaEffect,
    ConeMeleeEffect,
    MeleeEffect,
    MultiProjectileEffect,
    WeaponStyle,
} from "./Ability";
import { CombatEvent, CombatEventKind, applyDamage, applyFreeze, applyHeal } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { Enemy, EnemyState, computeChaseMovement } from "./Enemy";
import { EnemyType } from "./EnemyType";
import { Player, PlayerInput, StanceSeqIdsByStance } from "./Player";
import { Projectile, ProjectileHitEffect, ProjectileOutcome, ProjectileSpec } from "./Projectile";
import { SpatialGrid } from "./SpatialGrid";
import { Terrain } from "./Terrain";
import { VisualEffect } from "./VisualEffect";
import { ENEMY_MELEE, getStyleAttack } from "./abilities";
import { RandomSource, isWithinMeleeReach, rollDamage } from "./abilityRules";
import {
    directionToRotation,
    generateSpreadDirections,
    isPointInCone,
    isWithinTileArea,
    rotationToDirection,
} from "./projectileMath";
import { resolveSpawn } from "./spawn";

export type AbilitySlotInput = {
    readonly held: boolean;
    readonly target?: AbilityTarget;
};

export type AbilityInput = readonly AbilitySlotInput[];

export type SimInput = {
    movement: PlayerInput;
    abilities: AbilityInput;
    styleSwitch?: WeaponStyle;
};

export class GameWorld {
    static readonly FIXED_STEP_SECONDS = 1 / 120;
    static readonly MAX_ACCUMULATED_SECONDS = 0.1;
    static readonly MAX_PROJECTILES = 32;
    static readonly MAX_VISUAL_EFFECTS = 32;
    static readonly BASIC_ATTACK_SLOT = 0;
    static readonly ENEMY_RESPAWN_SECONDS = 5;
    static readonly ENEMY_GRID_CELL_SIZE = 256;
    static readonly ENEMY_NEIGHBOUR_QUERY_RADIUS = 256;

    timeSeconds = 0;
    player?: Player;
    enemies: Enemy[] = [];
    projectiles: Projectile[] = [];
    visualEffects: VisualEffect[] = [];
    private events: CombatEvent[] = [];

    private accumulatedSeconds = 0;
    private nextEnemyId = 1;

    constructor(
        private readonly terrain: Terrain,
        private readonly seqTypeLoader: SeqTypeLoader,
        private readonly seqFrameLoader: SeqFrameLoader,
        private readonly random: RandomSource = Math.random,
    ) {}

    spawnPlayer(x: number, y: number, level: number, styleSeqIds: StanceSeqIdsByStance): void {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        this.player = new Player(spawn.x, spawn.y, level, styleSeqIds);
    }

    spawnEnemy(
        x: number,
        y: number,
        level: number,
        enemyType: EnemyType,
        attackDefinition: AbilityDefinition = ENEMY_MELEE,
    ): number {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        const id = this.nextEnemyId++;
        this.enemies.push(
            new Enemy(id, spawn.x, spawn.y, level, spawn.x, spawn.y, enemyType, attackDefinition),
        );
        return id;
    }

    findEnemy(id: number): Enemy | undefined {
        return this.enemies.find((enemy) => enemy.id === id);
    }

    private resolveEnemyTarget(target: AbilityTarget, level: number): Enemy | undefined {
        const enemy = target.enemyId !== undefined ? this.findEnemy(target.enemyId) : undefined;
        return enemy && enemy.level === level && enemy.health > 0 ? enemy : undefined;
    }

    combatants(): Combatant[] {
        const combatants: Combatant[] = [...this.enemies];
        if (this.player) {
            combatants.push(this.player);
        }
        return combatants;
    }

    advance(deltaSeconds: number, input: SimInput): void {
        this.accumulatedSeconds += Math.min(deltaSeconds, GameWorld.MAX_ACCUMULATED_SECONDS);
        while (this.accumulatedSeconds >= GameWorld.FIXED_STEP_SECONDS) {
            this.step(input, GameWorld.FIXED_STEP_SECONDS);
            this.accumulatedSeconds -= GameWorld.FIXED_STEP_SECONDS;
        }
    }

    step(input: SimInput, dtSeconds: number): void {
        this.timeSeconds += dtSeconds;

        if (this.player) {
            this.updatePlayer(this.player, input, dtSeconds);
        }

        const enemyGrid = SpatialGrid.build(GameWorld.ENEMY_GRID_CELL_SIZE, this.enemies);
        for (const enemy of this.enemies) {
            const neighbours = enemyGrid
                .neighboursWithin(enemy.x, enemy.y, GameWorld.ENEMY_NEIGHBOUR_QUERY_RADIUS)
                .filter((neighbour) => neighbour !== enemy);
            this.updateEnemy(enemy, neighbours, dtSeconds);
        }

        this.updateProjectiles(dtSeconds);

        this.visualEffects = this.visualEffects.filter((effect) =>
            effect.update(dtSeconds, this.seqTypeLoader, this.seqFrameLoader, this.timeSeconds),
        );

        this.checkPlayerDeath();
    }

    drainEvents(): CombatEvent[] {
        const events = this.events;
        this.events = [];
        return events;
    }

    private updatePlayer(player: Player, input: SimInput, dtSeconds: number): void {
        if (player.isDead(this.timeSeconds)) {
            player.update(
                input.movement,
                dtSeconds,
                this.timeSeconds,
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.terrain,
            );
            return;
        }
        if (player.isAwaitingRespawn(this.timeSeconds)) {
            player.respawn();
            this.resetEncounter();
            return;
        }

        if (input.styleSwitch !== undefined) {
            player.requestStyleSwitch(input.styleSwitch, this.timeSeconds);
        }
        this.processAbilityInput(player, input.abilities, this.timeSeconds);
        const movement = this.resolveMovementInput(player, input);
        player.update(
            movement,
            dtSeconds,
            this.timeSeconds,
            this.seqTypeLoader,
            this.seqFrameLoader,
            this.terrain,
        );
        this.resolveReadyCast(player);
    }

    private updateEnemy(enemy: Enemy, neighbours: readonly Enemy[], dtSeconds: number): void {
        const wasAlive = enemy.state !== EnemyState.DEAD;
        enemy.update(
            this.player,
            neighbours,
            dtSeconds,
            this.timeSeconds,
            this.seqTypeLoader,
            this.seqFrameLoader,
            this.terrain,
        );

        if (wasAlive && enemy.state === EnemyState.DEAD) {
            enemy.respawnAt = this.timeSeconds + GameWorld.ENEMY_RESPAWN_SECONDS;
            this.events.push({ kind: CombatEventKind.ENEMY_DIED, target: enemy });
            return;
        }
        if (!wasAlive) {
            this.tryRespawnEnemy(enemy);
            return;
        }
        this.resolveEnemyAttack(enemy);
    }

    private tryRespawnEnemy(enemy: Enemy): void {
        if (enemy.respawnAt === undefined || this.timeSeconds < enemy.respawnAt) {
            return;
        }
        enemy.respawn();
        this.events.push({ kind: CombatEventKind.ENEMY_RESPAWNED, target: enemy });
    }

    private resolveEnemyAttack(enemy: Enemy): void {
        const cast = enemy.abilityRuntime.takeReadyCast(this.timeSeconds);
        if (!cast || !this.player || this.player.health <= 0) {
            return;
        }
        switch (cast.definition.effect.kind) {
            case AbilityEffectKind.MELEE:
                this.resolveEnemyMelee(enemy, this.player, cast.definition.effect);
                break;
            case AbilityEffectKind.PROJECTILE:
                this.spawnProjectile(enemy, cast.definition.effect.spec, {
                    x: this.player.x,
                    y: this.player.y,
                });
                break;
            default:
                throw new Error(`Unsupported enemy attack effect: ${cast.definition.effect.kind}`);
        }
    }

    private resolveEnemyMelee(enemy: Enemy, player: Player, effect: MeleeEffect): void {
        const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
        if (!isWithinMeleeReach(distance, effect.reach, enemy.hitRadius, player.hitRadius)) {
            return;
        }
        applyDamage(
            player,
            rollDamage(effect.minDamage, effect.maxDamage, this.random),
            this.events,
        );
    }

    private checkPlayerDeath(): void {
        const player = this.player;
        if (!player || player.health > 0 || player.hasDied()) {
            return;
        }
        player.die(this.timeSeconds);
        this.events.push({ kind: CombatEventKind.PLAYER_DIED, target: player });
    }

    private resetEncounter(): void {
        for (const enemy of this.enemies) {
            enemy.respawn();
            this.events.push({ kind: CombatEventKind.ENEMY_RESPAWNED, target: enemy });
        }
    }

    private updateProjectiles(dtSeconds: number): void {
        const combatants = this.combatants();
        const survivingProjectiles: Projectile[] = [];
        for (const projectile of this.projectiles) {
            const outcome = projectile.update(
                dtSeconds,
                combatants,
                this.events,
                this.seqTypeLoader,
                this.seqFrameLoader,
            );
            if (outcome === ProjectileOutcome.ALIVE) {
                survivingProjectiles.push(projectile);
            } else if (outcome === ProjectileOutcome.HIT) {
                this.spawnProjectileHitEffect(projectile);
            }
        }
        this.projectiles = survivingProjectiles;
    }

    private resolveMovementInput(player: Player, input: SimInput): PlayerInput {
        return this.computeMeleeChaseInput(player, input) ?? input.movement;
    }

    private computeMeleeChaseInput(player: Player, input: SimInput): PlayerInput | undefined {
        if (player.style !== WeaponStyle.MELEE) {
            return undefined;
        }
        const slotInput = input.abilities[GameWorld.BASIC_ATTACK_SLOT];
        if (!slotInput?.held || !slotInput.target) {
            return undefined;
        }
        const enemy = this.resolveEnemyTarget(slotInput.target, player.level);
        if (!enemy) {
            return undefined;
        }
        const attack = getStyleAttack(WeaponStyle.MELEE);
        if (attack.effect.kind !== AbilityEffectKind.MELEE) {
            return undefined;
        }
        const deltaX = enemy.x - player.x;
        const deltaY = enemy.y - player.y;
        const distance = Math.hypot(deltaX, deltaY);
        const reach = attack.effect.reach + player.hitRadius + enemy.hitRadius;
        if (distance <= reach) {
            return undefined;
        }
        const movement = computeChaseMovement(deltaX, deltaY, distance, reach);
        if (movement.x === 0 && movement.y === 0) {
            return undefined;
        }
        return { x: movement.x, y: movement.y, running: input.movement.running };
    }

    private processAbilityInput(player: Player, abilities: AbilityInput, time: number): void {
        const slotCount = Math.min(abilities.length, player.abilityBar.length);
        for (let slot = 0; slot < slotCount; slot++) {
            const slotInput = abilities[slot];
            if (!slotInput.held || !slotInput.target) {
                continue;
            }
            if (!this.canUseSlot(player, slot, slotInput.target, time)) {
                continue;
            }
            player.beginCast(player.abilityBar[slot], slotInput.target, time);
        }
    }

    private canUseSlot(player: Player, slot: number, target: AbilityTarget, time: number): boolean {
        if (!player.canUseSlotIgnoringTarget(slot, time)) {
            return false;
        }
        const definition = player.abilityBar[slot];
        if (definition.effect.kind !== AbilityEffectKind.MELEE) {
            return true;
        }
        const enemy = this.resolveEnemyTarget(target, player.level);
        if (!enemy) {
            return false;
        }
        const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        return isWithinMeleeReach(
            distance,
            definition.effect.reach,
            player.hitRadius,
            enemy.hitRadius,
        );
    }

    private resolveReadyCast(player: Player): void {
        const cast = player.abilityRuntime.takeReadyCast(this.timeSeconds);
        if (!cast) {
            return;
        }
        this.resolveEffect(player, cast.definition.effect, cast.target);
    }

    private resolveEffect(caster: Player, effect: AbilityEffect, target: AbilityTarget): void {
        switch (effect.kind) {
            case AbilityEffectKind.PROJECTILE:
                this.spawnProjectile(caster, effect.spec, target);
                break;
            case AbilityEffectKind.HEAL:
                applyHeal(caster, effect.amount, this.events);
                break;
            case AbilityEffectKind.MELEE:
                this.resolveMelee(caster, effect, target);
                break;
            case AbilityEffectKind.CONE_MELEE:
                this.resolveConeMelee(caster, effect);
                break;
            case AbilityEffectKind.AREA:
                this.resolveArea(caster, effect, target);
                break;
            case AbilityEffectKind.MULTI_PROJECTILE:
                this.resolveMultiProjectile(caster, effect, target);
                break;
        }
    }

    private spawnProjectile(caster: Combatant, spec: ProjectileSpec, target: AbilityTarget): void {
        const deltaX = target.x - caster.x;
        const deltaY = target.y - caster.y;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance === 0 || this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
            return;
        }
        const homingTarget =
            target.enemyId !== undefined ? this.findEnemy(target.enemyId) : undefined;
        this.projectiles.push(
            new Projectile(
                spec,
                caster.faction,
                caster.level,
                caster.x + (deltaX / distance) * 48,
                caster.y + (deltaY / distance) * 48,
                deltaX,
                deltaY,
                distance,
                homingTarget,
            ),
        );
    }

    private spawnProjectileHitEffect(projectile: Projectile): void {
        const hitEffect = projectile.spec.hitEffect;
        const target = projectile.hitTarget;
        if (!hitEffect || !target) {
            return;
        }
        this.spawnVisualEffect(hitEffect, target);
    }

    private spawnVisualEffect(
        hitEffect: ProjectileHitEffect,
        target: Combatant,
        holdSeconds?: number,
    ): void {
        if (this.visualEffects.length >= GameWorld.MAX_VISUAL_EFFECTS) {
            return;
        }
        this.visualEffects.push(
            new VisualEffect(
                hitEffect.kind,
                target.level,
                target.x,
                target.y,
                hitEffect.height,
                hitEffect.seqId,
                holdSeconds !== undefined ? this.timeSeconds + holdSeconds : undefined,
            ),
        );
    }

    private resolveMelee(caster: Player, effect: MeleeEffect, target: AbilityTarget): void {
        const enemy = this.resolveEnemyTarget(target, caster.level);
        if (!enemy) {
            return;
        }
        const distance = Math.hypot(enemy.x - caster.x, enemy.y - caster.y);
        if (!isWithinMeleeReach(distance, effect.reach, caster.hitRadius, enemy.hitRadius)) {
            return;
        }
        applyDamage(
            enemy,
            rollDamage(effect.minDamage, effect.maxDamage, this.random),
            this.events,
        );
    }

    private resolveConeMelee(caster: Player, effect: ConeMeleeEffect): void {
        const basicAttack = getStyleAttack(caster.style);
        if (basicAttack.effect.kind !== AbilityEffectKind.MELEE) {
            return;
        }
        const minDamage = basicAttack.effect.minDamage * effect.damageMultiplier;
        const maxDamage = basicAttack.effect.maxDamage * effect.damageMultiplier;
        for (const enemy of this.enemies) {
            if (enemy.level !== caster.level || enemy.health <= 0) {
                continue;
            }
            const reach = effect.reach + caster.hitRadius + enemy.hitRadius;
            if (
                !isPointInCone(
                    caster.x,
                    caster.y,
                    caster.rotation,
                    effect.angleRadians,
                    reach,
                    enemy.x,
                    enemy.y,
                )
            ) {
                continue;
            }
            applyDamage(enemy, rollDamage(minDamage, maxDamage, this.random), this.events);
        }
    }

    private resolveArea(caster: Player, effect: AreaEffect, target: AbilityTarget): void {
        const centerEnemy = this.resolveEnemyTarget(target, caster.level);
        const centerX = centerEnemy?.x ?? target.x;
        const centerY = centerEnemy?.y ?? target.y;
        for (const enemy of this.enemies) {
            if (enemy.level !== caster.level || enemy.health <= 0) {
                continue;
            }
            if (!isWithinTileArea(centerX, centerY, effect.radiusTiles, enemy.x, enemy.y)) {
                continue;
            }
            applyDamage(
                enemy,
                rollDamage(effect.damageMin, effect.damageMax, this.random),
                this.events,
            );
            if (enemy.health <= 0) {
                continue;
            }
            applyFreeze(enemy, this.timeSeconds + effect.freezeSeconds, this.events);
            this.spawnVisualEffect(effect.hitEffect, enemy, effect.freezeSeconds);
        }
    }

    private resolveMultiProjectile(
        caster: Player,
        effect: MultiProjectileEffect,
        target: AbilityTarget,
    ): void {
        const deltaX = target.x - caster.x;
        const deltaY = target.y - caster.y;
        if (deltaX === 0 && deltaY === 0) {
            return;
        }
        const distance = Math.hypot(deltaX, deltaY);
        const baseRotation = directionToRotation(deltaX, deltaY);
        const directions = generateSpreadDirections(
            baseRotation,
            effect.spreadAngleRadians,
            effect.count,
        );
        for (const rotation of directions) {
            if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
                break;
            }
            const direction = rotationToDirection(rotation);
            this.projectiles.push(
                new Projectile(
                    effect.spec,
                    caster.faction,
                    caster.level,
                    caster.x + direction.x * 48,
                    caster.y + direction.y * 48,
                    direction.x,
                    direction.y,
                    distance,
                ),
            );
        }
    }
}
