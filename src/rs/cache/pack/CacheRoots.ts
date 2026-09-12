import { MapSquareCoord } from "../../map/MapSquareCoord";
import { Parsed, isRecord, parseInteger, parseList, parseRecord } from "../../util/Parsed";

declare const canonicalBrand: unique symbol;

// Only canonicalCacheRoots produces this brand, so any CacheRoots value is deduped and sorted:
// equal id sets are structurally identical values, which is what lets a pack be keyed by a hash of
// its roots.
export type CacheRoots = {
    readonly mapSquares: readonly MapSquareCoord[];
    readonly npcTypeIds: readonly number[];
    readonly objTypeIds: readonly number[];
    readonly locTypeIds: readonly number[];
    readonly seqIds: readonly number[];
    readonly spotAnimIds: readonly number[];
    readonly spriteIds: readonly number[];
    readonly [canonicalBrand]: true;
};

export type CacheRootIds = {
    readonly mapSquares: Iterable<MapSquareCoord>;
    readonly npcTypeIds: Iterable<number>;
    readonly objTypeIds: Iterable<number>;
    readonly locTypeIds: Iterable<number>;
    readonly seqIds: Iterable<number>;
    readonly spotAnimIds: Iterable<number>;
    readonly spriteIds: Iterable<number>;
};

// Map archive ids pack a square's coordinates into a byte each.
const MAX_MAP_SQUARE_COORD = 255;

function parseCacheId(kind: string, id: unknown, max: number): Parsed<number> {
    return parseInteger(`${kind} cache root`, id, 0, max);
}

function assertCacheId(kind: string, id: number, max: number): void {
    const parsed = parseCacheId(kind, id, max);
    if (parsed.kind === "INVALID") {
        throw new Error(parsed.reason);
    }
}

function canonicalIds(kind: string, ids: Iterable<number>): readonly number[] {
    const unique = [...new Set(ids)];
    for (const id of unique) {
        assertCacheId(kind, id, Number.MAX_SAFE_INTEGER);
    }
    return unique.sort((a, b) => a - b);
}

export function canonicalMapSquares(squares: Iterable<MapSquareCoord>): readonly MapSquareCoord[] {
    const sorted = [...squares].sort((a, b) => a.mapX - b.mapX || a.mapY - b.mapY);
    const unique: MapSquareCoord[] = [];
    for (const { mapX, mapY } of sorted) {
        assertCacheId("map square x", mapX, MAX_MAP_SQUARE_COORD);
        assertCacheId("map square y", mapY, MAX_MAP_SQUARE_COORD);
        const previous = unique[unique.length - 1];
        if (previous && previous.mapX === mapX && previous.mapY === mapY) {
            continue;
        }
        unique.push({ mapX, mapY });
    }
    return unique;
}

export function canonicalCacheRoots(ids: CacheRootIds): CacheRoots {
    return {
        mapSquares: canonicalMapSquares(ids.mapSquares),
        npcTypeIds: canonicalIds("npc type", ids.npcTypeIds),
        objTypeIds: canonicalIds("obj type", ids.objTypeIds),
        locTypeIds: canonicalIds("loc type", ids.locTypeIds),
        seqIds: canonicalIds("seq", ids.seqIds),
        spotAnimIds: canonicalIds("spot anim", ids.spotAnimIds),
        spriteIds: canonicalIds("sprite", ids.spriteIds),
    } as CacheRoots;
}

export type ParsedCacheRoots =
    | { readonly kind: "ROOTS"; readonly roots: CacheRoots }
    | { readonly kind: "INVALID"; readonly reason: string };

const ROOT_FIELDS: readonly string[] = [
    "mapSquares",
    "npcTypeIds",
    "objTypeIds",
    "locTypeIds",
    "seqIds",
    "spotAnimIds",
    "spriteIds",
];

function parseIdList(field: string, value: unknown): Parsed<number[]> {
    return parseList(field, value, (id) => parseCacheId(field, id, Number.MAX_SAFE_INTEGER));
}

const MAP_SQUARE_FIELDS: readonly string[] = ["mapX", "mapY"];

export function parseMapSquare(value: unknown): Parsed<MapSquareCoord> {
    return parseRecord("map square", MAP_SQUARE_FIELDS, value, (record) => {
        const mapX = parseCacheId("map square x", record.mapX, MAX_MAP_SQUARE_COORD);
        if (mapX.kind === "INVALID") {
            return mapX;
        }
        const mapY = parseCacheId("map square y", record.mapY, MAX_MAP_SQUARE_COORD);
        if (mapY.kind === "INVALID") {
            return mapY;
        }
        return { kind: "PARSED", value: { mapX: mapX.value, mapY: mapY.value } };
    });
}

// Roots as they arrive over the wire: JSON of the CacheRoots shape, in any order and with repeats,
// which canonicalisation absorbs. Anything else is refused with the first problem found.
export function parseCacheRoots(json: unknown): ParsedCacheRoots {
    if (!isRecord(json)) {
        return { kind: "INVALID", reason: "Cache roots are not an object" };
    }
    const extra = Object.keys(json).find((key) => !ROOT_FIELDS.includes(key));
    if (extra !== undefined) {
        return { kind: "INVALID", reason: `Unexpected cache roots field ${extra}` };
    }
    const mapSquares = parseList("mapSquares", json.mapSquares, parseMapSquare);
    if (mapSquares.kind === "INVALID") {
        return mapSquares;
    }
    const npcTypeIds = parseIdList("npcTypeIds", json.npcTypeIds);
    if (npcTypeIds.kind === "INVALID") {
        return npcTypeIds;
    }
    const objTypeIds = parseIdList("objTypeIds", json.objTypeIds);
    if (objTypeIds.kind === "INVALID") {
        return objTypeIds;
    }
    const locTypeIds = parseIdList("locTypeIds", json.locTypeIds);
    if (locTypeIds.kind === "INVALID") {
        return locTypeIds;
    }
    const seqIds = parseIdList("seqIds", json.seqIds);
    if (seqIds.kind === "INVALID") {
        return seqIds;
    }
    const spotAnimIds = parseIdList("spotAnimIds", json.spotAnimIds);
    if (spotAnimIds.kind === "INVALID") {
        return spotAnimIds;
    }
    const spriteIds = parseIdList("spriteIds", json.spriteIds);
    if (spriteIds.kind === "INVALID") {
        return spriteIds;
    }
    return {
        kind: "ROOTS",
        roots: canonicalCacheRoots({
            mapSquares: mapSquares.value,
            npcTypeIds: npcTypeIds.value,
            objTypeIds: objTypeIds.value,
            locTypeIds: locTypeIds.value,
            seqIds: seqIds.value,
            spotAnimIds: spotAnimIds.value,
            spriteIds: spriteIds.value,
        }),
    };
}
