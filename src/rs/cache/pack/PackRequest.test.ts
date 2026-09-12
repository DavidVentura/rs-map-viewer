import { canonicalCacheRoots } from "./CacheRoots";
import { canonicalPackRequest, parsePackRequest } from "./PackRequest";

const ROOTS = canonicalCacheRoots({
    mapSquares: [
        { mapX: 50, mapY: 50 },
        { mapX: 49, mapY: 50 },
    ],
    npcTypeIds: [3127],
    objTypeIds: [],
    locTypeIds: [],
    seqIds: [426],
    spotAnimIds: [],
});

describe("canonicalPackRequest", () => {
    it("orders and dedupes the spawn squares", () => {
        const request = canonicalPackRequest({
            roots: ROOTS,
            npcSpawnSquares: [
                { mapX: 50, mapY: 50 },
                { mapX: 49, mapY: 50 },
                { mapX: 50, mapY: 50 },
            ],
            objSpawnSquares: [{ mapX: 49, mapY: 50 }],
        });
        expect(request.npcSpawnSquares).toEqual([
            { mapX: 49, mapY: 50 },
            { mapX: 50, mapY: 50 },
        ]);
        expect(request.objSpawnSquares).toEqual([{ mapX: 49, mapY: 50 }]);
    });

    it("refuses spawn squares the roots do not declare", () => {
        expect(() =>
            canonicalPackRequest({
                roots: ROOTS,
                npcSpawnSquares: [],
                objSpawnSquares: [{ mapX: 51, mapY: 50 }],
            }),
        ).toThrow(/objSpawnSquares holds 51,50, which is not a root square/);
    });
});

describe("parsePackRequest", () => {
    const valid = {
        roots: {
            mapSquares: [
                { mapX: 50, mapY: 50 },
                { mapX: 49, mapY: 50 },
            ],
            npcTypeIds: [3127, 3127],
            objTypeIds: [],
            locTypeIds: [],
            seqIds: [426],
            spotAnimIds: [],
        },
        npcSpawnSquares: [],
        objSpawnSquares: [
            { mapX: 50, mapY: 50 },
            { mapX: 49, mapY: 50 },
        ],
    };

    it("parses a request in any order into its canonical form", () => {
        expect(parsePackRequest(JSON.parse(JSON.stringify(valid)))).toEqual({
            kind: "REQUEST",
            request: canonicalPackRequest({
                roots: ROOTS,
                npcSpawnSquares: [],
                objSpawnSquares: ROOTS.mapSquares,
            }),
        });
    });

    it("round-trips a canonical request through JSON", () => {
        const request = canonicalPackRequest({
            roots: ROOTS,
            npcSpawnSquares: ROOTS.mapSquares,
            objSpawnSquares: ROOTS.mapSquares,
        });
        expect(parsePackRequest(JSON.parse(JSON.stringify(request)))).toEqual({
            kind: "REQUEST",
            request,
        });
    });

    it.each([
        ["a non-object", [], /not an object/],
        ["null", null, /not an object/],
        ["an unknown field", { ...valid, ambientNpcs: true }, /Unexpected pack request field/],
        ["missing roots", { ...valid, roots: undefined }, /roots: Cache roots are not an object/],
        [
            "malformed roots",
            { ...valid, roots: { ...valid.roots, seqIds: [-1] } },
            /roots: seqIds\[0\]: Invalid seqIds cache root -1/,
        ],
        [
            "a missing spawn square list",
            { ...valid, npcSpawnSquares: undefined },
            /npcSpawnSquares is not an array/,
        ],
        [
            "a malformed spawn square",
            { ...valid, objSpawnSquares: [{ mapX: 50 }] },
            /objSpawnSquares\[0\]: Invalid map square y cache root undefined/,
        ],
        [
            "a spawn square outside the roots",
            { ...valid, npcSpawnSquares: [{ mapX: 1, mapY: 1 }] },
            /npcSpawnSquares holds 1,1, which is not a root square/,
        ],
    ])("refuses %s with a reason", (_, json, reason) => {
        const parsed = parsePackRequest(json);
        expect(parsed.kind).toBe("INVALID");
        expect(parsed.kind === "INVALID" && parsed.reason).toMatch(reason);
    });
});
