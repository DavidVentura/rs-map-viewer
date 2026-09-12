import {
    AbilityEffect,
    AbilityTarget,
    AbilityTargetKind,
    ConeDelivery,
    DeliveryKind,
    ProjectileDelivery,
    ResolvedAbility,
    WeaponStyle,
    abilityTargetPoint,
    aimedCombatant,
    liveAbilityTarget,
    trackedDeliveryReach,
} from "./Ability";
import { AnimationPlayback, SeqTiming, sequenceDurationSeconds } from "./Animation";
import { CombatEvent, CombatEventKind } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { HitEffect, applyPayloads, hitEffectHoldSeconds } from "./Effect";
import { affectedCombatants, coneTileSpawns } from "./EffectResolution";
import { Encounter, EncounterSpawnMode } from "./Encounter";
import { EncounterAnimations } from "./EncounterAnimations";
import { Enemy, EnemyState, computeChaseMovement } from "./Enemy";
import {
    BossPhaseAdds,
    EnemyStatsOverride,
    ResolvedEnemyType,
    resolveTriggeredBossPhase,
} from "./EnemyType";
import { EquipmentChange, EquipmentGrantId, createEquipmentGrant } from "./Equipment";
import {
    GroundItem,
    distanceToGroundItem,
    pendingGroundItemPaths,
    planGrantDrops,
    rollDropPath,
} from "./GroundItem";
import {
    IDLE_INTERACTION,
    Interaction,
    InteractionId,
    InteractionState,
    WorldAction,
    WorldObject,
    WorldObjectId,
    WorldObjectKind,
    WorldObjectVisual,
    beginExecution,
    beginInteraction,
    cancelInteraction,
    completeInteraction,
    isWorldObjectVisible,
    worldObjectApproachPose,
    worldObjectVariant,
} from "./Interaction";
import { PhaseLifecycle, currentPhase, initialPhaseLifecycle, transitionPhase } from "./Phase";
import { Player, PlayerInput } from "./Player";
import { Experience, createExperience } from "./Progression";
import {
    Projectile,
    ProjectileImpact,
    ProjectileLanding,
    ProjectileOutcome,
    ProjectileSpec,
    ProjectileTarget,
    travelSeconds,
} from "./Projectile";
import { Reward } from "./Reward";
import { SpatialGrid } from "./SpatialGrid";
import {
    MAGIC_MANA_REFUND_PER_ENEMY,
    consumeRangedDoubleShot,
    recordStationaryRangedHit,
    resetRangedHits,
} from "./StanceMechanics";
import { TILE_SIZE, Terrain } from "./Terrain";
import {
    VisualEffect,
    VisualEffectAnchor,
    casterEffectAnchor,
    casterEffectTiming,
} from "./VisualEffect";
import {
    WaveDirectorState,
    WaveSpawn,
    initialWaveDirectorState,
    pickFarthestSpawnPoint,
    stepWaveDirector,
} from "./WaveDirector";
import { RandomSource, isWithinMeleeReach } from "./abilityRules";
import {
    FlightOrigin,
    directionToRotation,
    generateSpreadDirections,
    rotationToDirection,
} from "./projectileMath";
import { resolveScatterPosition, resolveSpawn } from "./spawn";
import { UPGRADE_POOL, Upgrade } from "./upgrades";

export type AbilitySlotInput = {
    readonly held: boolean;
    readonly target?: AbilityTarget;
};

export type CombatInput = {
    readonly basicAttack: AbilitySlotInput;
    readonly skills: readonly AbilitySlotInput[];
};

export type PickupTarget = {
    readonly groundItemId: number;
};

export type InteractionIntent =
    | { readonly kind: "START"; readonly interactionId: InteractionId }
    | { readonly kind: "CANCEL" };

export type SimInput = {
    movement: PlayerInput;
    combat: CombatInput;
    styleSwitch?: WeaponStyle;
    // Set while the player has an active pickup intent (see the renderer's click handling); the
    // world walks the player to the item using the same walk-to-target movement as the melee
    // chase, and equips it once in range. Cleared by the renderer, not the world, whenever the
    // player instead holds an attack on an enemy or plain ground movement.
    pickupTarget?: PickupTarget;
    interaction?: InteractionIntent;
    chooseUpgrade?: number;
};

export type ScheduledVisualEffect = {
    readonly hitEffect: HitEffect;
    readonly anchor: VisualEffectAnchor;
    readonly startsAt: number;
};

export class GameWorld {
    static readonly FIXED_STEP_SECONDS = 1 / 120;
    static readonly MAX_ACCUMULATED_SECONDS = 0.1;
    static readonly MAX_PROJECTILES = 32;
    static readonly PROJECTILE_LAUNCH_OFFSET = 48;
    static readonly MAX_VISUAL_EFFECTS = 64;
    static readonly ENEMY_RESPAWN_SECONDS = 5;
    // How long a corpse stays after its death animation finishes, so long death animations (Jad)
    // play out in full while short ones get swept up quickly.
    static readonly CORPSE_LINGER_SECONDS = 1;
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
    // Effects due to start later (see landCone's outward ripple), holding their share of the
    // MAX_VISUAL_EFFECTS budget from the moment they're scheduled.
    pendingVisualEffects: ScheduledVisualEffect[] = [];
    groundItems: GroundItem[] = [];
    private events: CombatEvent[] = [];

    private accumulatedSeconds = 0;
    private nextEnemyId = 1;
    private nextGroundItemId = 1;

    private encounter?: Encounter;
    phaseLifecycle?: PhaseLifecycle;
    interactionState: InteractionState = IDLE_INTERACTION;
    private waveDirectorState: WaveDirectorState = initialWaveDirectorState(0);
    private enemyWaveIndex = new Map<number, number>();
    private killsByWave: number[] = [];
    private triggeredBossPhases = new Map<number, Set<number>>();
    activatedPhaseRewards?: WorldAction;
    pendingUpgradeOffer?: readonly Upgrade[];
    private pendingPhaseRewards: readonly Reward[] = [];
    godMode = false;
    // Dev preload (see MapViewerApp's ?gear= param): applied to every freshly spawned player, so a
    // reload with the same URL always previews the same gear.
    private gearOverride: readonly EquipmentChange[] = [];

    constructor(
        private readonly terrain: Terrain,
        private readonly animations: EncounterAnimations,
        private readonly random: RandomSource = Math.random,
    ) {}

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
        this.groundItems = [];
        this.enemyWaveIndex.clear();
        this.triggeredBossPhases.clear();
        this.phaseLifecycle =
            encounter.spawnMode === EncounterSpawnMode.WAVES
                ? initialPhaseLifecycle(encounter.phases)
                : undefined;
        this.killsByWave = [];
        this.waveDirectorState = initialWaveDirectorState(0);
        this.interactionState = IDLE_INTERACTION;
        this.activatedPhaseRewards = undefined;
        this.pendingUpgradeOffer = undefined;
        this.pendingPhaseRewards = [];
        if (encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
            this.spawnStaticEncounterEnemies(encounter);
        }
    }

    abortEncounter(): void {
        this.player = undefined;
        this.enemies = [];
        this.groundItems = [];
        this.encounter = undefined;
        this.phaseLifecycle = undefined;
        this.interactionState = IDLE_INTERACTION;
        this.activatedPhaseRewards = undefined;
        this.pendingUpgradeOffer = undefined;
        this.pendingPhaseRewards = [];
        this.enemyWaveIndex.clear();
        this.triggeredBossPhases.clear();
        this.killsByWave = [];
        this.waveDirectorState = initialWaveDirectorState(0);
    }

    getWaveProgress():
        | { index: number; total: number; cleared: boolean; awaitingUpgrade: boolean }
        | undefined {
        if (
            !this.encounter ||
            this.encounter.spawnMode !== EncounterSpawnMode.WAVES ||
            !this.phaseLifecycle
        ) {
            return undefined;
        }
        const phase = currentPhase(this.phaseLifecycle);
        return {
            index: Math.min(this.waveDirectorState.nextWaveIndex, phase.waves.length),
            total: phase.waves.length,
            cleared: this.waveDirectorState.cleared,
            awaitingUpgrade: false,
        };
    }

    getPhaseProgress():
        | { index: number; total: number; label: string; state: PhaseLifecycle["kind"] }
        | undefined {
        const lifecycle = this.phaseLifecycle;
        if (!lifecycle) {
            return undefined;
        }
        return {
            index: lifecycle.phaseIndex + 1,
            total: lifecycle.phases.length,
            label: currentPhase(lifecycle).label,
            state: lifecycle.kind,
        };
    }

    get activeInteractions(): readonly Interaction[] {
        const encounter = this.encounter;
        const lifecycle = this.phaseLifecycle;
        if (!encounter || encounter.spawnMode !== EncounterSpawnMode.WAVES || !lifecycle) {
            return [];
        }
        const phase = currentPhase(lifecycle);
        return encounter.interactions.filter((interaction) => {
            if (interaction.action.phaseId !== phase.id) {
                return false;
            }
            return (
                (interaction.action.kind === "START_PHASE" && lifecycle.kind === "READY") ||
                (interaction.action.kind === "ACTIVATE_PHASE_REWARDS" &&
                    lifecycle.kind === "REWARDS")
            );
        });
    }

    // Every world object the encounter declares (the lever, the chest), with whether it should be
    // drawn right now and which variant (rest/activated) it should show - see
    // Interaction.isWorldObjectVisible/worldObjectVariant for the rules.
    get worldObjectVisuals(): readonly WorldObjectVisual[] {
        const encounter = this.encounter;
        if (!encounter || encounter.spawnMode !== EncounterSpawnMode.WAVES) {
            return [];
        }
        const activeInteractions = this.activeInteractions;
        const rewardsBeingClaimed = this.activatedPhaseRewards !== undefined;
        return encounter.worldObjects.map((object) => ({
            object,
            visible: isWorldObjectVisible(
                object,
                activeInteractions,
                this.interactionState,
                rewardsBeingClaimed,
            ),
            variant: worldObjectVariant(object, this.interactionState, rewardsBeingClaimed),
        }));
    }

    private findWorldObject(objectId: WorldObjectId): WorldObject {
        const encounter = this.encounter;
        if (!encounter || encounter.spawnMode !== EncounterSpawnMode.WAVES) {
            throw new Error("Cannot resolve a world object outside a wave encounter");
        }
        const object = encounter.worldObjects.find((candidate) => candidate.id === objectId);
        if (!object) {
            throw new Error(`Encounter does not declare world object ${objectId}`);
        }
        return object;
    }

    private findWorldObjectByKind(kind: WorldObjectKind): WorldObject {
        const encounter = this.encounter;
        if (!encounter || encounter.spawnMode !== EncounterSpawnMode.WAVES) {
            throw new Error("Cannot resolve a world object outside a wave encounter");
        }
        const object = encounter.worldObjects.find((candidate) => candidate.kind === kind);
        if (!object) {
            throw new Error(`Encounter does not declare a ${kind} world object`);
        }
        return object;
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

    private projectileTravelSeq(spec: ProjectileSpec): SeqTiming | undefined {
        return this.animations.projectileTravel[spec.kind];
    }

    spawnEnemy(
        x: number,
        y: number,
        level: number,
        enemyType: ResolvedEnemyType,
        statsOverride?: EnemyStatsOverride,
    ): number {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        const id = this.nextEnemyId++;
        this.enemies.push(
            new Enemy(id, spawn.x, spawn.y, level, spawn.x, spawn.y, enemyType, statsOverride),
        );
        return id;
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

        if (this.pendingUpgradeOffer) {
            this.applyUpgradeChoice(input.chooseUpgrade);
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
        this.advanceWaveDirector();

        this.updateProjectiles(dtSeconds);
        this.startDueVisualEffects();

        this.visualEffects = this.visualEffects.filter((effect) =>
            effect.update(dtSeconds, this.timeSeconds),
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
            player.update(input.movement, dtSeconds, this.timeSeconds, this.terrain);
            return;
        }
        if (player.isAwaitingRespawn(this.timeSeconds)) {
            player.respawn();
            this.resetEncounter();
            return;
        }

        this.cancelInteractionForPlayerAction(input);
        this.processInteractionIntent(player, input.interaction);
        if (this.updateInteraction(player, input.movement.running, dtSeconds)) {
            return;
        }

        if (input.styleSwitch !== undefined) {
            player.requestStyleSwitch(input.styleSwitch);
        }
        this.processCombatInput(player, input.combat, this.timeSeconds);
        const movement = this.resolveMovementInput(player, input);
        if (movement.x !== 0 || movement.y !== 0) {
            player.stanceMechanics = resetRangedHits(player.stanceMechanics);
        }
        player.update(movement, dtSeconds, this.timeSeconds, this.terrain);
        this.resolveReadyCast(player);
        this.resolvePickup(player, input);
    }

    private cancelInteractionForPlayerAction(input: SimInput): void {
        if (this.interactionState.kind === "IDLE" || input.interaction?.kind === "START") {
            return;
        }
        const moved = input.movement.x !== 0 || input.movement.y !== 0;
        const attacked =
            input.combat.basicAttack.held || input.combat.skills.some((skill) => skill.held);
        if (!moved && !attacked && input.styleSwitch === undefined && !input.pickupTarget) {
            return;
        }
        this.interactionState = cancelInteraction(this.interactionState);
    }

    private processInteractionIntent(player: Player, intent: InteractionIntent | undefined): void {
        if (!intent) {
            return;
        }
        if (intent.kind === "CANCEL") {
            if (this.interactionState.kind !== "IDLE") {
                this.interactionState = cancelInteraction(this.interactionState);
            }
            return;
        }
        if (this.interactionState.kind !== "IDLE") {
            return;
        }
        const interaction = this.activeInteractions.find(
            (candidate) => candidate.id === intent.interactionId,
        );
        if (!interaction) {
            return;
        }
        const object = this.findWorldObject(interaction.objectId);
        this.interactionState = beginInteraction(
            this.interactionState,
            interaction,
            worldObjectApproachPose(object),
        );
    }

    private updateInteraction(player: Player, running: boolean, dtSeconds: number): boolean {
        const state = this.interactionState;
        if (state.kind === "IDLE") {
            return false;
        }
        if (state.kind === "EXECUTING") {
            player.x = state.pose.position.x;
            player.y = state.pose.position.y;
            player.rotation = state.pose.facingRotation;
            if (this.timeSeconds >= state.completesAtSeconds) {
                const completed = completeInteraction(state, this.timeSeconds);
                this.interactionState = completed.state;
                this.dispatchWorldAction(completed.action);
                return true;
            }
            player.animation.advance(dtSeconds, AnimationPlayback.ONCE);
            return true;
        }

        const deltaX = state.pose.position.x - player.x;
        const deltaY = state.pose.position.y - player.y;
        const distance = Math.hypot(deltaX, deltaY);
        const speed =
            (running ? Player.RUN_SPEED : Player.WALK_SPEED) *
            player.getModifiers().moveSpeedMultiplier;
        if (distance <= speed * dtSeconds) {
            player.x = state.pose.position.x;
            player.y = state.pose.position.y;
            player.rotation = state.pose.facingRotation;
            const seq = this.animations.interactionSeq(state.interaction.id);
            this.interactionState = beginExecution(
                state,
                state.pose.position,
                this.timeSeconds,
                sequenceDurationSeconds(seq),
            );
            player.animation.restart(seq);
            return true;
        }
        player.update(
            { x: deltaX / distance, y: deltaY / distance, running },
            dtSeconds,
            this.timeSeconds,
            this.terrain,
        );
        return true;
    }

    private dispatchWorldAction(action: WorldAction): void {
        const lifecycle = this.phaseLifecycle;
        if (!lifecycle || currentPhase(lifecycle).id !== action.phaseId) {
            throw new Error(`Interaction action ${action.kind} does not target the current phase`);
        }
        switch (action.kind) {
            case "START_PHASE":
                this.phaseLifecycle = transitionPhase(lifecycle, { kind: "START_PHASE" });
                this.startPhaseWaves();
                return;
            case "ACTIVATE_PHASE_REWARDS":
                if (lifecycle.kind !== "REWARDS") {
                    throw new Error("Cannot activate rewards outside the rewards lifecycle state");
                }
                this.activatedPhaseRewards = action;
                this.pendingPhaseRewards = currentPhase(lifecycle).rewards;
                this.activateNextPhaseReward();
                return;
        }
    }

    private activateNextPhaseReward(): void {
        const [reward, ...remaining] = this.pendingPhaseRewards;
        if (!reward) {
            const lifecycle = this.phaseLifecycle;
            if (!lifecycle || lifecycle.kind !== "REWARDS") {
                throw new Error("Cannot finish phase rewards outside the rewards state");
            }
            this.phaseLifecycle = transitionPhase(lifecycle, { kind: "REWARDS_CLAIMED" });
            this.activatedPhaseRewards = undefined;
            return;
        }
        this.pendingPhaseRewards = remaining;
        if (reward.kind === "EXPERIENCE") {
            this.grantPlayerExperience(createExperience(reward.amount));
            this.activateNextPhaseReward();
            return;
        }
        if (reward.kind === "EQUIPMENT_GRANT") {
            this.dropEquipmentGrant(reward.grant.changes);
            this.activateNextPhaseReward();
            return;
        }
        if (reward.kind !== "UPGRADE_CHOICE") {
            throw new Error(`Reward ${reward.kind} is not implemented yet`);
        }
        this.pendingUpgradeOffer = reward.choices.map((choice) => {
            const upgrade = UPGRADE_POOL.find(({ id }) => id === choice);
            if (!upgrade) {
                throw new Error(`Unknown authored upgrade ${choice}`);
            }
            return upgrade;
        });
    }

    private applyUpgradeChoice(choiceIndex: number | undefined): void {
        if (choiceIndex === undefined || !this.pendingUpgradeOffer || !this.player) {
            return;
        }
        const upgrade = this.pendingUpgradeOffer[choiceIndex];
        if (!upgrade) {
            throw new RangeError(`No upgrade choice at index ${choiceIndex}`);
        }
        this.player.applyUpgrade(upgrade);
        this.pendingUpgradeOffer = undefined;
        this.activateNextPhaseReward();
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
        player.equipGrant(
            createEquipmentGrant(EquipmentGrantId.INDIVIDUAL, "Equipment upgrade", [
                { path: item.path, tierIndex: item.tierIndex },
            ]),
        );
        this.groundItems = this.groundItems.filter((existing) => existing.id !== item.id);
        this.events.push({
            kind: CombatEventKind.ITEM_PICKED_UP,
            path: item.path,
            tierIndex: item.tierIndex,
        });
    }

    // A chest's rewards burst onto the floor as individual real items around it, one per change in
    // the grant, rather than being auto-equipped - the player picks each one up like an enemy drop.
    private dropEquipmentGrant(changes: readonly EquipmentChange[]): void {
        const player = this.player;
        if (!player) {
            throw new Error("Cannot drop an equipment reward without a player");
        }
        const chest = this.findWorldObjectByKind(WorldObjectKind.CHEST);
        const plan = planGrantDrops(changes, player.equipment, this.groundItems);
        const replaced = new Set(plan.replacedItemIds);
        this.groundItems = this.groundItems.filter((item) => !replaced.has(item.id));
        for (const change of plan.drops) {
            const position = resolveScatterPosition(
                this.terrain,
                chest.position.level,
                chest.position.x,
                chest.position.y,
                this.groundItems.length,
            );
            const item: GroundItem = {
                id: this.nextGroundItemId++,
                path: change.path,
                tierIndex: change.tierIndex,
                x: position.x,
                y: position.y,
                level: chest.position.level,
            };
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
    }

    private updateEnemy(enemy: Enemy, neighbours: readonly Enemy[], dtSeconds: number): void {
        const wasAlive = enemy.state !== EnemyState.DEAD;
        enemy.update(this.player, neighbours, dtSeconds, this.timeSeconds, this.terrain);

        if (wasAlive && enemy.state === EnemyState.DEAD) {
            if (!this.encounter || this.encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
                enemy.respawnAt = this.timeSeconds + GameWorld.ENEMY_RESPAWN_SECONDS;
            } else {
                this.recordWaveEnemyDeath(enemy);
                enemy.despawnAt =
                    this.timeSeconds +
                    sequenceDurationSeconds(enemy.type.seqs.death) +
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
        this.resolveReadyCast(enemy);
        this.checkBossPhase(enemy);
    }

    private grantPlayerExperience(amount: Experience): void {
        const player = this.player;
        if (!player) {
            throw new Error("Cannot grant experience without a player");
        }
        const transition = player.grantExperience(amount);
        for (const level of transition.gainedLevels) {
            this.events.push({ kind: CombatEventKind.LEVEL_UP, level });
        }
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
        const tierIndex = player.equipment[path] + 1;
        this.groundItems.push({
            id: this.nextGroundItemId++,
            path,
            tierIndex,
            x: enemy.x,
            y: enemy.y,
            level: enemy.level,
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

    private startPhaseWaves(): void {
        const lifecycle = this.phaseLifecycle;
        if (!lifecycle || lifecycle.kind !== "ACTIVE") {
            throw new Error("Cannot start wave scheduling without an active phase");
        }
        const phase = currentPhase(lifecycle);
        this.enemies = this.enemies.filter((enemy) => enemy.state !== EnemyState.DEAD);
        this.enemyWaveIndex.clear();
        this.triggeredBossPhases.clear();
        this.killsByWave = phase.waves.map(() => 0);
        this.waveDirectorState = initialWaveDirectorState(phase.waves.length);
    }

    private advanceWaveDirector(): void {
        const encounter = this.encounter;
        const lifecycle = this.phaseLifecycle;
        if (
            !encounter ||
            encounter.spawnMode !== EncounterSpawnMode.WAVES ||
            !lifecycle ||
            lifecycle.kind !== "ACTIVE" ||
            !this.player
        ) {
            return;
        }
        const phase = currentPhase(lifecycle);
        const aliveByWave = this.aliveCountsByWave(phase.waves.length);
        const wasCleared = this.waveDirectorState.cleared;
        const result = stepWaveDirector(
            this.waveDirectorState,
            phase.waves,
            this.timeSeconds,
            aliveByWave,
            this.killsByWave,
        );
        this.waveDirectorState = result.nextState;
        for (const spawn of result.spawns) {
            this.spawnWaveEnemy(encounter, spawn);
        }
        if (!wasCleared && result.nextState.cleared) {
            this.phaseLifecycle = transitionPhase(lifecycle, { kind: "PHASE_CLEARED" });
            if (this.phaseLifecycle.kind === "COMPLETE") {
                this.events.push({ kind: CombatEventKind.ENCOUNTER_CLEARED });
            }
        }
    }

    private spawnWaveEnemy(encounter: Encounter, spawn: WaveSpawn): void {
        if (!this.player) {
            return;
        }
        const point = pickFarthestSpawnPoint(encounter.enemySpawns, this.player.x, this.player.y);
        const enemyType = this.animations.enemyType(spawn.enemyTypeId);
        const id = this.spawnEnemy(point.x, point.y, point.level, enemyType, spawn.statsOverride);
        this.enemyWaveIndex.set(id, spawn.waveIndex);
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
        this.phaseLifecycle = initialPhaseLifecycle(encounter.phases);
        this.interactionState = IDLE_INTERACTION;
        this.activatedPhaseRewards = undefined;
        this.pendingUpgradeOffer = undefined;
        this.pendingPhaseRewards = [];
        this.killsByWave = [];
        this.waveDirectorState = initialWaveDirectorState(0);
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
        const basicAttackInput = input.combat.basicAttack;
        if (!basicAttackInput.held || !basicAttackInput.target) {
            return undefined;
        }
        const enemy = aimedCombatant(basicAttackInput.target, player.level);
        if (!enemy) {
            return undefined;
        }
        const attack = player.basicAttack;
        const deliveryReach = trackedDeliveryReach(attack.effect.delivery);
        if (deliveryReach === undefined) {
            return undefined;
        }
        const deltaX = enemy.x - player.x;
        const deltaY = enemy.y - player.y;
        const distance = Math.hypot(deltaX, deltaY);
        const reach = deliveryReach + player.hitRadius + enemy.hitRadius;
        if (distance <= reach) {
            return undefined;
        }
        const movement = computeChaseMovement(deltaX, deltaY, distance, reach);
        if (movement.x === 0 && movement.y === 0) {
            return undefined;
        }
        return { x: movement.x, y: movement.y, running: input.movement.running };
    }

    private processCombatInput(player: Player, combat: CombatInput, time: number): void {
        this.tryBeginBasicAttack(player, combat.basicAttack, time);
        const skillCount = Math.min(combat.skills.length, player.skills.length);
        for (let skillSlot = 0; skillSlot < skillCount; skillSlot++) {
            this.tryBeginCast(
                player,
                player.skills[skillSlot],
                combat.skills[skillSlot],
                player.canUseSkillIgnoringTarget(skillSlot, time),
                time,
            );
        }
    }

    private tryBeginBasicAttack(
        player: Player,
        abilityInput: AbilitySlotInput,
        time: number,
    ): void {
        const basicAttack = player.basicAttack;
        if (!abilityInput.held || !abilityInput.target) {
            return;
        }
        if (
            !player.canUseBasicAttackIgnoringTarget(time) ||
            !this.canUseAbility(player, basicAttack, abilityInput.target)
        ) {
            return;
        }
        if (
            player.style === WeaponStyle.RANGED &&
            basicAttack.effect.delivery.kind === DeliveryKind.PROJECTILE
        ) {
            const consumed = consumeRangedDoubleShot(player.stanceMechanics);
            player.stanceMechanics = consumed.state;
            const delivery = consumed.firesDouble
                ? { ...basicAttack.effect.delivery, count: 2 }
                : basicAttack.effect.delivery;
            this.beginPlayerCast(
                player,
                { ...basicAttack, effect: { ...basicAttack.effect, delivery } },
                abilityInput.target,
                time,
            );
            return;
        }
        this.beginPlayerCast(player, basicAttack, abilityInput.target, time);
    }

    private tryBeginCast(
        player: Player,
        ability: ResolvedAbility,
        abilityInput: AbilitySlotInput,
        canUse: boolean,
        time: number,
    ): void {
        if (!abilityInput.held || !abilityInput.target) {
            return;
        }
        if (!canUse || !this.canUseAbility(player, ability, abilityInput.target)) {
            return;
        }
        this.beginPlayerCast(player, ability, abilityInput.target, time);
    }

    // The one path a player's cast begins through, whichever slot triggered it: starts the cast
    // itself, then - if the ability has one - its caster-anchored graphic (a weapon-special trail,
    // a launch flash at the bow/staff), so that graphic starts with the swing and keeps pace with
    // it at the ability's own castSpeed, rather than lagging to the point of impact at natural
    // speed (see AbilityEffect.casterEffect).
    private beginPlayerCast(
        player: Player,
        ability: ResolvedAbility,
        target: AbilityTarget,
        time: number,
    ): void {
        player.beginCast(ability, target, time);
        const casterEffect = ability.effect.casterEffect;
        if (casterEffect) {
            this.pushVisualEffect(
                new VisualEffect(
                    casterEffect.kind,
                    casterEffectAnchor(player, casterEffect.placement),
                    casterEffect.height,
                    casterEffectTiming(this.animations.effects[casterEffect.kind], ability.castSeq),
                    undefined,
                    ability.castSpeed,
                ),
            );
        }
    }

    private canUseAbility(
        player: Player,
        ability: ResolvedAbility,
        target: AbilityTarget,
    ): boolean {
        const reach = trackedDeliveryReach(ability.effect.delivery);
        if (reach === undefined) {
            return true;
        }
        const enemy = aimedCombatant(target, player.level);
        if (!enemy) {
            return false;
        }
        const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        return isWithinMeleeReach(distance, reach, player.hitRadius, enemy.hitRadius);
    }

    private resolveReadyCast(caster: Player | Enemy): void {
        const cast = caster.abilityRuntime.takeReadyCast(this.timeSeconds);
        if (!cast) {
            return;
        }
        this.resolveEffect(caster, cast.definition, cast.target);
    }

    // The one resolution path for every cast, player or enemy: the delivery picks who is affected
    // (or spawns projectiles, picked later on arrival), the payloads land on each of them, and the
    // hit graphic is anchored per combatant for combatant deliveries or at the landing point for
    // point deliveries (see AbilityEffect.hitEffect). casterEffect is not spawned here - it starts
    // with the cast itself (see beginPlayerCast) so it plays in step with the swing rather than
    // lagging behind to the point of impact.
    private resolveEffect(
        caster: Combatant,
        ability: ResolvedAbility,
        target: AbilityTarget,
    ): void {
        const effect = ability.effect;
        const aim = liveAbilityTarget(target, caster.level);
        const delivery = effect.delivery;
        switch (delivery.kind) {
            case DeliveryKind.PROJECTILE:
                this.spawnProjectiles(caster, ability, delivery, aim);
                return;
            case DeliveryKind.CONE:
                this.landCone(caster, effect, delivery, aim);
                return;
            case DeliveryKind.TARGET:
            case DeliveryKind.CIRCLE: {
                const hits = affectedCombatants(
                    caster,
                    delivery,
                    effect.affects,
                    aim,
                    this.combatants(),
                );
                for (const hit of hits) {
                    this.landOnCombatant(hit, effect);
                }
                if (caster instanceof Player && caster.style === WeaponStyle.MAGIC) {
                    caster.refundMana(hits.length * MAGIC_MANA_REFUND_PER_ENEMY);
                }
                return;
            }
        }
    }

    private landOnCombatant(target: Combatant, effect: AbilityEffect): void {
        applyPayloads(target, effect.payloads, this.timeSeconds, this.random, this.events);
        if (!effect.hitEffect || target.health <= 0) {
            return;
        }
        this.spawnVisualEffect(
            effect.hitEffect,
            { kind: "COMBATANT", combatant: target },
            hitEffectHoldSeconds(effect.payloads),
        );
    }

    private landCone(
        caster: Combatant,
        effect: AbilityEffect,
        delivery: ConeDelivery,
        aim: AbilityTarget,
    ): void {
        const hits = affectedCombatants(caster, delivery, effect.affects, aim, this.combatants());
        for (const hit of hits) {
            applyPayloads(hit, effect.payloads, this.timeSeconds, this.random, this.events);
        }
        const hitEffect = effect.hitEffect;
        if (!hitEffect) {
            return;
        }
        // The nearest tiles sit under the caster's own model, so when the budget runs short it's
        // the far end of the cone that keeps its graphics.
        const spawns = coneTileSpawns(caster.x, caster.y, caster.rotation, delivery, this.random);
        const budget =
            GameWorld.MAX_VISUAL_EFFECTS -
            this.visualEffects.length -
            this.pendingVisualEffects.length;
        const farthest = spawns.slice(Math.max(0, spawns.length - budget));
        for (const spawn of farthest) {
            this.pendingVisualEffects.push({
                hitEffect,
                anchor: { kind: "POINT", x: spawn.x, y: spawn.y, level: caster.level, rotation: 0 },
                startsAt: this.timeSeconds + spawn.delaySeconds,
            });
        }
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

    // A free-flight spec fans count shots across the spread around the aim direction, each flying
    // to max range along its own line; any other landing rule is a single shot that tracks the
    // aimed combatant (or flies to the bare aimed point, to expire harmlessly, when there is none)
    // or lands where the aim stands at cast time.
    private spawnProjectiles(
        caster: Combatant,
        ability: ResolvedAbility,
        delivery: ProjectileDelivery,
        aim: AbilityTarget,
    ): void {
        const effect = ability.effect;
        const spec = delivery.spec;
        const impact: ProjectileImpact = {
            caster,
            affects: effect.affects,
            payloads: effect.payloads,
            hitEffect: effect.hitEffect,
            // Ranged's own basic-attack tag: compared against the player's *current* basic attack
            // rather than a fixed ability id, since which weapon tier (and so which ability) is the
            // basic attack now depends on the equipped ranged weapon (see Player.basicAttack).
            playerMechanic:
                caster instanceof Player &&
                caster.style === WeaponStyle.RANGED &&
                ability.id === caster.basicAttack.id
                    ? "RANGED_BASIC"
                    : caster instanceof Player && caster.style === WeaponStyle.MAGIC
                    ? "MAGIC"
                    : undefined,
        };
        const aimPoint = abilityTargetPoint(aim);
        if (spec.landing.kind === "FREE_FLIGHT") {
            const deltaX = aimPoint.x - caster.x;
            const deltaY = aimPoint.y - caster.y;
            if (deltaX === 0 && deltaY === 0) {
                return;
            }
            const directions = generateSpreadDirections(
                directionToRotation(deltaX, deltaY),
                delivery.spreadAngleRadians,
                delivery.count,
            );
            for (const rotation of directions) {
                if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
                    break;
                }
                const direction = rotationToDirection(rotation);
                const start = this.projectileLaunchPoint(caster, direction.x, direction.y);
                const end: ProjectileTarget = {
                    kind: "POINT",
                    x: caster.x + direction.x * spec.range,
                    y: caster.y + direction.y * spec.range,
                };
                this.projectiles.push(
                    new Projectile(spec, impact, start, end, this.projectileTravelSeq(spec)),
                );
            }
            return;
        }
        const start = this.aimedLaunchPoint(caster, spec.landing, aimPoint);
        if (!start) {
            return;
        }
        const target: ProjectileTarget =
            spec.landing.kind === "TRACKED_COMBATANT" && aim.kind === AbilityTargetKind.COMBATANT
                ? { kind: "COMBATANT", combatant: aim.combatant }
                : { kind: "POINT", x: aimPoint.x, y: aimPoint.y };
        if (spec.landing.kind === "FIXED_POINT" && spec.landing.telegraph) {
            const distance = Math.hypot(aimPoint.x - start.x, aimPoint.y - start.y);
            this.spawnVisualEffect(
                spec.landing.telegraph,
                { kind: "POINT", x: aimPoint.x, y: aimPoint.y, level: caster.level, rotation: 0 },
                travelSeconds(spec.travelTime, distance),
            );
        }
        for (let shot = 0; shot < delivery.count; shot++) {
            if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
                return;
            }
            this.projectiles.push(
                new Projectile(spec, impact, start, target, this.projectileTravelSeq(spec)),
            );
        }
    }

    // Where an aimed shot spawns: above its landing point for a rock dropped from the sky, else a
    // launch offset from the caster toward the aim (nowhere, when the aim is the caster's own
    // position).
    private aimedLaunchPoint(
        caster: Combatant,
        landing: ProjectileLanding,
        aimPoint: { x: number; y: number },
    ): FlightOrigin | undefined {
        if (landing.kind === "FIXED_POINT" && landing.origin.kind === "AT_TARGET") {
            return {
                x: aimPoint.x,
                y: aimPoint.y,
                height:
                    this.terrain.getHeight(caster.level, aimPoint.x, aimPoint.y) +
                    landing.origin.height,
            };
        }
        const deltaX = aimPoint.x - caster.x;
        const deltaY = aimPoint.y - caster.y;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance === 0) {
            return undefined;
        }
        return this.projectileLaunchPoint(caster, deltaX / distance, deltaY / distance);
    }

    private projectileLaunchPoint(
        caster: Combatant,
        directionX: number,
        directionY: number,
    ): FlightOrigin {
        const x = caster.x + directionX * GameWorld.PROJECTILE_LAUNCH_OFFSET;
        const y = caster.y + directionY * GameWorld.PROJECTILE_LAUNCH_OFFSET;
        return {
            x,
            y,
            height: this.terrain.getHeight(caster.level, x, y) + caster.projectileLaunchHeight,
        };
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

    private spawnVisualEffect(
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

    private pushVisualEffect(effect: VisualEffect): void {
        const inUse = this.visualEffects.length + this.pendingVisualEffects.length;
        if (inUse >= GameWorld.MAX_VISUAL_EFFECTS) {
            return;
        }
        this.visualEffects.push(effect);
    }
}
