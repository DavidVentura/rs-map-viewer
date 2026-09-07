import { CacheInfo } from "../CacheInfo";
import { CacheBundle, CacheBundleEntry, decodeCacheBundle, encodeCacheBundle } from "./CacheBundle";

const CACHE_INFO: CacheInfo = {
    name: "osrs-240_2026-09-02",
    game: "oldschool",
    environment: "live",
    revision: 240,
    timestamp: "2026-09-02T10:30:06.395938Z",
    size: 190440869,
};

function makeEntry(indexId: number, archiveId: number, bytes: number[]): CacheBundleEntry {
    return { indexId, archiveId, data: Int8Array.from(bytes) };
}

function makeBundle(entries: CacheBundleEntry[]): CacheBundle {
    return {
        header: {
            encounterId: "fightcaves",
            cacheInfo: CACHE_INFO,
            indexIds: [0, 2, 5],
            xteas: { "9494": [1, 2, 3, 4] },
        },
        entries,
    };
}

describe("CacheBundle", () => {
    it("round trips header and entries", () => {
        const bundle = makeBundle([
            makeEntry(2, 10, [1, 2, 3, 4, 5]),
            makeEntry(5, 9494, [255, 0, 128, 6]),
            makeEntry(255, 0, [9, 8, 7]),
        ]);

        const decoded = decodeCacheBundle(encodeCacheBundle(bundle).buffer);

        expect(decoded.header).toEqual(bundle.header);
        expect(decoded.entries).toHaveLength(bundle.entries.length);

        const byKey = new Map(decoded.entries.map((e) => [`${e.indexId}:${e.archiveId}`, e]));
        for (const entry of bundle.entries) {
            const found = byKey.get(`${entry.indexId}:${entry.archiveId}`);
            expect(found).toBeDefined();
            expect(Array.from(found!.data)).toEqual(Array.from(entry.data));
        }
    });

    it("round trips an entry whose data view is offset into a larger shared buffer", () => {
        const shared = new Int8Array([9, 9, 1, 2, 3, 4, 9, 9]);
        const view = shared.subarray(2, 6); // [1, 2, 3, 4], byteOffset === 2
        const bundle = makeBundle([{ indexId: 9, archiveId: 1, data: view }]);

        const decoded = decodeCacheBundle(encodeCacheBundle(bundle).buffer);
        expect(Array.from(decoded.entries[0].data)).toEqual([1, 2, 3, 4]);
    });

    it("is deterministic regardless of entry order", () => {
        const a = makeBundle([makeEntry(5, 2, [1, 2]), makeEntry(2, 10, [3, 4])]);
        const b = makeBundle([makeEntry(2, 10, [3, 4]), makeEntry(5, 2, [1, 2])]);

        expect(encodeCacheBundle(a)).toEqual(encodeCacheBundle(b));
    });

    it("throws on a bad magic number", () => {
        const bad = new ArrayBuffer(16);
        expect(() => decodeCacheBundle(bad)).toThrow(/bad magic/);
    });

    it("throws on an unsupported format version", () => {
        const bundle = makeBundle([makeEntry(0, 0, [1])]);
        const bytes = encodeCacheBundle(bundle);
        const view = new DataView(bytes.buffer);
        view.setUint32(4, 999);
        expect(() => decodeCacheBundle(bytes.buffer)).toThrow(/format version/);
    });
});
