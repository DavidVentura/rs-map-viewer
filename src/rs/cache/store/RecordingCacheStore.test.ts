import { ApiType } from "../ApiType";
import { CacheStore } from "./CacheStore";
import { RecordingCacheStore } from "./RecordingCacheStore";

class FakeCacheStore implements CacheStore<ApiType.SYNC> {
    readonly reads: { indexId: number; archiveId: number }[] = [];

    constructor(private readonly data: Map<string, Int8Array>) {}

    read(indexId: number, archiveId: number): Int8Array {
        this.reads.push({ indexId, archiveId });
        const data = this.data.get(`${indexId}:${archiveId}`);
        if (!data) {
            throw new Error(`no data for ${indexId}:${archiveId}`);
        }
        return data;
    }
}

describe("RecordingCacheStore", () => {
    it("delegates reads to the inner store and returns its data", () => {
        const inner = new FakeCacheStore(new Map([["2:5", Int8Array.from([1, 2, 3])]]));
        const recording = new RecordingCacheStore(inner);

        expect(Array.from(recording.read(2, 5))).toEqual([1, 2, 3]);
    });

    it("records every distinct successful (indexId, archiveId) read", () => {
        const inner = new FakeCacheStore(
            new Map([
                ["2:5", Int8Array.from([1])],
                ["2:6", Int8Array.from([2])],
                ["255:2", Int8Array.from([3])],
            ]),
        );
        const recording = new RecordingCacheStore(inner);

        recording.read(2, 5);
        recording.read(2, 6);
        recording.read(255, 2);

        expect(recording.recordedReads).toEqual(
            expect.arrayContaining([
                { indexId: 2, archiveId: 5 },
                { indexId: 2, archiveId: 6 },
                { indexId: 255, archiveId: 2 },
            ]),
        );
        expect(recording.recordedReads).toHaveLength(3);
    });

    it("does not record the same (indexId, archiveId) pair twice", () => {
        const inner = new FakeCacheStore(new Map([["2:5", Int8Array.from([1])]]));
        const recording = new RecordingCacheStore(inner);

        recording.read(2, 5);
        recording.read(2, 5);
        recording.read(2, 5);

        expect(recording.recordedReads).toEqual([{ indexId: 2, archiveId: 5 }]);
        expect(inner.reads).toHaveLength(3);
    });

    it("does not record a failed read", () => {
        const inner = new FakeCacheStore(new Map());
        const recording = new RecordingCacheStore(inner);

        expect(() => recording.read(2, 5)).toThrow();
        expect(recording.recordedReads).toHaveLength(0);
    });
});
