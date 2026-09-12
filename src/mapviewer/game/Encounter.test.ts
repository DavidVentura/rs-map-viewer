import {
    ENCOUNTERS,
    EncounterId,
    EncounterSpawnMode,
    WaveEncounter,
    getEncounter,
    parseEncounterId,
    validateEncounter,
} from "./Encounter";
import { ENEMY_TYPES, EnemyTypeId } from "./EnemyType";
import { createPhaseId } from "./Phase";

function tileKey(x: number, y: number, level: number): string {
    return `${x >> 7},${y >> 7},${level}`;
}

describe("encounters", () => {
    it.each(Object.values(EncounterId))("%s satisfies its authored encounter contract", (id) => {
        validateEncounter(getEncounter(id));
    });

    it.each(Object.values(EncounterId))("%s spawns every enemy on a distinct tile", (id) => {
        const encounter = getEncounter(id);
        const keys = encounter.enemySpawns.map((spawn) => tileKey(spawn.x, spawn.y, spawn.level));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it.each(Object.values(EncounterId))(
        "%s spawns enemies on a different tile than the player",
        (id) => {
            const encounter = getEncounter(id);
            const playerKey = tileKey(
                encounter.playerSpawn.x,
                encounter.playerSpawn.y,
                encounter.playerSpawn.level,
            );
            for (const spawn of encounter.enemySpawns) {
                expect(tileKey(spawn.x, spawn.y, spawn.level)).not.toBe(playerKey);
            }
        },
    );

    it.each(Object.values(EncounterId))(
        "%s's waves only reference enemy types declared on the encounter",
        (id) => {
            const encounter = getEncounter(id);
            for (const wave of encounter.waves) {
                for (const group of wave.groups) {
                    expect(encounter.enemyTypeIds).toContain(group.enemyTypeId);
                }
            }
        },
    );

    it.each(Object.values(EncounterId))("%s declares at least one wave", (id) => {
        const encounter = getEncounter(id);
        expect(encounter.waves.length).toBeGreaterThan(0);
    });

    it.each(Object.values(EncounterId))(
        "%s's wave start conditions use well-formed fractions and non-negative timers",
        (id) => {
            const encounter = getEncounter(id);
            for (const wave of encounter.waves) {
                expect(wave.startCondition.maxPreviousAliveFraction).toBeGreaterThanOrEqual(0);
                expect(wave.startCondition.maxPreviousAliveFraction).toBeLessThanOrEqual(1);
                expect(wave.startCondition.maxElapsedSeconds).toBeGreaterThanOrEqual(0);
            }
        },
    );

    it("Lumbridge is a single never-ending static-respawn wave covering every spawn point", () => {
        const encounter = getEncounter(EncounterId.LUMBRIDGE);
        expect(encounter.spawnMode).toBe(EncounterSpawnMode.STATIC_RESPAWN);
        expect(encounter.phases).toEqual([]);
        expect(encounter.interactions).toEqual([]);
        expect(encounter.waves.length).toBe(1);
        const totalCount = encounter.waves[0].groups.reduce((sum, group) => sum + group.count, 0);
        expect(totalCount).toBe(encounter.enemySpawns.length);
    });

    it("Fight Caves ramps across several waves and mixes in the tankier Tz-Kek", () => {
        const encounter = getEncounter(EncounterId.FIGHT_CAVES);
        expect(encounter.spawnMode).toBe(EncounterSpawnMode.WAVES);
        // 8-10 regular waves plus the TzTok-Jad finale.
        expect(encounter.waves.length).toBeGreaterThanOrEqual(9);
        expect(encounter.waves.length).toBeLessThanOrEqual(11);

        const regularWaves = encounter.waves.filter((wave) => !wave.boss);
        const groupCounts = regularWaves.map((wave) =>
            wave.groups.reduce((sum, group) => sum + group.count, 0),
        );
        expect(groupCounts[0]).toBeLessThan(groupCounts[groupCounts.length - 1]);
        expect(groupCounts[groupCounts.length - 1]).toBeGreaterThanOrEqual(20);

        const hasTankierMix = regularWaves.some(
            (wave) => wave.groups.length > 1 || wave.modifiers !== undefined,
        );
        expect(hasTankierMix).toBe(true);
    });

    it.each([EncounterId.FIGHT_CAVES, EncounterId.QUICK_CAVE, EncounterId.SANDBOX])(
        "%s partitions waves into player-started phases",
        (id) => {
            const encounter = getEncounter(id);
            if (encounter.spawnMode !== EncounterSpawnMode.WAVES) {
                throw new Error("expected wave encounter");
            }
            expect(encounter.phases.flatMap((phase) => phase.waves)).toEqual(encounter.waves);
            for (const phase of encounter.phases) {
                expect(
                    encounter.interactions.filter(
                        (interaction) =>
                            interaction.action.kind === "START_PHASE" &&
                            interaction.action.phaseId === phase.id,
                    ),
                ).toHaveLength(1);
            }
        },
    );

    it("requires interaction actions to reference a declared phase", () => {
        const fightCaves = getEncounter(EncounterId.FIGHT_CAVES);
        if (fightCaves.spawnMode !== EncounterSpawnMode.WAVES) {
            throw new Error("expected wave encounter");
        }
        const firstInteraction = fightCaves.interactions[0];
        const invalid: WaveEncounter = {
            ...fightCaves,
            interactions: [
                {
                    ...firstInteraction,
                    action: { kind: "START_PHASE", phaseId: createPhaseId("missing") },
                },
                ...fightCaves.interactions.slice(1),
            ],
        };

        expect(() => validateEncounter(invalid)).toThrow(RangeError);
    });

    it.each([EncounterId.FIGHT_CAVES, EncounterId.QUICK_CAVE])(
        "%s ends with a single-enemy TzTok-Jad boss wave that no earlier wave overlaps",
        (id) => {
            const encounter = getEncounter(id);
            const lastWave = encounter.waves[encounter.waves.length - 1];
            expect(lastWave.boss).toBe(true);
            expect(lastWave.groups).toEqual([{ enemyTypeId: EnemyTypeId.TZTOK_JAD, count: 1 }]);
            expect(encounter.enemyTypeIds).toContain(EnemyTypeId.TZTOK_JAD);
            expect(encounter.enemyTypeIds).toContain(EnemyTypeId.YT_HURKOT);

            const earlierWaves = encounter.waves.slice(0, -1);
            expect(earlierWaves.every((wave) => !wave.boss)).toBe(true);
        },
    );

    it.each(Object.values(EncounterId))("%s only references known enemy types", (id) => {
        const encounter = getEncounter(id);
        for (const enemyTypeId of encounter.enemyTypeIds) {
            expect(ENEMY_TYPES[enemyTypeId]).toBeDefined();
        }
    });

    it.each(Object.values(EncounterId))(
        "%s declares at least one map square to load initially",
        (id) => {
            const encounter = getEncounter(id);
            expect(encounter.mapSquares.length).toBeGreaterThan(0);
        },
    );

    it.each(Object.values(EncounterId))(
        "%s includes the player spawn's map square in its initial map squares",
        (id) => {
            const encounter = getEncounter(id);
            const playerMapX = encounter.playerSpawn.x >> 13;
            const playerMapY = encounter.playerSpawn.y >> 13;
            expect(encounter.mapSquares).toContainEqual({ mapX: playerMapX, mapY: playerMapY });
        },
    );

    it("registers every EncounterId in ENCOUNTERS", () => {
        for (const id of Object.values(EncounterId)) {
            expect(ENCOUNTERS[id].id).toBe(id);
        }
    });

    it("parseEncounterId defaults to lumbridge for unknown or missing values", () => {
        expect(parseEncounterId(null)).toBe(EncounterId.LUMBRIDGE);
        expect(parseEncounterId("bogus")).toBe(EncounterId.LUMBRIDGE);
        expect(parseEncounterId("fightcaves")).toBe(EncounterId.FIGHT_CAVES);
    });
});
