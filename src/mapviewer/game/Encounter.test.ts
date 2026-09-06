import { ENCOUNTERS, EncounterId, getEncounter, parseEncounterId } from "./Encounter";
import { ENEMY_TYPES } from "./EnemyType";

function tileKey(x: number, y: number, level: number): string {
    return `${x >> 7},${y >> 7},${level}`;
}

describe("encounters", () => {
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
        "%s only references enemy types declared on the encounter",
        (id) => {
            const encounter = getEncounter(id);
            for (const spawn of encounter.enemySpawns) {
                expect(encounter.enemyTypeIds).toContain(spawn.enemyTypeId);
            }
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
