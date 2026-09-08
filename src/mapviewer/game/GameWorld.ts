import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import {
    AbilityDefinition,
    AbilityEffect,
    AbilityEffectKind,
    AbilityTarget,
    AreaEffect,
    ConeMeleeEffect,
    GroundStrikeEffect,
    HealAlliesEffect,
    MeleeEffect,
    MultiProjectileEffect,
    ProjectileEffect,
    WeaponStyle,
} from "./Ability";
import { CombatEvent, CombatEventKind, applyDamage, applyFreeze, applyHeal } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { Encounter, EncounterSpawnMode } from "./Encounter";
import { Enemy, EnemyState, computeChaseMovement } from "./Enemy";
import {
    BossPhaseAdds,
    EnemyStatsOverride,
    EnemyType,
    getEnemyType,
    resolveTriggeredBossPhase,
} from "./EnemyType";
import {
    GROUND_ITEM_LIFETIME_SECONDS,
    GroundItem,
    distanceToGroundItem,
    isGroundItemExpired,
    pendingGroundItemPaths,
    rollDropPath,
} from "./GroundItem";
import { PendingGroundStrike, TILE_SIZE, combatantsHitByGroundStrike } from "./GroundStrike";
import { Player, PlayerInput, StanceSeqIdsByStance } from "./Player";
import { Projectile, ProjectileHitEffect, ProjectileOutcome, ProjectileSpec } from "./Projectile";
import { SpatialGrid } from "./SpatialGrid";
import { Terrain } from "./Terrain";
import { VisualEffect } from "./VisualEffect";
import {
    WaveDirectorState,
    WaveSpawn,
    initialWaveDirectorState,
    pickFarthestSpawnPoint,
    stepWaveDirector,
    totalGroupCount,
} from "./WaveDirector";
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
import { UPGRADE_POOL, Upgrade, drawUpgradeOffer } from "./upgrades";

export type AbilitySlotInput = {
    readonly held: boolean;
    readonly target?: AbilityTarget;
};

export type AbilityInput = readonly AbilitySlotInput[];

export type PickupTarget = {
    readonly groundItemId: number;
};

export type SimInput = {
    movement: PlayerInput;
    abilities: AbilityInput;
    styleSwitch?: WeaponStyle;
    // Index into the pending upgrade offer; only consulted while one is pending.
    chooseUpgrade?: number;
    // Set while the player has an active pickup intent (see the renderer's click handling); the
    // world walks the player to the item using the same walk-to-target movement as the melee
    // chase, and equips it once in range. Cleared by the renderer, not the world, whenever the
    // player instead holds an attack on an enemy or plain ground movement.
    pickupTarget?: PickupTarget;
};

const UPGRADE_OFFER_SIZE = 3;

export class GameWorld {
    static readonly FIXED_STEP_SECONDS = 1 / 120;
    static readonly MAX_ACCUMULATED_SECONDS = 0.1;
    static readonly MAX_PROJECTILES = 32;
    static readonly MAX_VISUAL_EFFECTS = 32;
    static readonly MAX_GROUND_STRIKES = 16;
    static readonly BASIC_ATTACK_SLOT = 0;
    static readonly ENEMY_RESPAWN_SECONDS = 5;
    static readonly CORPSE_SECONDS = 6;
    static readonly ENEMY_GRID_CELL_SIZE = 256;
    static readonly ENEMY_NEIGHBOUR_QUERY_RADIUS = 256;
    // How close the player must walk to a ground item to pick it up; also the chase's stop
    // distance, so the player always ends up in pickup range rather than short of it.
    static readonly PICKUP_RADIUS = 0.5 * TILE_SIZE;

    timeSeconds = 0;
    player?: Player;
    enemies: Enemy[] = [];
    projectiles: Projectile[] = [];
    visualEffects: VisualEffect[] = [];
    pendingGroundStrikes: PendingGroundStrike[] = [];
    groundItems: GroundItem[] = [];
    private events: CombatEvent[] = [];

    private accumulatedSeconds = 0;
    private nextEnemyId = 1;
    private nextGroundItemId = 1;

    private encounter?: Encounter;
    private waveDirectorState: WaveDirectorState = initialWaveDirectorState(0);
    private enemyWaveIndex = new Map<number, number>();
    private killsByWave: number[] = [];
    private waveClearedNotified: boolean[] = [];
    private triggeredBossPhases = new Map<number, Set<number>>();
    pendingUpgradeOffer?: readonly Upgrade[];
    invulnerable = false;

    constructor(
        private readonly terrain: Terrain,
        private readonly seqTypeLoader: SeqTypeLoader,
        private readonly seqFrameLoader: SeqFrameLoader,
        private readonly random: RandomSource = Math.random,
    ) {}

    // The debug invulnerability toggle (see MapViewerControls) survives across spawnPlayer calls,
    // unlike the Player instance itself, which is recreated on every startEncounter.
    setInvulnerable(invulnerable: boolean): void {
        this.invulnerable = invulnerable;
        if (this.player) {
            this.player.invulnerable = invulnerable;
        }
    }

    spawnPlayer(x: number, y: number, level: number, styleSeqIds: StanceSeqIdsByStance): void {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        this.player = new Player(spawn.x, spawn.y, level, styleSeqIds);
        this.player.invulnerable = this.invulnerable;
    }

    // Spawns the player and populates the encounter's initial enemies (its static roster for a
    // STATIC_RESPAWN encounter, or nothing yet for a WAVES encounter, which the director fills in
    // from step() onward). May throw (e.g. terrain not loaded yet); on failure call
    // abortEncounter() to roll back rather than leaving partially-spawned state.
    startEncounter(
        encounter: Encounter,
        x: number,
        y: number,
        level: number,
        styleSeqIds: StanceSeqIdsByStance,
    ): void {
        this.spawnPlayer(x, y, level, styleSeqIds);
        this.encounter = encounter;
        this.enemies = [];
        this.groundItems = [];
        this.enemyWaveIndex.clear();
        this.triggeredBossPhases.clear();
        this.killsByWave = encounter.waves.map(() => 0);
        this.waveClearedNotified = encounter.waves.map(() => false);
        this.waveDirectorState = initialWaveDirectorState(encounter.waves.length);
        this.pendingUpgradeOffer = undefined;
        if (encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
            this.spawnStaticEncounterEnemies(encounter);
        }
    }

    abortEncounter(): void {
        this.player = undefined;
        this.enemies = [];
        this.groundItems = [];
        this.encounter = undefined;
        this.enemyWaveIndex.clear();
        this.triggeredBossPhases.clear();
        this.killsByWave = [];
        this.waveClearedNotified = [];
        this.waveDirectorState = initialWaveDirectorState(0);
        this.pendingUpgradeOffer = undefined;
    }

    getWaveProgress():
        | { index: number; total: number; cleared: boolean; awaitingUpgrade: boolean }
        | undefined {
        if (!this.encounter || this.encounter.spawnMode !== EncounterSpawnMode.WAVES) {
            return undefined;
        }
        return {
            index: Math.min(this.waveDirectorState.nextWaveIndex, this.encounter.waves.length),
            total: this.encounter.waves.length,
            cleared: this.waveDirectorState.cleared,
            awaitingUpgrade: this.pendingUpgradeOffer !== undefined,
        };
    }

    private spawnStaticEncounterEnemies(encounter: Encounter): void {
        let pointIndex = 0;
        for (const wave of encounter.waves) {
            for (const group of wave.groups) {
                const enemyType = getEnemyType(group.enemyTypeId);
                for (let i = 0; i < group.count; i++) {
                    const point = encounter.enemySpawns[pointIndex++];
                    this.spawnEnemy(point.x, point.y, point.level, enemyType);
                }
            }
        }
    }

    spawnEnemy(
        x: number,
        y: number,
        level: number,
        enemyType: EnemyType,
        abilities: readonly AbilityDefinition[] = enemyType.abilities,
        statsOverride?: EnemyStatsOverride,
    ): number {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        const id = this.nextEnemyId++;
        this.enemies.push(
            new Enemy(
                id,
                spawn.x,
                spawn.y,
                level,
                spawn.x,
                spawn.y,
                enemyType,
                abilities,
                statsOverride,
            ),
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

        if (this.pendingUpgradeOffer) {
            this.applyUpgradeChoice(input.chooseUpgrade);
            return;
        }

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

        this.enemies = this.enemies.filter(
            (enemy) => enemy.despawnAt === undefined || this.timeSeconds < enemy.despawnAt,
        );
        this.groundItems = this.groundItems.filter(
            (item) => !isGroundItemExpired(item, this.timeSeconds),
        );

        this.advanceWaveDirector();

        this.updateProjectiles(dtSeconds);
        this.resolveGroundStrikeImpacts();

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
            player.requestStyleSwitch(input.styleSwitch);
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
        this.resolvePickup(player, input);
    }

    findGroundItem(id: number): GroundItem | undefined {
        return this.groundItems.find((item) => item.id === id);
    }

    // Equips the targeted ground item and removes it once the player has walked within pickup
    // range (see computePickupChaseInput, which drives the walk using the same reach constant).
    private resolvePickup(player: Player, input: SimInput): void {
        const pickupTarget = input.pickupTarget;
        if (!pickupTarget) {
            return;
        }
        const item = this.findGroundItem(pickupTarget.groundItemId);
        if (!item || item.level !== player.level) {
            return;
        }
        if (distanceToGroundItem(item, player.x, player.y) > GameWorld.PICKUP_RADIUS) {
            return;
        }
        player.equipItemUpgrade(item.path, item.tierIndex);
        this.groundItems = this.groundItems.filter((existing) => existing.id !== item.id);
        this.events.push({
            kind: CombatEventKind.ITEM_PICKED_UP,
            path: item.path,
            tierIndex: item.tierIndex,
        });
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
            if (!this.encounter || this.encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
                enemy.respawnAt = this.timeSeconds + GameWorld.ENEMY_RESPAWN_SECONDS;
            } else {
                this.recordWaveEnemyDeath(enemy);
                enemy.despawnAt = this.timeSeconds + GameWorld.CORPSE_SECONDS;
            }
            this.events.push({ kind: CombatEventKind.ENEMY_DIED, target: enemy });
            this.maybeDropEquipment(enemy);
            return;
        }
        if (!wasAlive) {
            this.tryRespawnEnemy(enemy);
            return;
        }
        this.resolveEnemyAttack(enemy);
        this.checkBossPhase(enemy);
    }

    // Boss phases (see EnemyType.BossPhase) trigger once, the first time health crosses their
    // threshold; triggering one spawns its adds next to the boss and emits BOSS_PHASE so the HUD
    // can show the phase label. The adds dying doesn't end the phase or retrigger it.
    private checkBossPhase(enemy: Enemy): void {
        const phases = enemy.type.phases;
        if (!phases) {
            return;
        }
        const triggered = this.triggeredBossPhases.get(enemy.id) ?? new Set<number>();
        const phaseIndex = resolveTriggeredBossPhase(
            phases,
            enemy.health,
            enemy.maxHealth,
            triggered,
        );
        if (phaseIndex === undefined) {
            return;
        }
        triggered.add(phaseIndex);
        this.triggeredBossPhases.set(enemy.id, triggered);

        const phase = phases[phaseIndex];
        this.spawnBossPhaseAdds(enemy, phase.spawnAdds);
        this.events.push({
            kind: CombatEventKind.BOSS_PHASE,
            boss: enemy,
            phaseLabel: phase.label,
        });
    }

    private spawnBossPhaseAdds(boss: Enemy, adds: BossPhaseAdds): void {
        const addType = getEnemyType(adds.enemyTypeId);
        const offset = adds.offsetTiles * TILE_SIZE;
        for (let i = 0; i < adds.count; i++) {
            const angle = (i / adds.count) * Math.PI * 2;
            const x = boss.x + Math.cos(angle) * offset;
            const y = boss.y + Math.sin(angle) * offset;
            this.spawnEnemy(x, y, boss.level, addType);
        }
    }

    // Rolls a drop from the dying enemy's dropTier (see EnemyType.DropTier and GroundItem.rollDropPath):
    // at most one pending drop per equipment path, always the next tier above the player's current
    // one, never for a path already at max tier.
    private maybeDropEquipment(enemy: Enemy): void {
        const player = this.player;
        if (!player) {
            return;
        }
        const path = rollDropPath(
            enemy.type.dropTier,
            player.equipment,
            pendingGroundItemPaths(this.groundItems),
            this.random,
        );
        if (!path) {
            return;
        }
        const tierIndex = player.equipment[path] + 1;
        this.groundItems.push({
            id: this.nextGroundItemId++,
            path,
            tierIndex,
            x: enemy.x,
            y: enemy.y,
            level: enemy.level,
            expiresAtSeconds: this.timeSeconds + GROUND_ITEM_LIFETIME_SECONDS,
        });
        this.events.push({
            kind: CombatEventKind.ITEM_DROPPED,
            path,
            tierIndex,
            x: enemy.x,
            y: enemy.y,
            level: enemy.level,
        });
    }

    private recordWaveEnemyDeath(enemy: Enemy): void {
        const waveIndex = this.enemyWaveIndex.get(enemy.id);
        if (waveIndex === undefined) {
            return;
        }
        this.killsByWave[waveIndex] += 1;
    }

    private tryRespawnEnemy(enemy: Enemy): void {
        if (enemy.respawnAt === undefined || this.timeSeconds < enemy.respawnAt) {
            return;
        }
        enemy.respawn();
        this.events.push({ kind: CombatEventKind.ENEMY_RESPAWNED, target: enemy });
    }

    private aliveCountsByWave(waveCount: number): number[] {
        const counts = new Array(waveCount).fill(0);
        for (const enemy of this.enemies) {
            if (enemy.state === EnemyState.DEAD) {
                continue;
            }
            const waveIndex = this.enemyWaveIndex.get(enemy.id);
            if (waveIndex !== undefined) {
                counts[waveIndex]++;
            }
        }
        return counts;
    }

    private advanceWaveDirector(): void {
        const encounter = this.encounter;
        if (!encounter || encounter.spawnMode !== EncounterSpawnMode.WAVES || !this.player) {
            return;
        }
        const aliveByWave = this.aliveCountsByWave(encounter.waves.length);
        const wasCleared = this.waveDirectorState.cleared;
        const result = stepWaveDirector(
            this.waveDirectorState,
            encounter.waves,
            this.timeSeconds,
            aliveByWave,
            this.killsByWave,
        );
        this.waveDirectorState = result.nextState;
        for (const spawn of result.spawns) {
            this.spawnWaveEnemy(encounter, spawn);
        }
        if (!wasCleared && result.nextState.cleared) {
            this.events.push({ kind: CombatEventKind.ENCOUNTER_CLEARED });
            return;
        }
        this.maybeOfferUpgrade(encounter, aliveByWave);
    }

    // A non-final wave that has fully spawned and died pauses the sim and offers an upgrade; the
    // final wave's clear is handled above by ENCOUNTER_CLEARED instead, with no offer.
    private maybeOfferUpgrade(encounter: Encounter, aliveByWave: readonly number[]): void {
        if (this.pendingUpgradeOffer) {
            return;
        }
        for (let waveIndex = 0; waveIndex < encounter.waves.length - 1; waveIndex++) {
            if (this.waveClearedNotified[waveIndex]) {
                continue;
            }
            const spawnedFully =
                (aliveByWave[waveIndex] ?? 0) + (this.killsByWave[waveIndex] ?? 0) >=
                totalGroupCount(encounter.waves[waveIndex]);
            if (!spawnedFully || (aliveByWave[waveIndex] ?? 0) !== 0) {
                continue;
            }
            this.waveClearedNotified[waveIndex] = true;
            this.pendingUpgradeOffer = drawUpgradeOffer(
                UPGRADE_POOL,
                UPGRADE_OFFER_SIZE,
                this.random,
            );
            return;
        }
    }

    private applyUpgradeChoice(chooseUpgrade: number | undefined): void {
        const offer = this.pendingUpgradeOffer;
        if (!offer || chooseUpgrade === undefined || !this.player) {
            return;
        }
        const upgrade = offer[chooseUpgrade];
        if (!upgrade) {
            return;
        }
        this.player.applyUpgrade(upgrade);
        this.pendingUpgradeOffer = undefined;
    }

    private spawnWaveEnemy(encounter: Encounter, spawn: WaveSpawn): void {
        if (!this.player) {
            return;
        }
        const point = pickFarthestSpawnPoint(encounter.enemySpawns, this.player.x, this.player.y);
        const enemyType = getEnemyType(spawn.enemyTypeId);
        const id = this.spawnEnemy(
            point.x,
            point.y,
            point.level,
            enemyType,
            undefined,
            spawn.statsOverride,
        );
        this.enemyWaveIndex.set(id, spawn.waveIndex);
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
                this.spawnProjectile(enemy, this.resolveProjectileSpec(cast.definition.effect), {
                    x: this.player.x,
                    y: this.player.y,
                });
                break;
            case AbilityEffectKind.GROUND_STRIKE:
                this.resolveGroundStrike(enemy, cast.definition.effect, cast.target);
                break;
            case AbilityEffectKind.HEAL_ALLIES:
                this.resolveEnemyHealAllies(enemy, cast.definition.effect);
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

    private resolveEnemyHealAllies(caster: Enemy, effect: HealAlliesEffect): void {
        const radius = effect.radiusTiles * TILE_SIZE;
        for (const ally of this.enemies) {
            if (ally.level !== caster.level || ally.health <= 0) {
                continue;
            }
            if (Math.hypot(ally.x - caster.x, ally.y - caster.y) > radius) {
                continue;
            }
            applyHeal(ally, effect.amount, this.events);
            this.spawnVisualEffect(effect.hitEffect, ally);
        }
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
        this.pendingUpgradeOffer = undefined;
        this.player?.resetProgression();
        this.groundItems = [];

        const encounter = this.encounter;
        if (!encounter || encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
            for (const enemy of this.enemies) {
                enemy.respawn();
                this.events.push({ kind: CombatEventKind.ENEMY_RESPAWNED, target: enemy });
            }
            return;
        }
        // WAVES encounters don't respawn individual enemies; a player death restarts the whole
        // director from wave 1 instead.
        this.enemies = [];
        this.enemyWaveIndex.clear();
        this.triggeredBossPhases.clear();
        this.killsByWave = encounter.waves.map(() => 0);
        this.waveClearedNotified = encounter.waves.map(() => false);
        this.waveDirectorState = initialWaveDirectorState(encounter.waves.length);
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
        return (
            this.computeMeleeChaseInput(player, input) ??
            this.computePickupChaseInput(player, input) ??
            input.movement
        );
    }

    // Walks the player toward a pending pickup target using the same walk-to-target chase as
    // computeMeleeChaseInput, stopping once within GameWorld.PICKUP_RADIUS (resolvePickup then
    // equips the item on the same tick it stops).
    private computePickupChaseInput(player: Player, input: SimInput): PlayerInput | undefined {
        const pickupTarget = input.pickupTarget;
        if (!pickupTarget) {
            return undefined;
        }
        const item = this.findGroundItem(pickupTarget.groundItemId);
        if (!item || item.level !== player.level) {
            return undefined;
        }
        const deltaX = item.x - player.x;
        const deltaY = item.y - player.y;
        const distance = Math.hypot(deltaX, deltaY);
        const movement = computeChaseMovement(deltaX, deltaY, distance, GameWorld.PICKUP_RADIUS);
        if (movement.x === 0 && movement.y === 0) {
            return undefined;
        }
        return { x: movement.x, y: movement.y, running: input.movement.running };
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
                this.spawnProjectile(caster, this.resolveProjectileSpec(effect), target);
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
            case AbilityEffectKind.GROUND_STRIKE:
                this.resolveGroundStrike(caster, effect, target);
                break;
        }
    }

    // Rolls a fresh damage value into the spec for abilities that declare a damage range (see
    // ProjectileEffect.damageMin/Max), otherwise passes the spec's own fixed damage through as-is.
    private resolveProjectileSpec(effect: ProjectileEffect): ProjectileSpec {
        if (effect.damageMin === undefined || effect.damageMax === undefined) {
            return effect.spec;
        }
        return {
            ...effect.spec,
            damage: rollDamage(effect.damageMin, effect.damageMax, this.random),
        };
    }

    private spawnProjectile(caster: Combatant, spec: ProjectileSpec, target: AbilityTarget): void {
        if (spec.flight.kind === "DROP") {
            this.spawnDropProjectile(caster, spec, target);
            return;
        }
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

    // A DROP projectile spawns directly above the target rather than offset from the caster (it has
    // no horizontal travel to aim), so it gets its own spawn path instead of sharing spawnProjectile's
    // caster-relative placement.
    private spawnDropProjectile(
        caster: Combatant,
        spec: ProjectileSpec,
        target: AbilityTarget,
    ): void {
        if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
            return;
        }
        this.projectiles.push(
            new Projectile(spec, caster.faction, caster.level, target.x, target.y, 0, 1, 0),
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
        point: { readonly x: number; readonly y: number; readonly level: number },
        holdSeconds?: number,
    ): void {
        if (this.visualEffects.length >= GameWorld.MAX_VISUAL_EFFECTS) {
            return;
        }
        this.visualEffects.push(
            new VisualEffect(
                hitEffect.kind,
                point.level,
                point.x,
                point.y,
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
        if (effect.hitEffect) {
            const facing = rotationToDirection(caster.rotation);
            const landingDistance = effect.reach * 0.5;
            this.spawnVisualEffect(effect.hitEffect, {
                x: caster.x + facing.x * landingDistance,
                y: caster.y + facing.y * landingDistance,
                level: caster.level,
            });
            this.events.push({
                kind: CombatEventKind.CONE_MELEE_LANDED,
                x: caster.x,
                y: caster.y,
                level: caster.level,
                facingRotation: caster.rotation,
                angleRadians: effect.angleRadians,
                reach: effect.reach,
            });
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

    private resolveGroundStrike(
        caster: Combatant,
        effect: GroundStrikeEffect,
        target: AbilityTarget,
    ): void {
        if (this.pendingGroundStrikes.length >= GameWorld.MAX_GROUND_STRIKES) {
            return;
        }
        const targetEnemy = this.resolveEnemyTarget(target, caster.level);
        this.pendingGroundStrikes.push({
            x: targetEnemy?.x ?? target.x,
            y: targetEnemy?.y ?? target.y,
            level: caster.level,
            radius: effect.radiusTiles * TILE_SIZE,
            startSeconds: this.timeSeconds,
            strikeAtSeconds: this.timeSeconds + effect.telegraphSeconds,
            damageMin: effect.damageMin,
            damageMax: effect.damageMax,
            sourceFaction: caster.faction,
            caster,
        });
    }

    private resolveGroundStrikeImpacts(): void {
        if (this.pendingGroundStrikes.length === 0) {
            return;
        }
        const ready = this.pendingGroundStrikes.filter(
            (strike) => this.timeSeconds >= strike.strikeAtSeconds,
        );
        if (ready.length === 0) {
            return;
        }
        this.pendingGroundStrikes = this.pendingGroundStrikes.filter(
            (strike) => this.timeSeconds < strike.strikeAtSeconds,
        );
        const combatants = this.combatants();
        for (const strike of ready) {
            for (const combatant of combatantsHitByGroundStrike(strike, combatants)) {
                applyDamage(
                    combatant,
                    rollDamage(strike.damageMin, strike.damageMax, this.random),
                    this.events,
                );
            }
            this.events.push({
                kind: CombatEventKind.GROUND_STRIKE_LANDED,
                x: strike.x,
                y: strike.y,
                level: strike.level,
                radius: strike.radius,
            });
        }
    }
}
