/**
 * @jest-environment node
 */
import { canonicalCacheRoots } from "../rs/cache/pack/CacheRoots";
import { canonicalPackRequest } from "../rs/cache/pack/PackRequest";
import { MapSquareCoord } from "../rs/map/MapSquareCoord";
import { readWorldSpawns } from "./WorldSpawns";
import { packContents } from "./packContents";

const world = readWorldSpawns();

// Lumbridge castle's square and the eight around it, which hold npc and obj spawns.
const LUMBRIDGE_SQUARES: readonly MapSquareCoord[] = [49, 50, 51].flatMap((mapX) =>
    [49, 50, 51].map((mapY) => ({ mapX, mapY })),
);

const ACTOR_NPC_TYPE_ID = 3127;
const ACTOR_OBJ_TYPE_ID = 882;

function request(npcSpawnSquares: readonly MapSquareCoord[]) {
    return canonicalPackRequest({
        roots: canonicalCacheRoots({
            mapSquares: LUMBRIDGE_SQUARES,
            npcTypeIds: [ACTOR_NPC_TYPE_ID],
            objTypeIds: [ACTOR_OBJ_TYPE_ID],
            seqIds: [426],
            spotAnimIds: [],
        }),
        npcSpawnSquares,
        objSpawnSquares: LUMBRIDGE_SQUARES,
    });
}

function isInside(squares: readonly MapSquareCoord[], x: number, y: number): boolean {
    return squares.some(({ mapX, mapY }) => x >> 6 === mapX && y >> 6 === mapY);
}

describe("packContents", () => {
    it("takes the npc and obj spawns inside the spawn squares and none outside them", () => {
        const { spawns } = packContents(world, request(LUMBRIDGE_SQUARES));

        const insideNpcs = world.npcSpawns.filter((s) => isInside(LUMBRIDGE_SQUARES, s.x, s.y));
        const insideObjs = world.objSpawns.filter((s) => isInside(LUMBRIDGE_SQUARES, s.x, s.y));
        expect(insideNpcs.length).toBeGreaterThan(0);
        expect(insideObjs.length).toBeGreaterThan(0);
        expect(insideNpcs.length).toBeLessThan(world.npcSpawns.length);
        expect(spawns.npcSpawns).toEqual(insideNpcs);
        expect(spawns.objSpawns).toEqual(insideObjs);
    });

    it("roots the types of the spawns it takes alongside the request's own roots", () => {
        const { roots, spawns } = packContents(world, request(LUMBRIDGE_SQUARES));

        const spawnNpcIds = new Set(spawns.npcSpawns.map((spawn) => spawn.id));
        const spawnObjIds = new Set(spawns.objSpawns.map((spawn) => spawn.id));
        expect(roots.npcTypeIds).toEqual(
            [...new Set([...spawnNpcIds, ACTOR_NPC_TYPE_ID])].sort((a, b) => a - b),
        );
        expect(roots.objTypeIds).toEqual(
            [...new Set([...spawnObjIds, ACTOR_OBJ_TYPE_ID])].sort((a, b) => a - b),
        );
        expect(roots.mapSquares).toEqual(request([]).roots.mapSquares);
        expect(roots.seqIds).toEqual([426]);
    });

    it("takes no npc spawns, nor roots their types, when no npc spawn squares are asked for", () => {
        const { roots, spawns } = packContents(world, request([]));

        expect(spawns.npcSpawns).toEqual([]);
        expect(roots.npcTypeIds).toEqual([ACTOR_NPC_TYPE_ID]);
        expect(spawns.objSpawns.length).toBeGreaterThan(0);
    });

    it("takes the npc spawns of only the asked squares", () => {
        const square = { mapX: 50, mapY: 50 };
        const { spawns } = packContents(world, request([square]));

        expect(spawns.npcSpawns.length).toBeGreaterThan(0);
        expect(spawns.npcSpawns.every((s) => isInside([square], s.x, s.y))).toBe(true);
    });

    it("keeps spawns above the ground level", () => {
        const { spawns } = packContents(world, request(LUMBRIDGE_SQUARES));

        expect(new Set(spawns.npcSpawns.map((spawn) => spawn.level)).size).toBeGreaterThan(1);
    });
});
