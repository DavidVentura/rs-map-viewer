import { canonicalCacheRoots, parseCacheRoots } from "./CacheRoots";

describe("canonicalCacheRoots", () => {
    it("dedupes and sorts every id list", () => {
        const roots = canonicalCacheRoots({
            mapSquares: [],
            npcTypeIds: [3127, 2189, 3127],
            objTypeIds: [882, 21003, 882, 1],
            locTypeIds: [375, 378, 375],
            seqIds: [2659, 426, 2659],
            spotAnimIds: [451, 449, 450, 449],
            spriteIds: [299, 33, 299],
        });
        expect(roots.npcTypeIds).toEqual([2189, 3127]);
        expect(roots.objTypeIds).toEqual([1, 882, 21003]);
        expect(roots.locTypeIds).toEqual([375, 378]);
        expect(roots.seqIds).toEqual([426, 2659]);
        expect(roots.spotAnimIds).toEqual([449, 450, 451]);
        expect(roots.spriteIds).toEqual([33, 299]);
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
            locTypeIds: [],
            seqIds: [],
            spotAnimIds: [],
            spriteIds: [],
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
            locTypeIds: [6],
            seqIds: [9, 8, 9],
            spotAnimIds: [7],
            spriteIds: [10],
        });
        const b = canonicalCacheRoots({
            mapSquares: [
                { mapX: 49, mapY: 50 },
                { mapX: 50, mapY: 50 },
                { mapX: 49, mapY: 50 },
            ],
            npcTypeIds: [3, 2, 1, 1],
            objTypeIds: [4, 5],
            locTypeIds: [6, 6],
            seqIds: [8, 9],
            spotAnimIds: [7, 7],
            spriteIds: [10, 10],
        });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it.each([-1, 1.5, NaN])("rejects %p as an id", (id) => {
        expect(() =>
            canonicalCacheRoots({
                mapSquares: [],
                npcTypeIds: [],
                objTypeIds: [],
                locTypeIds: [],
                seqIds: [id],
                spotAnimIds: [],
                spriteIds: [],
            }),
        ).toThrow();
    });
});

describe("parseCacheRoots", () => {
    const valid = {
        mapSquares: [
            { mapX: 38, mapY: 78 },
            { mapX: 37, mapY: 78 },
        ],
        npcTypeIds: [3127, 2189, 3127],
        objTypeIds: [],
        locTypeIds: [375, 378],
        seqIds: [426],
        spotAnimIds: [451, 449],
        spriteIds: [299],
    };

    it("parses roots in any order into their canonical form", () => {
        expect(parseCacheRoots(JSON.parse(JSON.stringify(valid)))).toEqual({
            kind: "ROOTS",
            roots: canonicalCacheRoots(valid),
        });
    });

    it("round-trips canonical roots through JSON", () => {
        const roots = canonicalCacheRoots(valid);
        expect(parseCacheRoots(JSON.parse(JSON.stringify(roots)))).toEqual({
            kind: "ROOTS",
            roots,
        });
    });

    it.each([
        ["a non-object", [], /not an object/],
        ["null", null, /not an object/],
        ["an unknown field", { ...valid, extra: [] }, /Unexpected cache roots field extra/],
        ["a missing list", { ...valid, seqIds: undefined }, /seqIds is not an array/],
        ["a string id", { ...valid, npcTypeIds: ["3127"] }, /Invalid npcTypeIds cache root "3127"/],
        ["a negative id", { ...valid, objTypeIds: [-1] }, /Invalid objTypeIds cache root -1/],
        ["a negative loc id", { ...valid, locTypeIds: [-1] }, /Invalid locTypeIds cache root -1/],
        ["a fractional id", { ...valid, spotAnimIds: [1.5] }, /Invalid spotAnimIds/],
        ["a negative sprite id", { ...valid, spriteIds: [-1] }, /Invalid spriteIds cache root -1/],
        ["a square that is not an object", { ...valid, mapSquares: [5] }, /Invalid map square 5/],
        [
            "a square with an extra field",
            { ...valid, mapSquares: [{ mapX: 1, mapY: 2, level: 0 }] },
            /Unexpected map square field level/,
        ],
        [
            "a square outside the map",
            { ...valid, mapSquares: [{ mapX: 1, mapY: 256 }] },
            /Invalid map square y cache root 256/,
        ],
        [
            "a square missing a coordinate",
            { ...valid, mapSquares: [{ mapX: 1 }] },
            /Invalid map square y cache root undefined/,
        ],
    ])("refuses %s with a reason", (_, json, reason) => {
        const parsed = parseCacheRoots(json);
        expect(parsed.kind).toBe("INVALID");
        expect(parsed.kind === "INVALID" && parsed.reason).toMatch(reason);
    });
});
