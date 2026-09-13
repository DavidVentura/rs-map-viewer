import { WeaponStyle } from "./Ability";
import { EncounterId, EncounterSpawnMode, Wave, WaveEncounter } from "./Encounter";
import { EnemyState } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import { EquipmentPath, styleSetGrant } from "./Equipment";
import { GameWorld, SimInput } from "./GameWorld";
import {
    WorldObjectKind,
    createInteraction,
    createInteractionId,
    createWorldObject,
    createWorldObjectId,
    createWorldPosition,
} from "./Interaction";
import { createPhase, createPhaseId } from "./Phase";
import {
    createNamedEquipmentGrantReward,
    createRewardId,
    createUpgradeChoiceReward,
} from "./Reward";
import { TILE_SIZE, Terrain } from "./Terrain";
import { STUB_FRAME_COUNT, STUB_FRAME_SECONDS, stubEncounterAnimations } from "./testLoaders";
import { UpgradeId } from "./upgrades";

class FakeTerrain implements Terrain {
    isLoaded(): boolean {
        return true;
    }

    canOccupy(): boolean {
        return true;
    }

    getWallFlag(): number {
        return 0;
    }

    getHeight(): number {
        return 0;
    }
}

const ANIMATIONS = stubEncounterAnimations();

// Every stubbed sequence lasts this long (see testLoaders.ts), so every interaction here - lever
// pull or chest open alike - takes exactly this long to execute regardless of its seq id.
const STUB_INTERACTION_DURATION_SECONDS = STUB_FRAME_SECONDS * STUB_FRAME_COUNT;

const FIRST_WAVE: Wave = {
    groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
    startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0, delaySeconds: 0 },
};

const SECOND_WAVE: Wave = {
    groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
    startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: 60, delaySeconds: 0 },
};

// One tile west of the spawn, facing east: its approach pose lands exactly on (0, 0, 0) (see
// worldObjectApproachPose), so the player never has to walk before executing.
const LEVER = createWorldObject(
    createWorldObjectId(1),
    WorldObjectKind.LEVER,
    createWorldPosition(-TILE_SIZE, 0, 0),
    1,
);
const CHEST = createWorldObject(
    createWorldObjectId(2),
    WorldObjectKind.CHEST,
    createWorldPosition(TILE_SIZE, 0, 0),
    3,
);

function phaseEncounter(waves: readonly Wave[]): WaveEncounter {
    const phase = createPhase(
        createPhaseId("first"),
        "First phase",
        waves,
        { kind: "ALL_WAVES_CLEARED" },
        [],
    );
    const start = createInteraction(
        createInteractionId("start_first"),
        LEVER.id,
        "Pull Lever",
        { kind: "START_PHASE", phaseId: phase.id },
        1,
    );
    return {
        id: EncounterId.FIGHT_CAVES,
        mapSquares: [{ mapX: 0, mapY: 0 }],
        playerSpawn: { x: 0, y: 0, level: 0 },
        enemySpawns: [
            { x: 1000, y: 0, level: 0 },
            { x: -1000, y: 0, level: 0 },
        ],
        enemyTypeIds: [EnemyTypeId.TZ_KIH],
        spawnMode: EncounterSpawnMode.WAVES,
        ambientNpcs: false,
        musicFile: "audio/tzhaar.opus",
        initialCameraYaw: 1862,
        maximumRenderedLevel: 3,
        waves,
        phases: [phase],
        worldObjects: [LEVER, CHEST],
        interactions: [start],
    };
}

function rewardingEncounter(): WaveEncounter {
    const encounter = phaseEncounter([FIRST_WAVE]);
    const phase = createPhase(
        createPhaseId("rewarding"),
        "Rewarding phase",
        encounter.waves,
        { kind: "ALL_WAVES_CLEARED" },
        [
            createUpgradeChoiceReward(createRewardId("rewarding_upgrade"), [
                UpgradeId.DAMAGE_UP,
                UpgradeId.SWIFT_STRIKES,
                UpgradeId.QUICK_HANDS,
            ]),
        ],
    );
    const start = createInteraction(
        createInteractionId("start_rewarding"),
        LEVER.id,
        "Pull Lever",
        { kind: "START_PHASE", phaseId: phase.id },
        1,
    );
    const rewards = createInteraction(
        createInteractionId("claim_rewarding"),
        CHEST.id,
        "Open Chest",
        { kind: "ACTIVATE_PHASE_REWARDS", phaseId: phase.id },
        1,
    );
    return { ...encounter, phases: [phase], interactions: [start, rewards] };
}

function equipmentRewardingEncounter(): WaveEncounter {
    const encounter = phaseEncounter([FIRST_WAVE]);
    const phase = createPhase(
        createPhaseId("gear"),
        "Gear phase",
        encounter.waves,
        { kind: "ALL_WAVES_CLEARED" },
        [
            createNamedEquipmentGrantReward(
                createRewardId("gear_reward"),
                styleSetGrant(WeaponStyle.MELEE, 2),
            ),
        ],
    );
    const start = createInteraction(
        createInteractionId("start_gear"),
        LEVER.id,
        "Pull Lever",
        { kind: "START_PHASE", phaseId: phase.id },
        1,
    );
    const rewards = createInteraction(
        createInteractionId("claim_gear"),
        CHEST.id,
        "Open Chest",
        { kind: "ACTIVATE_PHASE_REWARDS", phaseId: phase.id },
        1,
    );
    return { ...encounter, phases: [phase], interactions: [start, rewards] };
}

function idleInput(): SimInput {
    return {
        movement: { x: 0, y: 0, running: false },
        combat: { basicAttack: { held: false }, skills: [] },
    };
}

function advanceSeconds(world: GameWorld, input: SimInput, seconds: number): void {
    const frame = 1 / 60;
    let remaining = seconds;
    while (remaining > 1e-9) {
        const dt = Math.min(frame, remaining);
        world.advance(dt, input);
        remaining -= dt;
    }
}

function startPhase(world: GameWorld): void {
    const interaction = world.activeInteractions[0];
    world.advance(1 / 120, {
        ...idleInput(),
        interaction: { kind: "START", interactionId: interaction.id },
    });
    advanceSeconds(world, idleInput(), STUB_INTERACTION_DURATION_SECONDS + 0.05);
}

describe("phased wave encounters", () => {
    it("waits for an authored START_PHASE interaction before spawning enemies", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.startEncounter(phaseEncounter([FIRST_WAVE]), 0, 0, 0);

        world.advance(1, idleInput());
        expect(world.enemies).toEqual([]);
        expect(world.phaseLifecycle?.kind).toBe("READY");
        expect(world.activeInteractions).toHaveLength(1);

        startPhase(world);

        expect(world.phaseLifecycle?.kind).toBe("ACTIVE");
        expect(world.enemies).toHaveLength(1);
    });

    it("keeps wave scheduling running after an internal wave clears without an upgrade modal", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.startEncounter(phaseEncounter([FIRST_WAVE, SECOND_WAVE]), 0, 0, 0);
        startPhase(world);

        world.enemies[0].health = 0;
        world.advance(1 / 120, idleInput());

        expect(world.interactionState.kind).toBe("IDLE");
        expect(world.phaseLifecycle?.kind).toBe("ACTIVE");
        expect(world.enemies.filter((enemy) => enemy.state !== EnemyState.DEAD)).toHaveLength(1);
    });

    it("cancels an interaction when the player gives movement input", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.startEncounter(phaseEncounter([FIRST_WAVE]), 0, 0, 0);
        const interaction = world.activeInteractions[0];
        world.advance(1 / 120, {
            ...idleInput(),
            interaction: { kind: "START", interactionId: interaction.id },
        });
        expect(world.interactionState.kind).toBe("EXECUTING");

        world.advance(1 / 120, {
            ...idleInput(),
            movement: { x: 1, y: 0, running: false },
        });

        expect(world.interactionState.kind).toBe("IDLE");
        expect(world.phaseLifecycle?.kind).toBe("READY");
    });

    it("opens an upgrade choice only after the reward interaction completes", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.startEncounter(rewardingEncounter(), 0, 0, 0);
        startPhase(world);
        world.enemies[0].health = 0;
        world.advance(1 / 120, idleInput());

        expect(world.phaseLifecycle?.kind).toBe("REWARDS");
        expect(world.pendingUpgradeOffer).toBeUndefined();
        const rewardInteraction = world.activeInteractions[0];
        world.advance(1 / 120, {
            ...idleInput(),
            interaction: { kind: "START", interactionId: rewardInteraction.id },
        });
        advanceSeconds(world, idleInput(), STUB_INTERACTION_DURATION_SECONDS + 0.05);

        expect(world.pendingUpgradeOffer?.map(({ id }) => id)).toEqual([
            UpgradeId.DAMAGE_UP,
            UpgradeId.SWIFT_STRIKES,
            UpgradeId.QUICK_HANDS,
        ]);
        const previous = world.player!.getModifiers();
        world.advance(1 / 120, { ...idleInput(), chooseUpgrade: 0 });
        expect(world.player!.getModifiers()).not.toEqual(previous);
        expect(world.pendingUpgradeOffer).toBeUndefined();
        expect(world.phaseLifecycle?.kind).toBe("COMPLETE");
    });

    it("opening the chest bursts an equipment grant onto the floor as separate items instead of auto-equipping", () => {
        const world = new GameWorld(new FakeTerrain(), ANIMATIONS, () => 0);
        world.startEncounter(equipmentRewardingEncounter(), 0, 0, 0);
        startPhase(world);
        world.enemies[0].health = 0;
        world.advance(1 / 120, idleInput());
        expect(world.phaseLifecycle?.kind).toBe("REWARDS");

        const killDropIds = new Set(world.groundItems.map((item) => item.id));
        const rewardInteraction = world.activeInteractions[0];
        world.advance(1 / 120, {
            ...idleInput(),
            interaction: { kind: "START", interactionId: rewardInteraction.id },
        });
        advanceSeconds(world, idleInput(), STUB_INTERACTION_DURATION_SECONDS + 0.05);

        const chestItems = world.groundItems.filter((item) => !killDropIds.has(item.id));
        expect(world.player!.equipment[EquipmentPath.SCIMITAR]).toBe(0);
        expect(world.player!.equipment[EquipmentPath.DEFENDER]).toBe(0);
        expect(chestItems).toHaveLength(2);
        expect(new Set(chestItems.map((item) => item.path))).toEqual(
            new Set([EquipmentPath.SCIMITAR, EquipmentPath.DEFENDER]),
        );
        expect(chestItems.every((item) => item.tierIndex === 2)).toBe(true);
        // Scattered onto distinct tiles rather than stacked on top of each other.
        expect(new Set(chestItems.map((item) => `${item.x},${item.y}`)).size).toBe(2);
        expect(world.phaseLifecycle?.kind).toBe("COMPLETE");
    });
});
