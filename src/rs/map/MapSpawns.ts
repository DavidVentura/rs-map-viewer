import { Scene } from "../scene/Scene";
import { Parsed, parseInteger, parseList, parseRecord } from "../util/Parsed";

// Tile coordinates, so within the 256x256 map squares map archive ids can address.
const MAX_TILE_COORD = 256 * 64 - 1;

const MAX_LEVEL = Scene.MAX_LEVELS - 1;

export type NpcSpawn = {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

// A spawn from a spawn list, which records the npc's name as the list's source saw it: a cache
// that has since reused the type id for another npc no longer places it.
export type NamedNpcSpawn = NpcSpawn & {
    readonly name: string;
};

export type ObjSpawn = {
    readonly id: number;
    readonly count: number;
    readonly x: number;
    readonly y: number;
    readonly plane: number;
};

declare const canonicalBrand: unique symbol;

// The npcs and objs the map loader places on the squares it builds. Only canonicalMapSpawns
// produces this brand, so spawns are always in one order whatever list they were taken from: a
// square's spawns are the same sequence taken from a pack as from the whole world, which keeps the
// maps built from either byte for byte equal and packs deterministic.
export type MapSpawns = {
    readonly npcSpawns: readonly NamedNpcSpawn[];
    readonly objSpawns: readonly ObjSpawn[];
    readonly [canonicalBrand]: true;
};

// Names compare by code unit rather than locale, so the order is the same on every machine.
function compareNpcSpawns(a: NamedNpcSpawn, b: NamedNpcSpawn): number {
    const byName = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    return a.x - b.x || a.y - b.y || a.level - b.level || a.id - b.id || byName;
}

function compareObjSpawns(a: ObjSpawn, b: ObjSpawn): number {
    return a.x - b.x || a.y - b.y || a.plane - b.plane || a.id - b.id || a.count - b.count;
}

export function canonicalMapSpawns(
    npcSpawns: Iterable<NamedNpcSpawn>,
    objSpawns: Iterable<ObjSpawn>,
): MapSpawns {
    const sortedNpcSpawns: readonly NamedNpcSpawn[] = [...npcSpawns].sort(compareNpcSpawns);
    const sortedObjSpawns: readonly ObjSpawn[] = [...objSpawns].sort(compareObjSpawns);
    return { npcSpawns: sortedNpcSpawns, objSpawns: sortedObjSpawns } as MapSpawns;
}

function isInMapSquare(x: number, y: number, mapX: number, mapY: number): boolean {
    return ((x / 64) | 0) === mapX && ((y / 64) | 0) === mapY;
}

export function getMapNpcSpawns(
    spawns: readonly NamedNpcSpawn[],
    maxLevel: number,
    mapX: number,
    mapY: number,
): NamedNpcSpawn[] {
    return spawns.filter(
        (spawn) => isInMapSquare(spawn.x, spawn.y, mapX, mapY) && spawn.level <= maxLevel,
    );
}

export function getMapObjSpawns(
    spawns: readonly ObjSpawn[],
    maxLevel: number,
    mapX: number,
    mapY: number,
): ObjSpawn[] {
    return spawns.filter(
        (spawn) => isInMapSquare(spawn.x, spawn.y, mapX, mapY) && spawn.plane <= maxLevel,
    );
}

const NPC_SPAWN_FIELDS: readonly string[] = ["id", "name", "x", "y", "level"];

function parseNamedNpcSpawn(value: unknown): Parsed<NamedNpcSpawn> {
    return parseRecord("npc spawn", NPC_SPAWN_FIELDS, value, (record) => {
        const id = parseInteger("npc spawn id", record.id, 0, Number.MAX_SAFE_INTEGER);
        if (id.kind === "INVALID") {
            return id;
        }
        if (typeof record.name !== "string") {
            return {
                kind: "INVALID",
                reason: `Invalid npc spawn name ${JSON.stringify(record.name)}`,
            };
        }
        const x = parseInteger("npc spawn x", record.x, 0, MAX_TILE_COORD);
        if (x.kind === "INVALID") {
            return x;
        }
        const y = parseInteger("npc spawn y", record.y, 0, MAX_TILE_COORD);
        if (y.kind === "INVALID") {
            return y;
        }
        const level = parseInteger("npc spawn level", record.level, 0, MAX_LEVEL);
        if (level.kind === "INVALID") {
            return level;
        }
        return {
            kind: "PARSED",
            value: { id: id.value, name: record.name, x: x.value, y: y.value, level: level.value },
        };
    });
}

const OBJ_SPAWN_FIELDS: readonly string[] = ["id", "count", "x", "y", "plane"];

function parseObjSpawn(value: unknown): Parsed<ObjSpawn> {
    return parseRecord("obj spawn", OBJ_SPAWN_FIELDS, value, (record) => {
        const id = parseInteger("obj spawn id", record.id, 0, Number.MAX_SAFE_INTEGER);
        if (id.kind === "INVALID") {
            return id;
        }
        const count = parseInteger("obj spawn count", record.count, 0, Number.MAX_SAFE_INTEGER);
        if (count.kind === "INVALID") {
            return count;
        }
        const x = parseInteger("obj spawn x", record.x, 0, MAX_TILE_COORD);
        if (x.kind === "INVALID") {
            return x;
        }
        const y = parseInteger("obj spawn y", record.y, 0, MAX_TILE_COORD);
        if (y.kind === "INVALID") {
            return y;
        }
        const plane = parseInteger("obj spawn plane", record.plane, 0, MAX_LEVEL);
        if (plane.kind === "INVALID") {
            return plane;
        }
        return {
            kind: "PARSED",
            value: {
                id: id.value,
                count: count.value,
                x: x.value,
                y: y.value,
                plane: plane.value,
            },
        };
    });
}

export function parseNpcSpawnList(field: string, json: unknown): Parsed<NamedNpcSpawn[]> {
    return parseList(field, json, parseNamedNpcSpawn);
}

export function parseObjSpawnList(field: string, json: unknown): Parsed<ObjSpawn[]> {
    return parseList(field, json, parseObjSpawn);
}

const MAP_SPAWNS_FIELDS: readonly string[] = ["npcSpawns", "objSpawns"];

// Spawns as mapSpawnsJson writes them.
export function parseMapSpawns(json: unknown): Parsed<MapSpawns> {
    return parseRecord("map spawns", MAP_SPAWNS_FIELDS, json, (record) => {
        const npcSpawns = parseNpcSpawnList("npcSpawns", record.npcSpawns);
        if (npcSpawns.kind === "INVALID") {
            return npcSpawns;
        }
        const objSpawns = parseObjSpawnList("objSpawns", record.objSpawns);
        if (objSpawns.kind === "INVALID") {
            return objSpawns;
        }
        return { kind: "PARSED", value: canonicalMapSpawns(npcSpawns.value, objSpawns.value) };
    });
}

// Fixed key order, so equal spawns serialise to equal bytes.
export function mapSpawnsJson({ npcSpawns, objSpawns }: MapSpawns): string {
    return JSON.stringify({
        npcSpawns: npcSpawns.map(({ id, name, x, y, level }) => ({ id, name, x, y, level })),
        objSpawns: objSpawns.map(({ id, count, x, y, plane }) => ({ id, count, x, y, plane })),
    });
}
