import { canonicalCacheRoots } from "./CacheRoots";

describe("canonicalCacheRoots", () => {
    it("dedupes and sorts every id list", () => {
        const roots = canonicalCacheRoots({
            mapSquares: [],
            npcTypeIds: [3127, 2189, 3127],
            objTypeIds: [882, 21003, 882, 1],
            seqIds: [2659, 426, 2659],
            spotAnimIds: [451, 449, 450, 449],
        });
        expect(roots.npcTypeIds).toEqual([2189, 3127]);
        expect(roots.objTypeIds).toEqual([1, 882, 21003]);
        expect(roots.seqIds).toEqual([426, 2659]);
        expect(roots.spotAnimIds).toEqual([449, 450, 451]);
    });

    it("orders map squares by x then y and drops repeats", () => {
        const roots = canonicalCacheRoots({
            mapSquares: [
                { mapX: 38, mapY: 78 },
                { mapX: 37, mapY: 80 },
                { mapX: 37, mapY: 78 },
                { mapX: 38, mapY: 78 },
            ],
            npcTypeIds: [],
            objTypeIds: [],
            seqIds: [],
            spotAnimIds: [],
        });
        expect(roots.mapSquares).toEqual([
            { mapX: 37, mapY: 78 },
            { mapX: 37, mapY: 80 },
            { mapX: 38, mapY: 78 },
        ]);
    });

    it("produces identical values for the same id sets in any order", () => {
        const a = canonicalCacheRoots({
            mapSquares: [
                { mapX: 50, mapY: 50 },
                { mapX: 49, mapY: 50 },
            ],
            npcTypeIds: new Set([1, 2, 3]),
            objTypeIds: [5, 4],
            seqIds: [9, 8, 9],
            spotAnimIds: [7],
        });
        const b = canonicalCacheRoots({
            mapSquares: [
                { mapX: 49, mapY: 50 },
                { mapX: 50, mapY: 50 },
                { mapX: 49, mapY: 50 },
            ],
            npcTypeIds: [3, 2, 1, 1],
            objTypeIds: [4, 5],
            seqIds: [8, 9],
            spotAnimIds: [7, 7],
        });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it.each([-1, 1.5, NaN])("rejects %p as an id", (id) => {
        expect(() =>
            canonicalCacheRoots({
                mapSquares: [],
                npcTypeIds: [],
                objTypeIds: [],
                seqIds: [id],
                spotAnimIds: [],
            }),
        ).toThrow();
    });
});
