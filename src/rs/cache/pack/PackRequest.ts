import { MapSquareCoord } from "../../map/MapSquareCoord";
import { isRecord, parseList } from "../../util/Parsed";
import { CacheRoots, canonicalMapSquares, parseCacheRoots, parseMapSquare } from "./CacheRoots";

declare const canonicalBrand: unique symbol;

// What a client asks the pack server for: the cache ids it reads by declared id, and the squares
// of those roots whose listed npc and obj spawns it shows. The server owns the spawn lists, so it
// is the one to pick the spawns inside those squares and root their types. Only
// canonicalPackRequest produces this brand, so equal requests are structurally identical values.
export type PackRequest = {
    readonly roots: CacheRoots;
    readonly npcSpawnSquares: readonly MapSquareCoord[];
    readonly objSpawnSquares: readonly MapSquareCoord[];
    readonly [canonicalBrand]: true;
};

export type PackRequestParts = {
    readonly roots: CacheRoots;
    readonly npcSpawnSquares: Iterable<MapSquareCoord>;
    readonly objSpawnSquares: Iterable<MapSquareCoord>;
};

// Spawns only show on squares the map loader builds, which are the roots' squares.
function undeclaredSquare(
    roots: CacheRoots,
    squares: readonly MapSquareCoord[],
): MapSquareCoord | undefined {
    return squares.find(
        (square) =>
            !roots.mapSquares.some(
                ({ mapX, mapY }) => mapX === square.mapX && mapY === square.mapY,
            ),
    );
}

export type ParsedPackRequest =
    | { readonly kind: "REQUEST"; readonly request: PackRequest }
    | { readonly kind: "INVALID"; readonly reason: string };

function canonicalRequest(parts: PackRequestParts): ParsedPackRequest {
    const npcSpawnSquares = canonicalMapSquares(parts.npcSpawnSquares);
    const objSpawnSquares = canonicalMapSquares(parts.objSpawnSquares);
    for (const [field, squares] of [
        ["npcSpawnSquares", npcSpawnSquares],
        ["objSpawnSquares", objSpawnSquares],
    ] as const) {
        const square = undeclaredSquare(parts.roots, squares);
        if (square) {
            return {
                kind: "INVALID",
                reason: `${field} holds ${square.mapX},${square.mapY}, which is not a root square`,
            };
        }
    }
    return {
        kind: "REQUEST",
        request: { roots: parts.roots, npcSpawnSquares, objSpawnSquares } as PackRequest,
    };
}

export function canonicalPackRequest(parts: PackRequestParts): PackRequest {
    const canonical = canonicalRequest(parts);
    if (canonical.kind === "INVALID") {
        throw new Error(canonical.reason);
    }
    return canonical.request;
}

const REQUEST_FIELDS: readonly string[] = ["roots", "npcSpawnSquares", "objSpawnSquares"];

// A request as it arrives over the wire: JSON of the PackRequest shape, in any order and with
// repeats, which canonicalisation absorbs. Anything else is refused with the first problem found.
export function parsePackRequest(json: unknown): ParsedPackRequest {
    if (!isRecord(json)) {
        return { kind: "INVALID", reason: "The pack request is not an object" };
    }
    const extra = Object.keys(json).find((key) => !REQUEST_FIELDS.includes(key));
    if (extra !== undefined) {
        return { kind: "INVALID", reason: `Unexpected pack request field ${extra}` };
    }
    const roots = parseCacheRoots(json.roots);
    if (roots.kind === "INVALID") {
        return { kind: "INVALID", reason: `roots: ${roots.reason}` };
    }
    const npcSpawnSquares = parseList("npcSpawnSquares", json.npcSpawnSquares, parseMapSquare);
    if (npcSpawnSquares.kind === "INVALID") {
        return npcSpawnSquares;
    }
    const objSpawnSquares = parseList("objSpawnSquares", json.objSpawnSquares, parseMapSquare);
    if (objSpawnSquares.kind === "INVALID") {
        return objSpawnSquares;
    }
    return canonicalRequest({
        roots: roots.roots,
        npcSpawnSquares: npcSpawnSquares.value,
        objSpawnSquares: objSpawnSquares.value,
    });
}
