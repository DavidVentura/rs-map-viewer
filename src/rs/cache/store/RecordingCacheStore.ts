import { ApiType } from "../ApiType";
import { CacheStore } from "./CacheStore";

export type CacheReadKey = {
    readonly indexId: number;
    readonly archiveId: number;
};

function readKey(indexId: number, archiveId: number): string {
    return `${indexId}:${archiveId}`;
}

// Wraps a CacheStore and records every successfully read (indexId, archiveId) pair, so a real
// loader run over a cache can be used to discover exactly which archives an encounter touches.
// Failed reads are not recorded: only archives that actually exist are worth bundling.
export class RecordingCacheStore implements CacheStore<ApiType.SYNC> {
    private readonly reads = new Map<string, CacheReadKey>();

    constructor(private readonly inner: CacheStore<ApiType.SYNC>) {}

    read(indexId: number, archiveId: number): Int8Array {
        const data = this.inner.read(indexId, archiveId);
        this.reads.set(readKey(indexId, archiveId), { indexId, archiveId });
        return data;
    }

    get recordedReads(): readonly CacheReadKey[] {
        return Array.from(this.reads.values());
    }
}
