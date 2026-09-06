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
    readonly enemyTypeId: EnemyTypeId;
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type Encounter = {
    readonly id: EncounterId;
    readonly mapSquares: readonly MapSquareCoord[];
    readonly playerSpawn: PlayerSpawn;
    readonly enemySpawns: readonly EnemySpawnPoint[];
    readonly enemyTypeIds: readonly EnemyTypeId[];
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
        return { enemyTypeId: EnemyTypeId.GOBLIN, x, y, level: 0 };
    }),
    enemyTypeIds: [EnemyTypeId.GOBLIN],
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
];

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
        return { enemyTypeId: EnemyTypeId.TZ_KIH, x, y, level: 0 };
    }),
    enemyTypeIds: [EnemyTypeId.TZ_KIH],
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
