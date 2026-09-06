import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityEffect, AbilityEffectKind, AbilityTarget, MeleeEffect } from "./Ability";
import { CombatEvent, applyDamage, applyHeal } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { Enemy } from "./Enemy";
import { Player, PlayerInput } from "./Player";
import { Projectile, ProjectileSpec } from "./Projectile";
import { Terrain } from "./Terrain";
import { RandomSource, rollDamage } from "./abilityRules";
import { resolveSpawn } from "./spawn";

export type AbilitySlotInput = {
    readonly held: boolean;
    readonly target?: AbilityTarget;
};

export type AbilityInput = readonly AbilitySlotInput[];

export type SimInput = {
    movement: PlayerInput;
    abilities: AbilityInput;
};

export class GameWorld {
    static readonly FIXED_STEP_SECONDS = 1 / 120;
    static readonly MAX_ACCUMULATED_SECONDS = 0.1;
    static readonly MAX_PROJECTILES = 32;

    timeSeconds = 0;
    player?: Player;
    enemies: Enemy[] = [];
    projectiles: Projectile[] = [];
    private events: CombatEvent[] = [];

    private accumulatedSeconds = 0;
    private nextEnemyId = 1;

    constructor(
        private readonly terrain: Terrain,
        private readonly seqTypeLoader: SeqTypeLoader,
        private readonly seqFrameLoader: SeqFrameLoader,
        private readonly random: RandomSource = Math.random,
    ) {}

    spawnPlayer(
        x: number,
        y: number,
        level: number,
        idleSeqId: number,
        walkSeqId: number,
        runSeqId: number,
        attackSeqId: number,
    ): void {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        this.player = new Player(
            spawn.x,
            spawn.y,
            level,
            idleSeqId,
            walkSeqId,
            runSeqId,
            attackSeqId,
        );
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
            this.processAbilityInput(this.player, input.abilities, this.timeSeconds);
            this.player.update(
                input.movement,
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
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.terrain,
            );
        }

        const combatants = this.combatants();
        this.projectiles = this.projectiles.filter((projectile) =>
            projectile.update(dtSeconds, combatants, this.events),
        );
    }

    drainEvents(): CombatEvent[] {
        const events = this.events;
        this.events = [];
        return events;
    }

    private processAbilityInput(player: Player, abilities: AbilityInput, time: number): void {
        const slotCount = Math.min(abilities.length, player.abilityBar.length);
        for (let slot = 0; slot < slotCount; slot++) {
            const slotInput = abilities[slot];
            if (!slotInput.held || !slotInput.target) {
                continue;
            }
            const definition = player.abilityBar[slot];
            if (!player.abilityRuntime.canUse(definition, player.mana, time)) {
                continue;
            }
            player.beginCast(definition, slotInput.target, time);
        }
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
            case AbilityEffectKind.STANCE:
                caster.stance = effect.stance;
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

    private resolveMelee(caster: Player, effect: MeleeEffect, target: AbilityTarget): void {
        const enemy = target.enemyId !== undefined ? this.findEnemy(target.enemyId) : undefined;
        if (!enemy || enemy.level !== caster.level || enemy.health <= 0) {
            return;
        }
        const distance = Math.hypot(enemy.x - caster.x, enemy.y - caster.y);
        if (distance > effect.reach + caster.hitRadius + enemy.hitRadius) {
            return;
        }
        applyDamage(
            enemy,
            rollDamage(effect.minDamage, effect.maxDamage, this.random),
            this.events,
        );
    }
}
