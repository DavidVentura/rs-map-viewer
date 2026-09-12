import { ApiType } from "../ApiType";
import { CacheStore } from "../store/CacheStore";
import { CachePack } from "./CachePack";

// Serves a CacheSystem from a pack. A read outside the pack throws naming the index and archive:
// it means the resolver missed an edge, and falling back to anything would hide that.
export class PackCacheStore implements CacheStore<ApiType.SYNC> {
    private readonly archivesByIndex = new Map<number, Map<number, Int8Array>>();

    constructor(pack: CachePack) {
        for (const { indexId, archiveId, data } of pack.entries) {
            let archives = this.archivesByIndex.get(indexId);
            if (!archives) {
                archives = new Map();
                this.archivesByIndex.set(indexId, archives);
            }
            archives.set(archiveId, data);
        }
    }

    read(indexId: number, archiveId: number): Int8Array {
        const data = this.archivesByIndex.get(indexId)?.get(archiveId);
        if (!data) {
            throw new Error(`Cache pack has no data for index ${indexId}, archive ${archiveId}`);
        }
        return data;
    }
}
