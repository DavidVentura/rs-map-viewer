import { sequenceTimeToLastFrameSeconds } from "./Animation";
import { resolveReadyCast } from "./CastResolution";
import { CombatEvent, CombatEventKind } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { HitEffect } from "./Effect";
import { Encounter, EncounterScriptKind, EncounterSpawnMode, ScriptedEncounter } from "./Encounter";
import {
    EncounterActor,
    EncounterActorKind,
    EnergySiphonActor,
    updateEncounterActor,
} from "./EncounterActor";
import { EncounterAnimations } from "./EncounterAnimations";
import { EncounterScript } from "./EncounterScript";
import { Enemy, EnemyState } from "./Enemy";
import {
    BossPhaseAdds,
    EnemyStatsOverride,
    ResolvedEnemyType,
    resolveTriggeredBossPhase,
} from "./EnemyType";
import { EquipmentChange, EquipmentGrantId, createEquipmentGrant } from "./Equipment";
import { GroundItem, pendingGroundItemPaths, rollDropPath } from "./GroundItem";
import { Player } from "./Player";
import { SimInput, applyPlayerInput } from "./PlayerOrders";
import { Experience } from "./Progression";
import {
    Projectile,
    ProjectileImpact,
    ProjectileOutcome,
    ProjectileSpec,
    ProjectileTarget,
} from "./Projectile";
import { SpatialGrid } from "./SpatialGrid";
import { MAGIC_MANA_REFUND_PER_ENEMY, recordStationaryRangedHit } from "./StanceMechanics";
import { TILE_SIZE, Terrain } from "./Terrain";
import { VisualEffect, VisualEffectAnchor } from "./VisualEffect";
import { startWardensP3Encounter } from "./WardenP3Runtime";
import { WaveEncounterRuntime } from "./WaveEncounterRuntime";
import { ScheduledVisualEffect, WorldContext } from "./WorldContext";
import { RandomSource } from "./abilityRules";
import { FlightOrigin } from "./projectileMath";
import { resolveSpawn } from "./spawn";

export class GameWorld implements WorldContext {
    static readonly FIXED_STEP_SECONDS = 1 / 120;
    static readonly MAX_ACCUMULATED_SECONDS = 0.1;
    static readonly MAX_PROJECTILES = 32;
    static readonly MAX_VISUAL_EFFECTS = 64;
    static readonly ENEMY_RESPAWN_SECONDS = 5;
    // How long a corpse stays after its death animation reaches its final pose, so long death
    // animations (Jad) play out in full while short ones get swept up quickly.
    static readonly CORPSE_LINGER_SECONDS = 1;
    static readonly ENEMY_GRID_CELL_SIZE = 256;
    static readonly ENEMY_NEIGHBOUR_QUERY_RADIUS = 256;

    timeSeconds = 0;
    player?: Player;
    enemies: Enemy[] = [];
    // Non-combat encounter props (Wardens P3 phantoms and energy siphons) - never in combatants(),
    // enemy AI, wave/kill bookkeeping or damage paths (see EncounterActor.ts).
    encounterActors: EncounterActor[] = [];
    projectiles: Projectile[] = [];
    visualEffects: VisualEffect[] = [];
    // Effects due to start later (see landCone's outward ripple), holding their share of the
    // MAX_VISUAL_EFFECTS budget from the moment they're scheduled.
    pendingVisualEffects: ScheduledVisualEffect[] = [];
    groundItems: GroundItem[] = [];
    readonly events: CombatEvent[] = [];
    waveEncounter?: WaveEncounterRuntime;
    encounterScript?: EncounterScript;

    private accumulatedSeconds = 0;
    // Shared with encounterActors so ids stay unique across both (hover picking looks an id up in
    // either list without needing to know which kind it belongs to).
    private nextActorId = 1;
    private nextGroundItemId = 1;

    private encounter?: Encounter;
    private triggeredBossPhases = new Map<number, Set<number>>();
    godMode = false;
    // Dev preload (see MapViewerApp's ?gear= param): applied to every freshly spawned player, so a
    // reload with the same URL always previews the same gear.
    private gearOverride: readonly EquipmentChange[] = [];

    constructor(
        private readonly baseTerrain: Terrain,
        readonly animations: EncounterAnimations,
        readonly random: RandomSource = Math.random,
    ) {}

    // Wardens P3 pulls arena floor tiles at runtime; composing that over the base terrain here
    // means every movement path that consults Terrain (pathing, chase steering, click-to-walk, the
    // player's own movement) rejects pulled tiles without each caller knowing about the fight.
    get terrain(): Terrain {
        const script = this.encounterScript;
        return script ? script.overlayTerrain(this.baseTerrain) : this.baseTerrain;
    }

    // The debug god mode toggle (see MapViewerControls) survives across spawnPlayer calls, unlike
    // the Player instance itself, which is recreated on every startEncounter.
    setGodMode(godMode: boolean): void {
        this.godMode = godMode;
        if (this.player) {
            this.player.godMode = godMode;
        }
    }

    // The dev gear preload (see MapViewerApp's ?gear= param), applied on every future spawnPlayer
    // call, the same way setGodMode's toggle survives across them.
    setGearOverride(changes: readonly EquipmentChange[]): void {
        this.gearOverride = changes;
    }

    spawnPlayer(x: number, y: number, level: number): void {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        this.player = new Player(spawn.x, spawn.y, level, this.animations.player);
        this.player.godMode = this.godMode;
        if (this.gearOverride.length > 0) {
            this.player.equipGrant(
                createEquipmentGrant(
                    EquipmentGrantId.INDIVIDUAL,
                    "Dev gear preload",
                    this.gearOverride,
                ),
            );
        }
    }

    // Spawns the player and populates the encounter's initial enemies (its static roster for a
    // STATIC_RESPAWN encounter, or nothing yet for a WAVES encounter, which the director fills in
    // from step() onward). May throw (e.g. terrain not loaded yet); on failure call
    // abortEncounter() to roll back rather than leaving partially-spawned state.
    startEncounter(encounter: Encounter, x: number, y: number, level: number): void {
        this.spawnPlayer(x, y, level);
        this.encounter = encounter;
        this.enemies = [];
        this.encounterActors = [];
        this.projectiles = [];
        this.visualEffects = [];
        this.pendingVisualEffects = [];
        this.groundItems = [];
        this.triggeredBossPhases.clear();
        this.waveEncounter = undefined;
        this.encounterScript = undefined;
        switch (encounter.spawnMode) {
            case EncounterSpawnMode.STATIC_RESPAWN:
                this.spawnStaticEncounterEnemies(encounter);
                return;
            case EncounterSpawnMode.SCRIPTED:
                this.startScriptedEncounter(encounter);
                return;
            case EncounterSpawnMode.WAVES:
                this.waveEncounter = new WaveEncounterRuntime(this, encounter);
                return;
            case EncounterSpawnMode.PREVIEW:
                return;
        }
    }

    abortEncounter(): void {
        this.player = undefined;
        this.enemies = [];
        this.encounterActors = [];
        this.projectiles = [];
        this.visualEffects = [];
        this.pendingVisualEffects = [];
        this.groundItems = [];
        this.encounter = undefined;
        this.triggeredBossPhases.clear();
        this.waveEncounter = undefined;
        this.encounterScript = undefined;
    }

    private spawnStaticEncounterEnemies(encounter: Encounter): void {
        let pointIndex = 0;
        for (const wave of encounter.waves) {
            for (const group of wave.groups) {
                const enemyType = this.animations.enemyType(group.enemyTypeId);
                for (let i = 0; i < group.count; i++) {
                    const point = encounter.enemySpawns[pointIndex++];
                    this.spawnEnemy(point.x, point.y, point.level, enemyType);
                }
            }
        }
    }

    private startScriptedEncounter(encounter: ScriptedEncounter): void {
        switch (encounter.script.kind) {
            case EncounterScriptKind.WARDENS_P3:
                this.encounterScript = startWardensP3Encounter(this, encounter.script);
                return;
        }
    }

    spawnEnemy(
        x: number,
        y: number,
        level: number,
        enemyType: ResolvedEnemyType,
        statsOverride?: EnemyStatsOverride,
    ): number {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        const id = this.nextActorId++;
        this.enemies.push(
            new Enemy(id, spawn.x, spawn.y, level, spawn.x, spawn.y, enemyType, statsOverride),
        );
        return id;
    }

    spawnEnemyAtExactPosition(
        x: number,
        y: number,
        level: number,
        enemyType: ResolvedEnemyType,
    ): number {
        const id = this.nextActorId++;
        this.enemies.push(new Enemy(id, x, y, level, x, y, enemyType));
        return id;
    }

    allocateActorId(): number {
        return this.nextActorId++;
    }

    findEnemy(id: number): Enemy | undefined {
        return this.enemies.find((enemy) => enemy.id === id);
    }

    findEncounterActor(id: number): EncounterActor | undefined {
        return this.encounterActors.find((actor) => actor.id === id);
    }

    findEnergySiphon(id: number): EnergySiphonActor | undefined {
        const actor = this.findEncounterActor(id);
        return actor?.kind === EncounterActorKind.ENERGY_SIPHON ? actor : undefined;
    }

    findGroundItem(id: number): GroundItem | undefined {
        return this.groundItems.find((item) => item.id === id);
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

        const waves = this.waveEncounter;
        if (waves?.pendingUpgradeOffer) {
            waves.applyUpgradeChoice(input.chooseUpgrade);
            return;
        }

        if (this.player) {
            this.updatePlayer(this.player, input, dtSeconds);
        }

        const enemyGrid = SpatialGrid.build(
            GameWorld.ENEMY_GRID_CELL_SIZE,
            this.enemies.filter((enemy) => enemy.state !== EnemyState.DEAD),
        );
        for (const enemy of this.enemies) {
            const neighbours = enemyGrid
                .neighboursWithin(enemy.x, enemy.y, GameWorld.ENEMY_NEIGHBOUR_QUERY_RADIUS)
                .filter((neighbour) => neighbour !== enemy);
            this.updateEnemy(enemy, neighbours, dtSeconds);
        }

        this.enemies = this.enemies.filter(
            (enemy) => enemy.despawnAt === undefined || this.timeSeconds < enemy.despawnAt,
        );
        for (const actor of this.encounterActors) {
            updateEncounterActor(actor, dtSeconds);
        }
        this.encounterScript?.step();
        this.waveEncounter?.step();

        this.updateProjectiles(dtSeconds);
        this.startDueVisualEffects();

        this.visualEffects = this.visualEffects.filter((effect) =>
            effect.update(dtSeconds, this.timeSeconds),
        );

        this.checkPlayerDeath();
    }

    drainEvents(): CombatEvent[] {
        return this.events.splice(0);
    }

    private updatePlayer(player: Player, input: SimInput, dtSeconds: number): void {
        if (player.isDead(this.timeSeconds)) {
            player.update(input.movement, dtSeconds, this.timeSeconds, this.terrain);
            return;
        }
        if (player.isAwaitingRespawn(this.timeSeconds)) {
            player.respawn();
            this.resetEncounter();
            return;
        }
        if (this.waveEncounter?.updateInteraction(player, input, dtSeconds)) {
            return;
        }
        applyPlayerInput(this, player, input, dtSeconds);
    }

    private updateEnemy(enemy: Enemy, neighbours: readonly Enemy[], dtSeconds: number): void {
        const wasAlive = enemy.state !== EnemyState.DEAD;
        enemy.update(this.player, neighbours, dtSeconds, this.timeSeconds, this.terrain);

        if (wasAlive && enemy.state === EnemyState.DEAD) {
            if (!this.encounter || this.encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
                enemy.respawnAt = this.timeSeconds + GameWorld.ENEMY_RESPAWN_SECONDS;
            } else {
                this.waveEncounter?.recordEnemyDeath(enemy);
                enemy.despawnAt =
                    this.timeSeconds +
                    sequenceTimeToLastFrameSeconds(enemy.type.seqs.death) +
                    GameWorld.CORPSE_LINGER_SECONDS;
            }
            this.events.push({ kind: CombatEventKind.ENEMY_DIED, target: enemy });
            this.grantPlayerExperience(enemy.type.experienceReward);
            this.maybeDropEquipment(enemy);
            return;
        }
        if (!wasAlive) {
            this.tryRespawnEnemy(enemy);
            return;
        }
        resolveReadyCast(this, enemy);
        this.checkBossPhase(enemy);
    }

    grantPlayerExperience(amount: Experience): void {
        const player = this.player;
        if (!player) {
            throw new Error("Cannot grant experience without a player");
        }
        const transition = player.grantExperience(amount);
        for (const level of transition.gainedLevels) {
            this.events.push({ kind: CombatEventKind.LEVEL_UP, level });
        }
    }

    clearBattlefield(): void {
        this.enemies = this.enemies.filter((enemy) => enemy.state !== EnemyState.DEAD);
        this.triggeredBossPhases.clear();
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
        const addType = this.animations.enemyType(adds.enemyTypeId);
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
        this.dropGroundItem({
            path,
            tierIndex: player.equipment[path] + 1,
            x: enemy.x,
            y: enemy.y,
            level: enemy.level,
        });
    }

    dropGroundItem(drop: Omit<GroundItem, "id">): void {
        const item: GroundItem = { id: this.nextGroundItemId++, ...drop };
        this.groundItems.push(item);
        this.events.push({
            kind: CombatEventKind.ITEM_DROPPED,
            path: item.path,
            tierIndex: item.tierIndex,
            x: item.x,
            y: item.y,
            level: item.level,
        });
    }

    private tryRespawnEnemy(enemy: Enemy): void {
        if (enemy.respawnAt === undefined || this.timeSeconds < enemy.respawnAt) {
            return;
        }
        enemy.respawn();
        this.events.push({ kind: CombatEventKind.ENEMY_RESPAWNED, target: enemy });
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
        this.player?.resetProgression();
        this.groundItems = [];
        this.encounterActors = [];
        this.projectiles = [];
        this.visualEffects = [];
        this.pendingVisualEffects = [];
        this.encounterScript = undefined;

        const encounter = this.encounter;
        if (!encounter || encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
            for (const enemy of this.enemies) {
                enemy.respawn();
                this.events.push({ kind: CombatEventKind.ENEMY_RESPAWNED, target: enemy });
            }
            return;
        }
        this.enemies = [];
        this.triggeredBossPhases.clear();
        switch (encounter.spawnMode) {
            case EncounterSpawnMode.SCRIPTED:
                this.startScriptedEncounter(encounter);
                return;
            case EncounterSpawnMode.WAVES:
                // WAVES encounters don't respawn individual enemies; a player death restarts the
                // whole director from wave 1 instead.
                this.waveEncounter = new WaveEncounterRuntime(this, encounter);
                return;
            case EncounterSpawnMode.PREVIEW:
                throw new Error("The animation preview has no encounter to restart");
        }
    }

    private updateProjectiles(dtSeconds: number): void {
        const combatants = this.combatants();
        const survivingProjectiles: Projectile[] = [];
        for (const projectile of this.projectiles) {
            const outcome = projectile.update(
                dtSeconds,
                this.timeSeconds,
                combatants,
                this.events,
                this.random,
                this.terrain,
            );
            if (outcome.kind === "ALIVE") {
                survivingProjectiles.push(projectile);
                continue;
            }
            if (projectile.impact.hitEffect) {
                this.spawnProjectileHitEffect(
                    projectile.impact.hitEffect,
                    projectile.level,
                    outcome,
                );
            }
            if (outcome.kind === "HIT_COMBATANT" && projectile.impact.caster instanceof Player) {
                if (projectile.impact.playerMechanic === "RANGED_BASIC") {
                    projectile.impact.caster.stanceMechanics = recordStationaryRangedHit(
                        projectile.impact.caster.stanceMechanics,
                    );
                } else if (projectile.impact.playerMechanic === "MAGIC") {
                    projectile.impact.caster.refundMana(MAGIC_MANA_REFUND_PER_ENEMY);
                }
            }
        }
        this.projectiles = survivingProjectiles;
    }

    private startDueVisualEffects(): void {
        const due = this.pendingVisualEffects.filter(
            (pending) => this.timeSeconds >= pending.startsAt,
        );
        this.pendingVisualEffects = this.pendingVisualEffects.filter(
            (pending) => this.timeSeconds < pending.startsAt,
        );
        for (const { hitEffect, anchor } of due) {
            this.visualEffects.push(
                new VisualEffect(
                    hitEffect.kind,
                    anchor,
                    hitEffect.height,
                    this.animations.effects[hitEffect.kind],
                ),
            );
        }
    }

    private spawnProjectileHitEffect(
        hitEffect: HitEffect,
        level: number,
        outcome: Exclude<ProjectileOutcome, { kind: "ALIVE" }>,
    ): void {
        switch (outcome.kind) {
            case "HIT_COMBATANT":
                this.spawnVisualEffect(hitEffect, {
                    kind: "COMBATANT",
                    combatant: outcome.combatant,
                });
                return;
            case "LANDED":
                this.spawnVisualEffect(hitEffect, {
                    kind: "POINT",
                    x: outcome.x,
                    y: outcome.y,
                    level,
                    rotation: 0,
                });
                return;
            case "EXPIRED":
                return;
        }
    }

    launchProjectile(
        spec: ProjectileSpec,
        impact: ProjectileImpact,
        start: FlightOrigin,
        target: ProjectileTarget,
    ): void {
        if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
            return;
        }
        this.projectiles.push(
            new Projectile(
                spec,
                impact,
                start,
                target,
                this.animations.projectileTravel[spec.kind],
            ),
        );
    }

    get visualEffectBudget(): number {
        return (
            GameWorld.MAX_VISUAL_EFFECTS -
            this.visualEffects.length -
            this.pendingVisualEffects.length
        );
    }

    spawnVisualEffect(
        hitEffect: HitEffect,
        anchor: VisualEffectAnchor,
        holdSeconds?: number,
    ): void {
        this.pushVisualEffect(
            new VisualEffect(
                hitEffect.kind,
                anchor,
                hitEffect.height,
                this.animations.effects[hitEffect.kind],
                holdSeconds !== undefined ? this.timeSeconds + holdSeconds : undefined,
            ),
        );
    }

    pushVisualEffect(effect: VisualEffect): void {
        if (this.visualEffectBudget <= 0) {
            return;
        }
        this.visualEffects.push(effect);
    }
}
