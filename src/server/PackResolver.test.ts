/**
 * @jest-environment node
 */
import { promises as fsp } from "fs";
import os from "os";
import path from "path";

import { PackContents, PackedRoots } from "../rs/cache/pack/CachePacker";
import { canonicalCacheRoots } from "../rs/cache/pack/CacheRoots";
import { PackRequest, canonicalPackRequest } from "../rs/cache/pack/PackRequest";
import { canonicalMapSpawns } from "../rs/map/MapSpawns";
import { PackResolver, RootsPacker } from "./PackResolver";
import { PackStore, packIdOf } from "./PackStore";

const UNKNOWN_NPC = 99999;

const SQUARE = { mapX: 37, mapY: 79 };

const WORLD_SPAWNS = canonicalMapSpawns(
    [{ id: 2, name: "Man", x: 37 * 64 + 5, y: 79 * 64 + 6, level: 0 }],
    [{ id: 995, count: 3, x: 37 * 64 + 1, y: 79 * 64 + 2, plane: 0 }],
);

// Packs contents into bytes naming them, and knows every id but UNKNOWN_NPC.
class FakePacker implements RootsPacker {
    readonly packed: PackContents[] = [];

    pack(contents: PackContents): PackedRoots {
        if (contents.roots.npcTypeIds.includes(UNKNOWN_NPC)) {
            return { kind: "UNKNOWN_ROOT", reason: `No npc type ${UNKNOWN_NPC}` };
        }
        this.packed.push(contents);
        return { kind: "PACKED", bytes: new TextEncoder().encode(JSON.stringify(contents)) };
    }
}

function request(
    npcTypeIds: number[],
    spawns: "NO_SPAWNS" | "OBJ_SPAWNS" = "NO_SPAWNS",
): PackRequest {
    return canonicalPackRequest({
        roots: canonicalCacheRoots({
            mapSquares: [SQUARE],
            npcTypeIds,
            objTypeIds: [],
            seqIds: [],
            spotAnimIds: [],
        }),
        npcSpawnSquares: [],
        objSpawnSquares: spawns === "OBJ_SPAWNS" ? [SQUARE] : [],
    });
}

async function openResolver(): Promise<{
    resolver: PackResolver;
    packer: FakePacker;
    store: PackStore;
    opens: () => number;
}> {
    const store = await PackStore.open(await fsp.mkdtemp(path.join(os.tmpdir(), "resolver-")));
    const packer = new FakePacker();
    let openCount = 0;
    const resolver = new PackResolver(
        store,
        () => {
            openCount++;
            return packer;
        },
        WORLD_SPAWNS,
    );
    return { resolver, packer, store, opens: () => openCount };
}

describe("PackResolver", () => {
    it("packs concurrent resolves of the same request once and gives them one pack id", async () => {
        const { resolver, packer, store } = await openResolver();

        const outcomes = await Promise.all(
            Array.from({ length: 6 }, (_, i) => resolver.resolve(request(i % 2 ? [1, 2] : [2, 1]))),
        );

        expect(packer.packed).toHaveLength(1);
        const expectedId = packIdOf(new TextEncoder().encode(JSON.stringify(packer.packed[0])));
        expect(outcomes).toEqual(outcomes.map(() => ({ kind: "PACK", packId: expectedId })));
        await expect(fsp.access(store.packPath(expectedId))).resolves.toBeUndefined();
    });

    it("answers a repeat from memory without packing again", async () => {
        const { resolver, packer } = await openResolver();
        const first = await resolver.resolve(request([3]));

        const second = await resolver.resolve(request([3]));

        expect(second).toEqual(first);
        expect(packer.packed).toHaveLength(1);
    });

    it("opens the cache once, on the first resolve", async () => {
        const { resolver, opens } = await openResolver();
        expect(opens()).toBe(0);

        await Promise.all([resolver.resolve(request([4])), resolver.resolve(request([5]))]);
        await resolver.resolve(request([6]));

        expect(opens()).toBe(1);
    });

    it("packs the world spawns of the requested squares and roots their types", async () => {
        const { resolver, packer } = await openResolver();

        await resolver.resolve(request([7], "OBJ_SPAWNS"));

        expect(packer.packed).toHaveLength(1);
        const [{ roots, spawns }] = packer.packed;
        expect(spawns).toEqual(canonicalMapSpawns([], WORLD_SPAWNS.objSpawns));
        expect(roots.objTypeIds).toEqual([995]);
        expect(roots.npcTypeIds).toEqual([7]);
    });

    it("tells apart requests that differ only in their spawn squares", async () => {
        const { resolver, packer } = await openResolver();

        const withoutSpawns = await resolver.resolve(request([8]));
        const withSpawns = await resolver.resolve(request([8], "OBJ_SPAWNS"));

        expect(packer.packed).toHaveLength(2);
        expect(withSpawns).not.toEqual(withoutSpawns);
    });

    it("reports roots the cache does not know without writing a pack", async () => {
        const { resolver, packer, store } = await openResolver();

        const outcome = await resolver.resolve(request([UNKNOWN_NPC]));

        expect(outcome).toEqual({ kind: "UNKNOWN_ROOT", reason: `No npc type ${UNKNOWN_NPC}` });
        expect(packer.packed).toHaveLength(0);
        expect(await fsp.readdir(store.dir)).toEqual([]);
    });
});
