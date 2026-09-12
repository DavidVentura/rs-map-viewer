import { CacheInfo } from "./CacheInfo";
import { CacheSystem } from "./CacheSystem";

// A cache the loaders can read: what it is and its indices, over decoded archives, so its map
// archives need no keys.
export type LoadedCache = {
    readonly info: CacheInfo;
    readonly system: CacheSystem;
};
