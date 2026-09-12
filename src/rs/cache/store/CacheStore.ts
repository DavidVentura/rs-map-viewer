import { ApiReturnType, ApiType } from "../ApiType";

// Archives exactly as a cache's files hold them: in a dat2 cache, containers that may be
// compressed and, for map archives, encrypted.
export interface CacheStore<A extends ApiType> {
    read(indexId: number, archiveId: number): ApiReturnType<A, Int8Array>;
}
