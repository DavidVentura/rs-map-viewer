import { XteaMap } from "../map/XteaMap";
import { CacheInfo } from "./CacheInfo";
import { CacheSystem } from "./CacheSystem";

// A cache the loaders can read: what it is, its indices, and the keys of its map archives.
export type LoadedCache = {
    readonly info: CacheInfo;
    readonly system: CacheSystem;
    readonly xteas: XteaMap;
};
