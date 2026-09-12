import { MapSquareCoord } from "../../map/MapSquareCoord";

declare const canonicalBrand: unique symbol;

// Only canonicalCacheRoots produces this brand, so any CacheRoots value is deduped and sorted:
// equal id sets are structurally identical values, which is what lets a pack be keyed by a hash of
// its roots.
export type CacheRoots = {
    readonly mapSquares: readonly MapSquareCoord[];
    readonly npcTypeIds: readonly number[];
    readonly objTypeIds: readonly number[];
    readonly seqIds: readonly number[];
    readonly spotAnimIds: readonly number[];
    readonly [canonicalBrand]: true;
};

export type CacheRootIds = {
    readonly mapSquares: Iterable<MapSquareCoord>;
    readonly npcTypeIds: Iterable<number>;
    readonly objTypeIds: Iterable<number>;
    readonly seqIds: Iterable<number>;
    readonly spotAnimIds: Iterable<number>;
};

function assertCacheId(kind: string, id: number): void {
    if (!Number.isInteger(id) || id < 0) {
        throw new Error(`Invalid ${kind} cache root ${id}`);
    }
}

function canonicalIds(kind: string, ids: Iterable<number>): readonly number[] {
    const unique = [...new Set(ids)];
    for (const id of unique) {
        assertCacheId(kind, id);
    }
    return unique.sort((a, b) => a - b);
}

function canonicalMapSquares(squares: Iterable<MapSquareCoord>): readonly MapSquareCoord[] {
    const sorted = [...squares].sort((a, b) => a.mapX - b.mapX || a.mapY - b.mapY);
    const unique: MapSquareCoord[] = [];
    for (const { mapX, mapY } of sorted) {
        assertCacheId("map square x", mapX);
        assertCacheId("map square y", mapY);
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
        seqIds: canonicalIds("seq", ids.seqIds),
        spotAnimIds: canonicalIds("spot anim", ids.spotAnimIds),
    } as CacheRoots;
}
