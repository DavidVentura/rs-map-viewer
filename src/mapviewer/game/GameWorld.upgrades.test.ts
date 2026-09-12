import { WeaponStyle } from "./Ability";
import { EncounterId, EncounterSpawnMode, Wave, WaveEncounter } from "./Encounter";
import { EnemyState } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import { GameWorld, SimInput } from "./GameWorld";
import {
    createAuthoredLocationTarget,
    createInteraction,
    createInteractionId,
    createInteractionPose,
    createWorldPosition,
} from "./Interaction";
import { createPhase, createPhaseId } from "./Phase";
import { StanceSeqIdsByStance } from "./Player";
import { Terrain } from "./Terrain";
import { stubSequenceLoaders } from "./testLoaders";

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

const { seqTypeLoader, seqFrameLoader } = stubSequenceLoaders();

const STYLE_SEQ_IDS: StanceSeqIdsByStance = {
    [WeaponStyle.RANGED]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 426 },
    [WeaponStyle.MAGIC]: { idleSeqId: 813, walkSeqId: 1146, runSeqId: 1210, attackSeqId: 711 },
    [WeaponStyle.MELEE]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 390 },
};

const FIRST_WAVE: Wave = {
    groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
    startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 },
};

const SECOND_WAVE: Wave = {
    groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
    startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: 60 },
};

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
        createAuthoredLocationTarget("Start first phase", [
            createInteractionPose(createWorldPosition(0, 0, 0), 0),
        ]),
        { kind: "START_PHASE", phaseId: phase.id },
        1,
        0.01,
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
        waves,
        phases: [phase],
        interactions: [start],
    };
}

function idleInput(): SimInput {
    return {
        movement: { x: 0, y: 0, running: false },
        combat: { basicAttack: { held: false }, skills: [] },
    };
}

function startPhase(world: GameWorld): void {
    const interaction = world.activeInteractions[0];
    world.advance(1 / 120, {
        ...idleInput(),
        interaction: { kind: "START", interactionId: interaction.id },
    });
    world.advance(1 / 120, idleInput());
    world.advance(1 / 120, idleInput());
}

describe("phased wave encounters", () => {
    it("waits for an authored START_PHASE interaction before spawning enemies", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(phaseEncounter([FIRST_WAVE]), 0, 0, 0, STYLE_SEQ_IDS);

        world.advance(1, idleInput());
        expect(world.enemies).toEqual([]);
        expect(world.phaseLifecycle?.kind).toBe("READY");
        expect(world.activeInteractions).toHaveLength(1);

        startPhase(world);

        expect(world.phaseLifecycle?.kind).toBe("ACTIVE");
        expect(world.enemies).toHaveLength(1);
    });

    it("keeps wave scheduling running after an internal wave clears without an upgrade modal", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(phaseEncounter([FIRST_WAVE, SECOND_WAVE]), 0, 0, 0, STYLE_SEQ_IDS);
        startPhase(world);

        world.enemies[0].health = 0;
        world.advance(1 / 120, idleInput());

        expect(world.interactionState.kind).toBe("IDLE");
        expect(world.phaseLifecycle?.kind).toBe("ACTIVE");
        expect(world.enemies.filter((enemy) => enemy.state !== EnemyState.DEAD)).toHaveLength(1);
    });

    it("cancels an interaction when the player gives movement input", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(phaseEncounter([FIRST_WAVE]), 0, 0, 0, STYLE_SEQ_IDS);
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
});
