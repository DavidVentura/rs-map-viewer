import { AnimationPlayback, sequenceDurationSeconds } from "./Animation";
import { CombatEventKind } from "./CombatEvent";
import { WaveEncounter } from "./Encounter";
import { Enemy, EnemyState } from "./Enemy";
import { EquipmentChange } from "./Equipment";
import { planGrantDrops } from "./GroundItem";
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
import { Player, PlayerMovementKind } from "./Player";
import { SimInput } from "./PlayerOrders";
import { createExperience } from "./Progression";
import { Reward } from "./Reward";
import {
    WaveDirectorState,
    WaveSpawn,
    initialWaveDirectorState,
    pickFarthestSpawnPoint,
    stepWaveDirector,
} from "./WaveDirector";
import { WorldContext } from "./WorldContext";
import { resolveScatterPosition } from "./spawn";
import { UPGRADE_POOL, Upgrade } from "./upgrades";

export type WaveProgress = {
    readonly index: number;
    readonly total: number;
    readonly cleared: boolean;
    readonly awaitingUpgrade: boolean;
};

export type PhaseProgress = {
    readonly index: number;
    readonly total: number;
    readonly label: string;
    readonly state: PhaseLifecycle["kind"];
};

export class WaveEncounterRuntime {
    phaseLifecycle: PhaseLifecycle;
    interactionState: InteractionState = IDLE_INTERACTION;
    private activatedPhaseRewards?: WorldAction;
    pendingUpgradeOffer?: readonly Upgrade[];
    private pendingPhaseRewards: readonly Reward[] = [];
    private waveDirectorState: WaveDirectorState = initialWaveDirectorState(0);
    private readonly enemyWaveIndex = new Map<number, number>();
    private killsByWave: number[] = [];

    constructor(
        private readonly world: WorldContext,
        private readonly encounter: WaveEncounter,
    ) {
        this.phaseLifecycle = initialPhaseLifecycle(encounter.phases);
    }

    getWaveProgress(): WaveProgress {
        const phase = currentPhase(this.phaseLifecycle);
        return {
            index: Math.min(this.waveDirectorState.nextWaveIndex, phase.waves.length),
            total: phase.waves.length,
            cleared: this.waveDirectorState.cleared,
            awaitingUpgrade: false,
        };
    }

    getPhaseProgress(): PhaseProgress {
        const lifecycle = this.phaseLifecycle;
        return {
            index: lifecycle.phaseIndex + 1,
            total: lifecycle.phases.length,
            label: currentPhase(lifecycle).label,
            state: lifecycle.kind,
        };
    }

    get activeInteractions(): readonly Interaction[] {
        const lifecycle = this.phaseLifecycle;
        const phase = currentPhase(lifecycle);
        return this.encounter.interactions.filter((interaction) => {
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
        const activeInteractions = this.activeInteractions;
        const rewardsBeingClaimed = this.activatedPhaseRewards !== undefined;
        return this.encounter.worldObjects.map((object) => ({
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

    updateInteraction(player: Player, input: SimInput, dtSeconds: number): boolean {
        this.cancelInteractionForPlayerAction(input);
        this.startInteraction(input.startInteraction);
        return this.advanceInteraction(player, input.running, dtSeconds);
    }

    // A fresh player order (see GameWorld.issuePlayerOrders) walks the player away from the lever or
    // chest it was operating.
    interruptInteraction(): void {
        if (this.interactionState.kind === "IDLE") {
            return;
        }
        this.interactionState = cancelInteraction(this.interactionState);
    }

    applyUpgradeChoice(choiceIndex: number | undefined): void {
        const player = this.world.player;
        if (choiceIndex === undefined || !this.pendingUpgradeOffer || !player) {
            return;
        }
        const upgrade = this.pendingUpgradeOffer[choiceIndex];
        if (!upgrade) {
            throw new RangeError(`No upgrade choice at index ${choiceIndex}`);
        }
        player.applyUpgrade(upgrade);
        this.pendingUpgradeOffer = undefined;
        this.activateNextPhaseReward();
    }

    recordEnemyDeath(enemy: Enemy): void {
        const waveIndex = this.enemyWaveIndex.get(enemy.id);
        if (waveIndex === undefined) {
            return;
        }
        this.killsByWave[waveIndex] += 1;
    }

    step(): void {
        const lifecycle = this.phaseLifecycle;
        const player = this.world.player;
        if (lifecycle.kind !== "ACTIVE" || !player) {
            return;
        }
        const phase = currentPhase(lifecycle);
        const aliveByWave = this.aliveCountsByWave(phase.waves.length);
        const wasCleared = this.waveDirectorState.cleared;
        const result = stepWaveDirector(
            this.waveDirectorState,
            phase.waves,
            this.world.timeSeconds,
            aliveByWave,
            this.killsByWave,
        );
        this.waveDirectorState = result.nextState;
        for (const spawn of result.spawns) {
            this.spawnWaveEnemy(player, spawn);
        }
        if (!wasCleared && result.nextState.cleared) {
            this.phaseLifecycle = transitionPhase(lifecycle, { kind: "PHASE_CLEARED" });
            if (this.phaseLifecycle.kind === "COMPLETE") {
                this.world.events.push({ kind: CombatEventKind.ENCOUNTER_CLEARED });
            }
        }
    }

    private findWorldObject(objectId: WorldObjectId): WorldObject {
        const object = this.encounter.worldObjects.find((candidate) => candidate.id === objectId);
        if (!object) {
            throw new Error(`Encounter does not declare world object ${objectId}`);
        }
        return object;
    }

    private findWorldObjectByKind(kind: WorldObjectKind): WorldObject {
        const object = this.encounter.worldObjects.find((candidate) => candidate.kind === kind);
        if (!object) {
            throw new Error(`Encounter does not declare a ${kind} world object`);
        }
        return object;
    }

    private cancelInteractionForPlayerAction(input: SimInput): void {
        if (this.interactionState.kind === "IDLE" || input.startInteraction !== undefined) {
            return;
        }
        const castingSkill = input.skills.some((skill) => skill.held);
        if (!castingSkill && input.styleSwitch === undefined) {
            return;
        }
        this.interactionState = cancelInteraction(this.interactionState);
    }

    private startInteraction(interactionId: InteractionId | undefined): void {
        if (interactionId === undefined || this.interactionState.kind !== "IDLE") {
            return;
        }
        const interaction = this.activeInteractions.find(
            (candidate) => candidate.id === interactionId,
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

    private advanceInteraction(player: Player, running: boolean, dtSeconds: number): boolean {
        const world = this.world;
        const state = this.interactionState;
        if (state.kind === "IDLE") {
            return false;
        }
        if (state.kind === "EXECUTING") {
            player.x = state.pose.position.x;
            player.y = state.pose.position.y;
            player.rotation = state.pose.facingRotation;
            if (world.timeSeconds >= state.completesAtSeconds) {
                const completed = completeInteraction(state, world.timeSeconds);
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
            const seq = world.animations.interactionSeq(state.interaction.id);
            this.interactionState = beginExecution(
                state,
                state.pose.position,
                world.timeSeconds,
                sequenceDurationSeconds(seq),
            );
            player.animation.restart(seq);
            return true;
        }
        player.update(
            {
                kind: PlayerMovementKind.APPROACH,
                x: state.pose.position.x,
                y: state.pose.position.y,
                stopDistance: 0,
                running,
            },
            dtSeconds,
            world.timeSeconds,
            world.terrain,
        );
        return true;
    }

    private dispatchWorldAction(action: WorldAction): void {
        const lifecycle = this.phaseLifecycle;
        if (currentPhase(lifecycle).id !== action.phaseId) {
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
            if (lifecycle.kind !== "REWARDS") {
                throw new Error("Cannot finish phase rewards outside the rewards state");
            }
            this.phaseLifecycle = transitionPhase(lifecycle, { kind: "REWARDS_CLAIMED" });
            this.activatedPhaseRewards = undefined;
            return;
        }
        this.pendingPhaseRewards = remaining;
        if (reward.kind === "EXPERIENCE") {
            this.world.grantPlayerExperience(createExperience(reward.amount));
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

    // A chest's rewards burst onto the floor as individual real items around it, one per change in
    // the grant, rather than being auto-equipped - the player picks each one up like an enemy drop.
    private dropEquipmentGrant(changes: readonly EquipmentChange[]): void {
        const world = this.world;
        const player = world.player;
        if (!player) {
            throw new Error("Cannot drop an equipment reward without a player");
        }
        const chest = this.findWorldObjectByKind(WorldObjectKind.CHEST);
        const plan = planGrantDrops(changes, player.equipment, world.groundItems);
        const replaced = new Set(plan.replacedItemIds);
        world.groundItems = world.groundItems.filter((item) => !replaced.has(item.id));
        for (const change of plan.drops) {
            const position = resolveScatterPosition(
                world.terrain,
                chest.position.level,
                chest.position.x,
                chest.position.y,
                world.groundItems.length,
            );
            world.dropGroundItem({
                path: change.path,
                tierIndex: change.tierIndex,
                x: position.x,
                y: position.y,
                level: chest.position.level,
            });
        }
    }

    private aliveCountsByWave(waveCount: number): number[] {
        const counts = new Array(waveCount).fill(0);
        for (const enemy of this.world.enemies) {
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
        if (lifecycle.kind !== "ACTIVE") {
            throw new Error("Cannot start wave scheduling without an active phase");
        }
        const phase = currentPhase(lifecycle);
        this.world.clearBattlefield();
        this.enemyWaveIndex.clear();
        this.killsByWave = phase.waves.map(() => 0);
        this.waveDirectorState = initialWaveDirectorState(phase.waves.length);
    }

    private spawnWaveEnemy(player: Player, spawn: WaveSpawn): void {
        const point = pickFarthestSpawnPoint(this.encounter.enemySpawns, player.x, player.y);
        const enemyType = this.world.animations.enemyType(spawn.enemyTypeId);
        const id = this.world.spawnEnemy(
            point.x,
            point.y,
            point.level,
            enemyType,
            spawn.statsOverride,
        );
        this.enemyWaveIndex.set(id, spawn.waveIndex);
    }
}
