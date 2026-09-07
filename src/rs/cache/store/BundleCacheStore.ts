import { ApiType } from "../ApiType";
import { CacheBundle } from "../bundle/CacheBundle";
import { CacheStore } from "./CacheStore";

function entryKey(indexId: number, archiveId: number): string {
    return `${indexId}:${archiveId}`;
}

// Serves archive reads from a pre-extracted CacheBundle instead of a physical dat2/idx store.
// Any read outside the bundled set throws immediately, naming the missing index/archive, rather
// than silently falling back to anything: a missing entry means the bundle was built wrong.
export class BundleCacheStore implements CacheStore<ApiType.SYNC> {
    private readonly entries: Map<string, Int8Array>;

    constructor(readonly bundle: CacheBundle) {
        this.entries = new Map();
        for (const entry of bundle.entries) {
            this.entries.set(entryKey(entry.indexId, entry.archiveId), entry.data);
        }
    }

    read(indexId: number, archiveId: number): Int8Array {
        const data = this.entries.get(entryKey(indexId, archiveId));
        if (!data) {
            throw new Error(
                `Bundle cache store has no data for index ${indexId}, archive ${archiveId} ` +
                    `(bundle for encounter "${this.bundle.header.encounterId}"). ` +
                    "This read was not recorded when the bundle was built.",
            );
        }
        return data;
    }
}
