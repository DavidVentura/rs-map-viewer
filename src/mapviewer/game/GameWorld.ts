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
import {
    AnimationPlayback,
    SeqTiming,
    sequenceDurationSeconds,
    sequenceTimeToLastFrameSeconds,
} from "./Animation";
import { CombatEvent, CombatEventKind, applyDamage, applyHeal } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { Affects, HitEffect, applyPayloads, damagePayload, hitEffectHoldSeconds } from "./Effect";
import { affectedCombatants, coneTileSpawns } from "./EffectResolution";
import { Encounter, EncounterScriptKind, EncounterSpawnMode, ScriptedEncounter } from "./Encounter";
import {
    EncounterActor,
    EncounterActorKind,
    EnergySiphonActor,
    createEnergySiphonActor,
    createPhantomActor,
    encounterActorProjectileLaunchHeight,
    playEncounterActorSeq,
    updateEncounterActor,
} from "./EncounterActor";
import { EncounterAnimations } from "./EncounterAnimations";
import { Enemy, EnemyState, computeChaseMovement } from "./Enemy";
import {
    BossPhaseAdds,
    EnemyStatsOverride,
    EnemyTypeId,
    ResolvedEnemyType,
    resolveTriggeredBossPhase,
} from "./EnemyType";
import {
    EnergySiphonImpactKind,
    EnergySiphonImpactResult,
    EnergySiphonState,
    energySiphonRecallStrikes,
    resolveEnergySiphonImpact,
    settleEnergySiphon,
} from "./EnergySiphon";
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
    ENERGY_SIPHON_LAUNCH_FLIGHT,
    ENERGY_SIPHON_LEECH_SPEC,
    ENERGY_SIPHON_RECALL_FLIGHT,
    Projectile,
    ProjectileImpact,
    ProjectileLanding,
    ProjectileOutcome,
    ProjectileSpec,
    ProjectileTarget,
    timedProjectileSpec,
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
    VisualEffectKind,
    casterEffectAnchor,
    casterEffectTiming,
} from "./VisualEffect";
import { WardenP3Animations } from "./WardenP3Animations";
import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    destroyFurthestWardenP3ArenaRow,
    wardenP3ArenaTerrain,
    wardenP3DestroyedRowDistances,
    wardenP3RowTiles,
} from "./WardenP3Arena";
import {
    ParsedWardenP3Arena,
    ParsedWardenP3Timing,
    PhantomAttackRelease,
    WARDEN_P3_HAZARD_TIMING,
    WardenP3Arena,
    WardenP3Command,
    WardenP3Intermission,
    WardenP3Phase,
    WardenP3State,
    WardenP3Tile,
    WardenPhantom,
    WardenSiphonStatus,
    WardenSlamTarget,
    initialWardenP3State,
    parseWardenP3Arena,
    parseWardenP3Timing,
    stepWardenP3,
} from "./WardenP3Director";
import {
    FloorSlam,
    floorSlamEndsAtSeconds,
    floorSlamTilesArriving,
    wardenP3SlamShockwave,
} from "./WardenP3FloorSlam";
import {
    BABA_PHANTOM_ROCK_FALL,
    WARDEN_P3_PHANTOM_DAMAGE,
    ZEBAK_PHANTOM_SHOTS,
    ZebakPhantomShot,
    babaPhantomRockTargets,
    wardenPhantomEnemyTypeId,
} from "./WardenP3Phantoms";
import { WardenP3SiphonLayout, validateWardenP3SiphonLayout } from "./WardenP3SiphonLayout";
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

export type WardenP3RenderState = {
    readonly commands: readonly WardenP3Command[];
    readonly aimedSlamTarget: WardenSlamTarget | undefined;
    readonly resolvedSlamTarget: WardenSlamTarget | undefined;
    readonly activeIntermission: WardenP3Intermission | undefined;
    readonly activePhantoms: readonly WardenPhantom[];
    readonly lightningWarningTarget: WardenP3Tile | undefined;
    readonly lightningTarget: WardenP3Tile | undefined;
    readonly removedArenaRows: readonly number[];
    readonly floorSlams: readonly FloorSlam[];
};

type PendingRockFall = {
    readonly tile: WardenP3Tile;
    readonly landsAtSeconds: number;
};

// Opened when the Warden throws its siphons. The deadline counts from their landing, so the time
// they spend in flight, where they cannot be struck, never eats into the player's window.
type SiphonWindow = {
    readonly deadlineAtSeconds: number;
    readonly nextLeechAtSeconds: number;
};

type PendingSiphonStrike = {
    readonly arrivesAtSeconds: number;
    readonly damage: number;
};

type WardenP3Runtime = {
    readonly wardenId: number;
    readonly arena: ParsedWardenP3Arena;
    readonly siphonLayout: WardenP3SiphonLayout;
    readonly animations: WardenP3Animations;
    readonly timing: ParsedWardenP3Timing;
    state: WardenP3State;
    siphonStatus: WardenSiphonStatus;
    siphonWindow: SiphonWindow | undefined;
    siphonStrikes: readonly PendingSiphonStrike[];
    commands: readonly WardenP3Command[];
    aimedSlamTarget: WardenSlamTarget | undefined;
    resolvedSlamTarget: WardenSlamTarget | undefined;
    activePhantoms: readonly WardenPhantom[];
    lightningWarningTarget: WardenP3Tile | undefined;
    lightningTarget: WardenP3Tile | undefined;
    floor: WardenP3ArenaFloor;
    // Slams whose front is still travelling or whose last tiles are still settling.
    floorSlams: readonly FloorSlam[];
    // Arrivals up to this time have already hit, so each tile's arrival is resolved exactly once
    // even when it lands on a step boundary.
    floorSlamsResolvedUntilSeconds: number;
    rockFalls: readonly PendingRockFall[];
};

export class GameWorld {
    static readonly FIXED_STEP_SECONDS = 1 / 120;
    static readonly MAX_ACCUMULATED_SECONDS = 0.1;
    static readonly MAX_PROJECTILES = 32;
    static readonly PROJECTILE_LAUNCH_OFFSET = 48;
    static readonly MAX_VISUAL_EFFECTS = 64;
    static readonly ENEMY_RESPAWN_SECONDS = 5;
    // How long a corpse stays after its death animation reaches its final pose, so long death
    // animations (Jad) play out in full while short ones get swept up quickly.
    static readonly CORPSE_LINGER_SECONDS = 1;
    static readonly ENEMY_GRID_CELL_SIZE = 256;
    static readonly ENEMY_NEIGHBOUR_QUERY_RADIUS = 256;
    // How close the player must walk to a ground item to pick it up; also the chase's stop
    // distance, so the player always ends up in pickup range rather than short of it.
    static readonly PICKUP_RADIUS = 0.5 * TILE_SIZE;

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
    private events: CombatEvent[] = [];

    private accumulatedSeconds = 0;
    // Shared with encounterActors so ids stay unique across both (hover picking looks an id up in
    // either list without needing to know which kind it belongs to).
    private nextActorId = 1;
    private nextGroundItemId = 1;

    private encounter?: Encounter;
    phaseLifecycle?: PhaseLifecycle;
    interactionState: InteractionState = IDLE_INTERACTION;
    private waveDirectorState: WaveDirectorState = initialWaveDirectorState(0);
    private wardenP3Runtime?: WardenP3Runtime;
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
        private readonly baseTerrain: Terrain,
        private readonly animations: EncounterAnimations,
        private readonly random: RandomSource = Math.random,
    ) {}

    // Wardens P3 destroys arena floor rows at runtime; composing that over the base terrain here
    // means every movement path that consults Terrain (pathing, chase steering, click-to-walk, the
    // player's own movement) rejects destroyed rows without each caller knowing about the fight.
    private get terrain(): Terrain {
        const runtime = this.wardenP3Runtime;
        return runtime ? wardenP3ArenaTerrain(this.baseTerrain, runtime.floor) : this.baseTerrain;
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
        this.wardenP3Runtime = undefined;
        switch (encounter.spawnMode) {
            case EncounterSpawnMode.STATIC_RESPAWN:
                this.spawnStaticEncounterEnemies(encounter);
                return;
            case EncounterSpawnMode.SCRIPTED:
                this.startScriptedEncounter(encounter);
                return;
            case EncounterSpawnMode.WAVES:
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
        this.phaseLifecycle = undefined;
        this.interactionState = IDLE_INTERACTION;
        this.activatedPhaseRewards = undefined;
        this.pendingUpgradeOffer = undefined;
        this.pendingPhaseRewards = [];
        this.enemyWaveIndex.clear();
        this.triggeredBossPhases.clear();
        this.killsByWave = [];
        this.waveDirectorState = initialWaveDirectorState(0);
        this.wardenP3Runtime = undefined;
    }

    get wardenP3RenderState(): WardenP3RenderState | undefined {
        const runtime = this.wardenP3Runtime;
        if (!runtime) {
            return undefined;
        }
        return {
            commands: runtime.commands,
            aimedSlamTarget: runtime.aimedSlamTarget,
            resolvedSlamTarget: runtime.resolvedSlamTarget,
            activeIntermission:
                runtime.state.phase === WardenP3Phase.SIPHONS
                    ? runtime.state.intermission
                    : undefined,
            activePhantoms: runtime.activePhantoms,
            lightningWarningTarget: runtime.lightningWarningTarget,
            lightningTarget: runtime.lightningTarget,
            removedArenaRows: wardenP3DestroyedRowDistances(runtime.floor),
            floorSlams: runtime.floorSlams,
        };
    }

    startWardenP3Runtime(
        wardenId: number,
        arena: WardenP3Arena,
        siphonLayout: WardenP3SiphonLayout,
    ): void {
        const warden = this.findEnemy(wardenId);
        if (!warden) {
            throw new Error(`Cannot start Wardens P3 without Warden enemy ${wardenId}`);
        }
        validateWardenP3SiphonLayout(siphonLayout);
        const parsedArena = parseWardenP3Arena(arena);
        const animations = this.animations.wardenP3();
        const timing = parseWardenP3Timing({
            ...WARDEN_P3_HAZARD_TIMING,
            slams: animations.slams,
            stances: animations.stances,
            phantomAttacks: animations.phantoms.attacks,
            siphonLaunchSeconds: animations.siphons.launchSeconds,
        });
        warden.invulnerable = false;
        this.wardenP3Runtime = {
            wardenId,
            arena: parsedArena,
            siphonLayout,
            animations,
            timing,
            state: initialWardenP3State(this.timeSeconds, parsedArena),
            siphonStatus: WardenSiphonStatus.NONE,
            siphonWindow: undefined,
            siphonStrikes: [],
            commands: [],
            aimedSlamTarget: undefined,
            resolvedSlamTarget: undefined,
            activePhantoms: [],
            lightningWarningTarget: undefined,
            lightningTarget: undefined,
            floor: WARDEN_P3_INITIAL_ARENA_FLOOR,
            floorSlams: [],
            floorSlamsResolvedUntilSeconds: this.timeSeconds,
            rockFalls: [],
        };
    }

    resolveWardenP3Siphons(status: Exclude<WardenSiphonStatus, WardenSiphonStatus.NONE>): void {
        const runtime = this.wardenP3Runtime;
        if (!runtime || runtime.state.phase !== WardenP3Phase.SIPHONS) {
            throw new Error("Cannot resolve Wardens siphons outside a siphon intermission");
        }
        runtime.siphonStatus = status;
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

    private startScriptedEncounter(encounter: ScriptedEncounter): void {
        switch (encounter.script.kind) {
            case EncounterScriptKind.WARDENS_P3: {
                const { wardenSpawn, phantomSpawns, arena, siphonLayout } = encounter.script;
                const wardenId = this.spawnEnemyAtExactPosition(
                    wardenSpawn.x,
                    wardenSpawn.y,
                    wardenSpawn.level,
                    this.animations.enemyType(EnemyTypeId.TUMEKENS_WARDEN),
                );
                for (const phantomSpawn of phantomSpawns) {
                    this.spawnWardenPhantomObserver(
                        phantomSpawn.x,
                        phantomSpawn.y,
                        wardenPhantomEnemyTypeId(phantomSpawn.phantom),
                    );
                }
                const platformFacing = directionToRotation(0, 1);
                this.findEnemy(wardenId)!.rotation = platformFacing;
                for (const actor of this.encounterActors) {
                    if (actor.kind === EncounterActorKind.PHANTOM) {
                        actor.rotation = platformFacing;
                    }
                }
                this.startWardenP3Runtime(wardenId, arena, siphonLayout);
                return;
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
        const id = this.nextActorId++;
        this.enemies.push(
            new Enemy(id, spawn.x, spawn.y, level, spawn.x, spawn.y, enemyType, statsOverride),
        );
        return id;
    }

    private spawnEnemyAtExactPosition(
        x: number,
        y: number,
        level: number,
        enemyType: ResolvedEnemyType,
    ): number {
        const id = this.nextActorId++;
        this.enemies.push(new Enemy(id, x, y, level, x, y, enemyType));
        return id;
    }

    private spawnWardenPhantomObserver(tileX: number, tileY: number, typeId: EnemyTypeId): void {
        this.encounterActors.push(
            createPhantomActor(
                this.nextActorId++,
                (tileX + 2.5) * TILE_SIZE,
                (tileY + 2.5) * TILE_SIZE,
                0,
                this.animations.enemyType(typeId),
                0,
            ),
        );
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
        for (const actor of this.encounterActors) {
            updateEncounterActor(actor, dtSeconds);
        }
        this.advanceWardenP3Runtime();
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
        this.resolveEnergySiphonBasicAttack(player, input);
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

    private advanceWardenP3Runtime(): void {
        const runtime = this.wardenP3Runtime;
        const player = this.player;
        if (!runtime || !player) {
            return;
        }
        const warden = this.findEnemy(runtime.wardenId);
        if (!warden) {
            throw new Error(`Wardens P3 lost Warden enemy ${runtime.wardenId}`);
        }
        this.advanceEnergySiphons(runtime, warden);
        const result = stepWardenP3(
            runtime.state,
            {
                timeSeconds: this.timeSeconds,
                wardenHealth: { current: warden.health, maximum: warden.maxHealth },
                playerTile: {
                    x: Math.floor(player.x / TILE_SIZE),
                    y: Math.floor(player.y / TILE_SIZE),
                    level: player.level,
                },
                siphonStatus: this.wardenP3SiphonStatus(runtime),
            },
            runtime.arena,
            runtime.timing,
        );
        runtime.state = result.nextState;
        runtime.commands = result.commands;
        runtime.siphonStatus = WardenSiphonStatus.NONE;
        for (const command of result.commands) {
            this.dispatchWardenP3Command(runtime, warden, player, command);
        }
        this.resolveWardenFloorSlamArrivals(runtime);
        this.resolveBabaRockFalls(runtime);
        this.resolveEnergySiphonStrikes(runtime, warden);
    }

    private energySiphonActors(): EnergySiphonActor[] {
        return this.encounterActors.filter(
            (actor): actor is EnergySiphonActor => actor.kind === EncounterActorKind.ENERGY_SIPHON,
        );
    }

    // A landing siphon's idle restarts so every leech pulse after it falls on the idle's leech frame.
    private advanceEnergySiphons(runtime: WardenP3Runtime, warden: Enemy): void {
        for (const siphon of this.energySiphonActors()) {
            if (siphon.siphon.state !== EnergySiphonState.IN_FLIGHT) {
                continue;
            }
            const settled = settleEnergySiphon(siphon.siphon, this.timeSeconds);
            if (settled.state === EnergySiphonState.IN_FLIGHT) {
                continue;
            }
            siphon.siphon = settled;
            siphon.animation.restart(siphon.type.seqs.idle);
        }
        const window = runtime.siphonWindow;
        if (!window || this.timeSeconds < window.nextLeechAtSeconds) {
            return;
        }
        runtime.siphonWindow = {
            ...window,
            nextLeechAtSeconds:
                window.nextLeechAtSeconds + runtime.animations.siphons.leech.intervalSeconds,
        };
        for (const siphon of this.energySiphonActors()) {
            if (siphon.siphon.state !== EnergySiphonState.HOSTILE) {
                continue;
            }
            this.launchSiphonFlight(
                warden,
                ENERGY_SIPHON_LEECH_SPEC,
                this.siphonLaunchPoint(siphon),
                {
                    kind: "COMBATANT",
                    combatant: warden,
                },
            );
        }
    }

    private resolveEnergySiphonStrikes(runtime: WardenP3Runtime, warden: Enemy): void {
        const arrived = runtime.siphonStrikes.filter(
            (strike) => this.timeSeconds >= strike.arrivesAtSeconds,
        );
        for (const strike of arrived) {
            applyDamage(warden, strike.damage, this.events);
        }
        runtime.siphonStrikes = runtime.siphonStrikes.filter(
            (strike) => this.timeSeconds < strike.arrivesAtSeconds,
        );
    }

    // The siphons leave the Warden's chest together and land together, each as its tile's shadow
    // reaches the landing frame.
    private throwEnergySiphons(runtime: WardenP3Runtime, warden: Enemy): void {
        const { siphons } = runtime.animations;
        const landsAtSeconds = this.timeSeconds + siphons.flightSeconds;
        runtime.siphonWindow = {
            deadlineAtSeconds: landsAtSeconds + runtime.siphonLayout.deadlineSeconds,
            nextLeechAtSeconds: landsAtSeconds + siphons.leech.firstSeconds,
        };
        const siphonType = this.animations.enemyType(EnemyTypeId.ENERGY_SIPHON);
        const launch = timedProjectileSpec(ENERGY_SIPHON_LAUNCH_FLIGHT, siphons.flightSeconds);
        const chest: FlightOrigin = {
            x: warden.x,
            y: warden.y,
            height:
                this.terrain.getHeight(warden.level, warden.x, warden.y) +
                warden.projectileLaunchHeight,
        };
        for (const spawn of runtime.siphonLayout.spawns) {
            const siphon = createEnergySiphonActor(
                this.nextActorId++,
                (spawn.x + 0.5) * TILE_SIZE,
                (spawn.y + 0.5) * TILE_SIZE,
                spawn.level,
                siphonType,
                spawn.rotation,
                { state: EnergySiphonState.IN_FLIGHT, landsAtSeconds },
            );
            this.spawnWardenTileEffect(siphons.landingShadow, spawn, landsAtSeconds);
            this.launchSiphonFlight(warden, launch, chest, {
                kind: "POINT",
                x: siphon.x,
                y: siphon.y,
            });
            this.encounterActors.push(siphon);
        }
    }

    // Every siphon flies back into the Warden during its release, whether or not it was reversed;
    // only the reversed ones strike it as they arrive.
    private recallEnergySiphons(
        runtime: WardenP3Runtime,
        warden: Enemy,
        reversalDamage: number,
    ): void {
        const { recallSeconds } = runtime.animations.siphons;
        const arrivesAtSeconds = this.timeSeconds + recallSeconds;
        const recall = timedProjectileSpec(ENERGY_SIPHON_RECALL_FLIGHT, recallSeconds);
        const siphons = this.energySiphonActors();
        for (const siphon of siphons) {
            this.launchSiphonFlight(warden, recall, this.siphonLaunchPoint(siphon), {
                kind: "COMBATANT",
                combatant: warden,
            });
        }
        const strikes = energySiphonRecallStrikes(
            siphons.map((siphon) => siphon.siphon),
            reversalDamage,
        );
        runtime.siphonStrikes = [
            ...runtime.siphonStrikes,
            ...strikes.map((damage) => ({ arrivesAtSeconds, damage })),
        ];
        runtime.siphonWindow = undefined;
        this.encounterActors = this.encounterActors.filter(
            (actor) => actor.kind !== EncounterActorKind.ENERGY_SIPHON,
        );
    }

    private siphonLaunchPoint(siphon: EnergySiphonActor): FlightOrigin {
        return {
            x: siphon.x,
            y: siphon.y,
            height:
                this.terrain.getHeight(siphon.level, siphon.x, siphon.y) +
                encounterActorProjectileLaunchHeight(siphon),
        };
    }

    // A siphon flight only pictures where the energy goes: landing, leeching, the deadline and the
    // strikes all run on the runtime's own timers, so a flight dropped at the projectile cap costs
    // nothing but the picture.
    private launchSiphonFlight(
        warden: Enemy,
        spec: ProjectileSpec,
        start: FlightOrigin,
        target: ProjectileTarget,
    ): void {
        if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
            return;
        }
        this.projectiles.push(
            new Projectile(
                spec,
                { caster: warden, affects: Affects.SELF, payloads: [] },
                start,
                target,
                this.projectileTravelSeq(spec),
            ),
        );
    }

    // A tile hurts the player only as the front reaches it, so stepping onto tiles the front has
    // already passed is safe.
    private resolveWardenFloorSlamArrivals(runtime: WardenP3Runtime): void {
        for (const slam of runtime.floorSlams) {
            const arriving = floorSlamTilesArriving(
                slam,
                runtime.floorSlamsResolvedUntilSeconds,
                this.timeSeconds,
            );
            for (const tile of arriving) {
                this.damagePlayerOnWardenTile(tile, 30);
            }
        }
        runtime.floorSlamsResolvedUntilSeconds = this.timeSeconds;
        runtime.floorSlams = runtime.floorSlams.filter(
            (slam) => this.timeSeconds < floorSlamEndsAtSeconds(slam),
        );
    }

    private resolveBabaRockFalls(runtime: WardenP3Runtime): void {
        const landed = runtime.rockFalls.filter((rock) => this.timeSeconds >= rock.landsAtSeconds);
        for (const rock of landed) {
            this.damagePlayerOnWardenTile(rock.tile, WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.BABA]);
        }
        runtime.rockFalls = runtime.rockFalls.filter(
            (rock) => this.timeSeconds < rock.landsAtSeconds,
        );
    }

    private wardenP3SiphonStatus(runtime: WardenP3Runtime): WardenSiphonStatus {
        if (runtime.siphonStatus !== WardenSiphonStatus.NONE) {
            return runtime.siphonStatus;
        }
        if (
            runtime.siphonWindow !== undefined &&
            this.timeSeconds >= runtime.siphonWindow.deadlineAtSeconds
        ) {
            return WardenSiphonStatus.DEADLINE_EXPIRED;
        }
        return WardenSiphonStatus.NONE;
    }

    private dispatchWardenP3Command(
        runtime: WardenP3Runtime,
        warden: Enemy,
        player: Player,
        command: WardenP3Command,
    ): void {
        switch (command.kind) {
            case "BEGIN_SLAM":
                runtime.aimedSlamTarget = command.target;
                warden.playScriptedSeq(runtime.animations.slams[command.tempo][command.target].seq);
                return;
            case "RESOLVE_FLOOR_SLAM":
                runtime.resolvedSlamTarget = command.target;
                runtime.floorSlams = [
                    ...runtime.floorSlams,
                    {
                        shockwave: wardenP3SlamShockwave(command.target),
                        startsAtSeconds: this.timeSeconds,
                    },
                ];
                return;
            case "CHANGE_WARDEN_STANCE": {
                const stance = runtime.animations.stances[command.stance];
                warden.playScriptedSeq(stance.transition);
                warden.holdScriptedIdle(stance.hold);
                return;
            }
            case "SET_WARDEN_VULNERABILITY":
                warden.invulnerable = !command.vulnerable;
                return;
            case "SPAWN_ENERGY_SIPHONS":
                this.throwEnergySiphons(runtime, warden);
                return;
            case "RESOLVE_ENERGY_SIPHONS":
                this.recallEnergySiphons(runtime, warden, command.reversalDamage);
                return;
            case "ACTIVATE_PHANTOM":
                runtime.activePhantoms = [...runtime.activePhantoms, command.phantom];
                return;
            case "BEGIN_PHANTOM_ATTACK": {
                const phantom = this.wardenPhantomActor(command.phantom);
                phantom.rotation = directionToRotation(player.x - phantom.x, player.y - phantom.y);
                playEncounterActorSeq(
                    phantom,
                    runtime.animations.phantoms.attacks[command.phantom].seq,
                );
                return;
            }
            case "RELEASE_PHANTOM_ATTACK":
                this.releasePhantomAttack(runtime, warden, player, command.release);
                return;
            case "ENTER_ENRAGE":
                applyHeal(warden, command.healAmount, this.events);
                return;
            case "WARN_LIGHTNING":
                runtime.lightningWarningTarget = command.target;
                this.spawnWardenTileEffect(
                    VisualEffectKind.WARDENS_LIGHTNING_WARNING,
                    command.target,
                );
                return;
            case "STRIKE_LIGHTNING":
                runtime.lightningWarningTarget = undefined;
                runtime.lightningTarget = command.target;
                this.spawnWardenTileEffect(VisualEffectKind.WARDENS_LIGHTNING, command.target);
                this.damagePlayerOnWardenTile(command.target, 20);
                return;
            case "REMOVE_ARENA_ROW": {
                const destroyed = destroyFurthestWardenP3ArenaRow(runtime.floor);
                if (!destroyed || destroyed.row.distanceFromWarden !== command.distanceFromWarden) {
                    throw new Error(
                        `Wardens P3 director requested row ${command.distanceFromWarden} but the furthest remaining row is ${destroyed?.row.distanceFromWarden}`,
                    );
                }
                runtime.floor = destroyed.floor;
                for (const tile of wardenP3RowTiles(destroyed.row)) {
                    this.spawnWardenTileEffect(VisualEffectKind.WARDENS_FALLING_TILE, tile);
                    this.damagePlayerOnWardenTile(tile, 1000);
                }
                return;
            }
            case "COMPLETE_ENCOUNTER":
                this.events.push({ kind: CombatEventKind.ENCOUNTER_CLEARED });
                return;
        }
    }

    private wardenPhantomActor(phantom: WardenPhantom): EncounterActor {
        const typeId = wardenPhantomEnemyTypeId(phantom);
        const actor = this.encounterActors.find(
            (candidate) =>
                candidate.kind === EncounterActorKind.PHANTOM && candidate.type.id === typeId,
        );
        if (!actor) {
            throw new Error(`Wardens P3 has no ${phantom} phantom to attack with`);
        }
        return actor;
    }

    private releasePhantomAttack(
        runtime: WardenP3Runtime,
        warden: Enemy,
        player: Player,
        release: PhantomAttackRelease,
    ): void {
        switch (release.phantom) {
            case WardenPhantom.ZEBAK:
                this.throwZebakPhantomShot(warden, player, ZEBAK_PHANTOM_SHOTS[release.style]);
                return;
            case WardenPhantom.BABA:
                this.dropBabaPhantomRocks(runtime, player);
                return;
        }
    }

    // The phantoms are the Warden's own attacks in another boss's shape, so the Warden is the shot's
    // caster (its faction and level) and the phantom only lends the launch point.
    private throwZebakPhantomShot(warden: Enemy, player: Player, shot: ZebakPhantomShot): void {
        if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
            return;
        }
        const phantom = this.wardenPhantomActor(WardenPhantom.ZEBAK);
        const start: FlightOrigin = {
            x: phantom.x,
            y: phantom.y,
            height:
                this.terrain.getHeight(phantom.level, phantom.x, phantom.y) +
                encounterActorProjectileLaunchHeight(phantom),
        };
        const impact: ProjectileImpact = {
            caster: warden,
            affects: Affects.HOSTILE,
            payloads: [damagePayload(WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.ZEBAK])],
            hitEffect: shot.hitEffect,
        };
        this.projectiles.push(
            new Projectile(
                shot.spec,
                impact,
                start,
                { kind: "POINT", x: player.x, y: player.y },
                this.projectileTravelSeq(shot.spec),
            ),
        );
    }

    // Each rock's graphic plays its whole fall from the moment it drops, so its shadow is held until
    // the graphic's landing frame, where the rock hits.
    private dropBabaPhantomRocks(runtime: WardenP3Runtime, player: Player): void {
        const { rockFall } = runtime.animations.phantoms;
        const targets = babaPhantomRockTargets(
            runtime.floor,
            {
                x: Math.floor(player.x / TILE_SIZE),
                y: Math.floor(player.y / TILE_SIZE),
                level: player.level,
            },
            BABA_PHANTOM_ROCK_FALL.extraRockCount,
            this.random,
        );
        const landsAtSeconds = this.timeSeconds + rockFall.landingSeconds;
        for (const tile of targets) {
            this.spawnWardenTileEffect(BABA_PHANTOM_ROCK_FALL.shadow.kind, tile, landsAtSeconds);
            this.spawnWardenTileEffect(rockFall.effect, tile);
        }
        runtime.rockFalls = [
            ...runtime.rockFalls,
            ...targets.map((tile) => ({ tile, landsAtSeconds })),
        ];
    }

    private damagePlayerOnWardenTile(tile: WardenP3Tile, damage: number): void {
        const player = this.player;
        if (
            player &&
            player.level === tile.level &&
            Math.floor(player.x / TILE_SIZE) === tile.x &&
            Math.floor(player.y / TILE_SIZE) === tile.y
        ) {
            applyDamage(player, damage, this.events);
        }
    }

    private spawnWardenTileEffect(
        kind: VisualEffectKind,
        tile: WardenP3Tile,
        holdUntilSeconds?: number,
    ): void {
        this.visualEffects.push(
            new VisualEffect(
                kind,
                {
                    kind: "POINT",
                    x: (tile.x + 0.5) * TILE_SIZE,
                    y: (tile.y + 0.5) * TILE_SIZE,
                    level: tile.level,
                    rotation: 0,
                },
                0,
                this.animations.effects[kind],
                holdUntilSeconds,
            ),
        );
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
        this.encounterActors = [];
        this.projectiles = [];
        this.visualEffects = [];
        this.pendingVisualEffects = [];
        this.wardenP3Runtime = undefined;

        const encounter = this.encounter;
        if (!encounter || encounter.spawnMode === EncounterSpawnMode.STATIC_RESPAWN) {
            for (const enemy of this.enemies) {
                enemy.respawn();
                this.events.push({ kind: CombatEventKind.ENEMY_RESPAWNED, target: enemy });
            }
            return;
        }
        if (encounter.spawnMode === EncounterSpawnMode.SCRIPTED) {
            this.enemies = [];
            this.encounterActors = [];
            this.enemyWaveIndex.clear();
            this.triggeredBossPhases.clear();
            this.killsByWave = [];
            this.waveDirectorState = initialWaveDirectorState(0);
            this.startScriptedEncounter(encounter);
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
            this.computeEnergySiphonChaseInput(player, input) ??
            this.computeMeleeChaseInput(player, input) ??
            this.computePickupChaseInput(player, input) ??
            input.movement
        );
    }

    private computeEnergySiphonChaseInput(
        player: Player,
        input: SimInput,
    ): PlayerInput | undefined {
        if (player.style !== WeaponStyle.MELEE) {
            return undefined;
        }
        const basicAttack = input.combat.basicAttack;
        if (!basicAttack.held || basicAttack.target?.kind !== AbilityTargetKind.ENERGY_SIPHON) {
            return undefined;
        }
        const siphon = this.findEnergySiphon(basicAttack.target.siphon.id);
        if (!siphon) {
            return undefined;
        }
        const reach = this.energySiphonInteractionReach(player);
        const deltaX = siphon.x - player.x;
        const deltaY = siphon.y - player.y;
        const distance = Math.hypot(deltaX, deltaY);
        const movement = computeChaseMovement(deltaX, deltaY, distance, reach);
        if (movement.x === 0 && movement.y === 0) {
            return undefined;
        }
        return { x: movement.x, y: movement.y, running: input.movement.running };
    }

    private resolveEnergySiphonBasicAttack(player: Player, input: SimInput): void {
        const basicAttack = input.combat.basicAttack;
        if (
            player.style !== WeaponStyle.MELEE ||
            !basicAttack.held ||
            basicAttack.target?.kind !== AbilityTargetKind.ENERGY_SIPHON
        ) {
            return;
        }
        const siphon = this.findEnergySiphon(basicAttack.target.siphon.id);
        if (!siphon) {
            return;
        }
        const distance = Math.hypot(siphon.x - player.x, siphon.y - player.y);
        if (distance > this.energySiphonInteractionReach(player)) {
            return;
        }
        const impact = resolveEnergySiphonImpact(siphon.siphon, {
            kind: EnergySiphonImpactKind.PLAYER_BASIC_ATTACK,
            style: player.style,
        });
        if (impact.result !== EnergySiphonImpactResult.REVERSED) {
            return;
        }
        const deltaX = siphon.x - player.x;
        const deltaY = siphon.y - player.y;
        if (deltaX !== 0 || deltaY !== 0) {
            player.rotation = directionToRotation(deltaX, deltaY);
        }
        siphon.siphon = impact.siphon;
        siphon.rotation = siphon.reversedRotation;
        const siphons = this.energySiphonActors();
        if (siphons.every((candidate) => candidate.siphon.state === EnergySiphonState.REVERSED)) {
            const runtime = this.wardenP3Runtime;
            if (!runtime || runtime.state.phase !== WardenP3Phase.SIPHONS) {
                throw new Error("Reversed Wardens siphons outside a siphon intermission");
            }
            runtime.siphonStatus = WardenSiphonStatus.ALL_REVERSED;
        }
    }

    private energySiphonInteractionReach(player: Player): number {
        const reach = trackedDeliveryReach(player.basicAttack.effect.delivery);
        if (reach === undefined) {
            throw new Error("Melee basic attack must have a tracked reach");
        }
        return reach + player.hitRadius;
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
        if (abilityInput.target.kind === AbilityTargetKind.ENERGY_SIPHON) {
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
        if (abilityInput.target.kind === AbilityTargetKind.ENERGY_SIPHON) {
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
        if (target.kind === AbilityTargetKind.ENERGY_SIPHON) {
            return false;
        }
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
