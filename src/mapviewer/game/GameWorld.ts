import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import {
    AbilityEffect,
    AbilityEffectKind,
    AbilityTarget,
    AreaEffect,
    ConeMeleeEffect,
    MeleeEffect,
    MultiProjectileEffect,
    WeaponStyle,
} from "./Ability";
import { CombatEvent, applyDamage, applyFreeze, applyHeal } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { Enemy, computeChaseMovement } from "./Enemy";
import { Player, PlayerInput, StanceSeqIdsByStance } from "./Player";
import { Projectile, ProjectileHitEffect, ProjectileOutcome, ProjectileSpec } from "./Projectile";
import { Terrain } from "./Terrain";
import { VisualEffect } from "./VisualEffect";
import { getStyleAttack } from "./abilities";
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
        idleSeqId: number,
        walkSeqId: number,
        deathSeqId: number,
    ): void {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        this.enemies.push(
            new Enemy(
                this.nextEnemyId++,
                spawn.x,
                spawn.y,
                level,
                spawn.x,
                spawn.y,
                idleSeqId,
                walkSeqId,
                deathSeqId,
            ),
        );
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
            if (input.styleSwitch !== undefined) {
                this.player.requestStyleSwitch(input.styleSwitch, this.timeSeconds);
            }
            this.processAbilityInput(this.player, input.abilities, this.timeSeconds);
            const movement = this.resolveMovementInput(this.player, input);
            this.player.update(
                movement,
                dtSeconds,
                this.timeSeconds,
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.terrain,
            );
            this.resolveReadyCast(this.player);
        }

        for (const enemy of this.enemies) {
            enemy.update(
                this.player,
                dtSeconds,
                this.timeSeconds,
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.terrain,
            );
        }

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

        this.visualEffects = this.visualEffects.filter((effect) =>
            effect.update(dtSeconds, this.seqTypeLoader, this.seqFrameLoader, this.timeSeconds),
        );
    }

    drainEvents(): CombatEvent[] {
        const events = this.events;
        this.events = [];
        return events;
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

    private spawnProjectile(caster: Player, spec: ProjectileSpec, target: AbilityTarget): void {
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
