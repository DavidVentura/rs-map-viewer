import { EnemyTypeId } from "./EnemyType";

export enum EncounterId {
    LUMBRIDGE = "lumbridge",
    FIGHT_CAVES = "fightcaves",
}

export type MapSquareCoord = {
    readonly mapX: number;
    readonly mapY: number;
};

export type PlayerSpawn = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type EnemySpawnPoint = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type WaveGroup = {
    readonly enemyTypeId: EnemyTypeId;
    readonly count: number;
};

// A wave starts once the previous wave has died down to at most maxPreviousAliveFraction of its
// spawned size, or maxElapsedSeconds have passed since the previous wave started, whichever comes
// first. This lets later waves overlap the tail of earlier ones instead of waiting for a clear.
export type WaveStartCondition = {
    readonly maxPreviousAliveFraction: number;
    readonly maxElapsedSeconds: number;
};

export type WaveModifiers = {
    readonly healthMultiplier?: number;
    readonly speedMultiplier?: number;
};

export type Wave = {
    readonly groups: readonly WaveGroup[];
    readonly startCondition: WaveStartCondition;
    readonly modifiers?: WaveModifiers;
};

export enum EncounterSpawnMode {
    // A fixed set of enemies, one per enemySpawns point, that respawn at their own spawn point
    // after a delay (the current Lumbridge behavior). Always exactly one, never-ending wave.
    STATIC_RESPAWN = "static_respawn",
    // WaveDirector-driven: enemySpawns is a location pool the director draws from, dead enemies
    // do not respawn, and the encounter ends once every wave is spawned and cleared.
    WAVES = "waves",
}

export type Encounter = {
    readonly id: EncounterId;
    readonly mapSquares: readonly MapSquareCoord[];
    readonly playerSpawn: PlayerSpawn;
    readonly enemySpawns: readonly EnemySpawnPoint[];
    readonly enemyTypeIds: readonly EnemyTypeId[];
    readonly spawnMode: EncounterSpawnMode;
    readonly waves: readonly Wave[];
    readonly ambientNpcs: boolean;
};

function tileToWorld(tileX: number, tileY: number, tileCenter: boolean = false): [number, number] {
    const offset = tileCenter ? 64 : 0;
    return [tileX * 128 + offset, tileY * 128 + offset];
}

const LUMBRIDGE_PLAYER_TILE = { x: 3237, y: 3225 };
const [lumbridgePlayerX, lumbridgePlayerY] = tileToWorld(
    LUMBRIDGE_PLAYER_TILE.x,
    LUMBRIDGE_PLAYER_TILE.y,
);

const LUMBRIDGE_GOBLIN_TILE_OFFSETS = [
    { x: 3, y: 1 },
    { x: -3, y: 1 },
    { x: 1, y: -3 },
    { x: -1, y: 3 },
];

const LUMBRIDGE: Encounter = {
    id: EncounterId.LUMBRIDGE,
    mapSquares: [{ mapX: LUMBRIDGE_PLAYER_TILE.x >> 6, mapY: LUMBRIDGE_PLAYER_TILE.y >> 6 }],
    playerSpawn: { x: lumbridgePlayerX, y: lumbridgePlayerY, level: 0 },
    enemySpawns: LUMBRIDGE_GOBLIN_TILE_OFFSETS.map((offset) => {
        const [x, y] = tileToWorld(
            LUMBRIDGE_PLAYER_TILE.x + offset.x,
            LUMBRIDGE_PLAYER_TILE.y + offset.y,
            true,
        );
        return { x, y, level: 0 };
    }),
    enemyTypeIds: [EnemyTypeId.GOBLIN],
    spawnMode: EncounterSpawnMode.STATIC_RESPAWN,
    ambientNpcs: true,
    waves: [
        {
            groups: [
                { enemyTypeId: EnemyTypeId.GOBLIN, count: LUMBRIDGE_GOBLIN_TILE_OFFSETS.length },
            ],
            startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 },
        },
    ],
};

const FIGHT_CAVES_PLAYER_TILE = { x: 2398, y: 5078 };
const [fightCavesPlayerX, fightCavesPlayerY] = tileToWorld(
    FIGHT_CAVES_PLAYER_TILE.x,
    FIGHT_CAVES_PLAYER_TILE.y,
);

const FIGHT_CAVES_ENEMY_TILE_OFFSETS = [
    { x: 3, y: 1 },
    { x: -3, y: 1 },
    { x: 1, y: -3 },
    { x: -1, y: 3 },
    { x: 4, y: -2 },
    { x: -4, y: 2 },
    { x: 2, y: 4 },
    { x: -2, y: -4 },
];

const FIGHT_CAVES_EARLY_START: WaveStartCondition = {
    maxPreviousAliveFraction: 0.5,
    maxElapsedSeconds: 12,
};
const FIGHT_CAVES_LATE_START: WaveStartCondition = {
    maxPreviousAliveFraction: 0.35,
    maxElapsedSeconds: 10,
};

const FIGHT_CAVES: Encounter = {
    id: EncounterId.FIGHT_CAVES,
    mapSquares: [
        { mapX: 36, mapY: 78 },
        { mapX: 37, mapY: 78 },
        { mapX: 38, mapY: 78 },
        { mapX: 36, mapY: 79 },
        { mapX: 37, mapY: 79 },
        { mapX: 38, mapY: 79 },
        { mapX: 37, mapY: 80 },
        { mapX: 38, mapY: 80 },
    ],
    playerSpawn: { x: fightCavesPlayerX, y: fightCavesPlayerY, level: 0 },
    enemySpawns: FIGHT_CAVES_ENEMY_TILE_OFFSETS.map((offset) => {
        const [x, y] = tileToWorld(
            FIGHT_CAVES_PLAYER_TILE.x + offset.x,
            FIGHT_CAVES_PLAYER_TILE.y + offset.y,
            true,
        );
        return { x, y, level: 0 };
    }),
    enemyTypeIds: [EnemyTypeId.TZ_KIH, EnemyTypeId.TZ_KEK],
    spawnMode: EncounterSpawnMode.WAVES,
    ambientNpcs: false,
    waves: [
        {
            groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 4 }],
            startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 },
        },
        {
            groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 6 }],
            startCondition: FIGHT_CAVES_EARLY_START,
        },
        {
            groups: [
                { enemyTypeId: EnemyTypeId.TZ_KIH, count: 8 },
                { enemyTypeId: EnemyTypeId.TZ_KEK, count: 1 },
            ],
            startCondition: FIGHT_CAVES_EARLY_START,
        },
        {
            groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 10 }],
            startCondition: FIGHT_CAVES_EARLY_START,
        },
        {
            groups: [
                { enemyTypeId: EnemyTypeId.TZ_KIH, count: 10 },
                { enemyTypeId: EnemyTypeId.TZ_KEK, count: 2 },
            ],
            startCondition: FIGHT_CAVES_LATE_START,
        },
        {
            groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 14 }],
            startCondition: FIGHT_CAVES_LATE_START,
        },
        {
            groups: [
                { enemyTypeId: EnemyTypeId.TZ_KIH, count: 14 },
                { enemyTypeId: EnemyTypeId.TZ_KEK, count: 2 },
            ],
            startCondition: FIGHT_CAVES_LATE_START,
        },
        {
            groups: [
                { enemyTypeId: EnemyTypeId.TZ_KIH, count: 18 },
                { enemyTypeId: EnemyTypeId.TZ_KEK, count: 3 },
            ],
            startCondition: FIGHT_CAVES_LATE_START,
        },
        {
            groups: [
                { enemyTypeId: EnemyTypeId.TZ_KIH, count: 20 },
                { enemyTypeId: EnemyTypeId.TZ_KEK, count: 3 },
            ],
            startCondition: FIGHT_CAVES_LATE_START,
        },
        {
            groups: [
                { enemyTypeId: EnemyTypeId.TZ_KIH, count: 24 },
                { enemyTypeId: EnemyTypeId.TZ_KEK, count: 4 },
            ],
            startCondition: FIGHT_CAVES_LATE_START,
            modifiers: { healthMultiplier: 1.15, speedMultiplier: 1.1 },
        },
    ],
};

export const ENCOUNTERS: Readonly<Record<EncounterId, Encounter>> = {
    [EncounterId.LUMBRIDGE]: LUMBRIDGE,
    [EncounterId.FIGHT_CAVES]: FIGHT_CAVES,
};

export function getEncounter(id: EncounterId): Encounter {
    return ENCOUNTERS[id];
}

export function parseEncounterId(value: string | null): EncounterId {
    if (value === EncounterId.FIGHT_CAVES) {
        return EncounterId.FIGHT_CAVES;
    }
    return EncounterId.LUMBRIDGE;
}
