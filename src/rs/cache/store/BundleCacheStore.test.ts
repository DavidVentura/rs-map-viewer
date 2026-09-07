import { CacheInfo } from "../CacheInfo";
import { CacheBundle } from "../bundle/CacheBundle";
import { BundleCacheStore } from "./BundleCacheStore";

const CACHE_INFO: CacheInfo = {
    name: "osrs-240_2026-09-02",
    game: "oldschool",
    environment: "live",
    revision: 240,
    timestamp: "2026-09-02T10:30:06.395938Z",
    size: 190440869,
};

function makeBundle(): CacheBundle {
    return {
        header: {
            encounterId: "fightcaves",
            cacheInfo: CACHE_INFO,
            indexIds: [2, 5],
            xteas: {},
        },
        entries: [
            { indexId: 2, archiveId: 10, data: Int8Array.from([1, 2, 3]) },
            { indexId: 5, archiveId: 9494, data: Int8Array.from([4, 5]) },
        ],
    };
}

describe("BundleCacheStore", () => {
    it("serves reads for entries present in the bundle", () => {
        const store = new BundleCacheStore(makeBundle());

        expect(Array.from(store.read(2, 10))).toEqual([1, 2, 3]);
        expect(Array.from(store.read(5, 9494))).toEqual([4, 5]);
    });

    it("throws naming the index and archive for a read outside the bundle", () => {
        const store = new BundleCacheStore(makeBundle());

        expect(() => store.read(2, 999)).toThrow(/index 2/);
        expect(() => store.read(2, 999)).toThrow(/archive 999/);
    });

    it("throws for an entirely unknown index", () => {
        const store = new BundleCacheStore(makeBundle());

        expect(() => store.read(7, 0)).toThrow(/index 7/);
    });
});
