import { ApiType } from "./ApiType";
import { CacheIndex, CacheIndexDat2 } from "./CacheIndex";
import { ArchiveStore } from "./store/ArchiveStore";

export class CacheSystem<A extends ApiType = ApiType.SYNC> {
    // Builds a dat2 CacheSystem over decoded archives: a PackCacheStore's, or a Dat2ArchiveStore's
    // decoding the full cache's containers.
    static fromStore(store: ArchiveStore, indexIds: readonly number[]): CacheSystem {
        const indices: (CacheIndex | undefined)[] = [];
        for (const id of indexIds) {
            indices[id] = CacheIndexDat2.fromStore(id, store);
        }
        return new CacheSystem(indices);
    }

    constructor(readonly indices: (CacheIndex<A> | undefined)[]) {}

    indexExists(indexId: number): boolean {
        return !!this.indices[indexId];
    }

    getIndex(indexId: number): CacheIndex<A> {
        const index = this.indices[indexId];
        if (!index) {
            throw new Error("Index not found: " + indexId);
        }
        return index;
    }
}
