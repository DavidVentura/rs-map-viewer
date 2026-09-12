/**
 * @jest-environment node
 */
import { promises as fsp } from "fs";
import os from "os";
import path from "path";

import { PackedRoots } from "../rs/cache/pack/CachePacker";
import { CacheRoots, canonicalCacheRoots } from "../rs/cache/pack/CacheRoots";
import { PackResolver, RootsPacker } from "./PackResolver";
import { PackStore, packIdOf } from "./PackStore";

const UNKNOWN_NPC = 99999;

// Packs a root set into bytes naming its ids, and knows every id but UNKNOWN_NPC.
class FakePacker implements RootsPacker {
    readonly packed: CacheRoots[] = [];

    pack(roots: CacheRoots): PackedRoots {
        if (roots.npcTypeIds.includes(UNKNOWN_NPC)) {
            return { kind: "UNKNOWN_ROOT", reason: `No npc type ${UNKNOWN_NPC}` };
        }
        this.packed.push(roots);
        return { kind: "PACKED", bytes: new TextEncoder().encode(JSON.stringify(roots)) };
    }
}

function roots(npcTypeIds: number[]): CacheRoots {
    return canonicalCacheRoots({
        mapSquares: [{ mapX: 37, mapY: 79 }],
        npcTypeIds,
        objTypeIds: [],
        seqIds: [],
        spotAnimIds: [],
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
    const resolver = new PackResolver(store, () => {
        openCount++;
        return packer;
    });
    return { resolver, packer, store, opens: () => openCount };
}

describe("PackResolver", () => {
    it("packs concurrent resolves of the same roots once and gives them one pack id", async () => {
        const { resolver, packer, store } = await openResolver();

        const outcomes = await Promise.all(
            Array.from({ length: 6 }, (_, i) => resolver.resolve(roots(i % 2 ? [1, 2] : [2, 1]))),
        );

        expect(packer.packed).toHaveLength(1);
        const expectedId = packIdOf(new TextEncoder().encode(JSON.stringify(roots([1, 2]))));
        expect(outcomes).toEqual(outcomes.map(() => ({ kind: "PACK", packId: expectedId })));
        await expect(fsp.access(store.packPath(expectedId))).resolves.toBeUndefined();
    });

    it("answers a repeat from memory without packing again", async () => {
        const { resolver, packer } = await openResolver();
        const first = await resolver.resolve(roots([3]));

        const second = await resolver.resolve(roots([3]));

        expect(second).toEqual(first);
        expect(packer.packed).toHaveLength(1);
    });

    it("opens the cache once, on the first resolve", async () => {
        const { resolver, opens } = await openResolver();
        expect(opens()).toBe(0);

        await Promise.all([resolver.resolve(roots([4])), resolver.resolve(roots([5]))]);
        await resolver.resolve(roots([6]));

        expect(opens()).toBe(1);
    });

    it("reports roots the cache does not know without writing a pack", async () => {
        const { resolver, packer, store } = await openResolver();

        const outcome = await resolver.resolve(roots([UNKNOWN_NPC]));

        expect(outcome).toEqual({ kind: "UNKNOWN_ROOT", reason: `No npc type ${UNKNOWN_NPC}` });
        expect(packer.packed).toHaveLength(0);
        expect(await fsp.readdir(store.dir)).toEqual([]);
    });
});
