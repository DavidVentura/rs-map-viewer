import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const caches = loadCacheInfos();
const cacheList = loadCacheList(caches);
const cacheInfo = cacheList.latest;
const loadedCache = loadCache(cacheInfo);

const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);
const cacheLoaderFactory = getCacheLoaderFactory(cacheInfo, cacheSystem);

const npcTypeLoader = cacheLoaderFactory.getNpcTypeLoader();
const seqTypeLoader = cacheLoaderFactory.getSeqTypeLoader();

for (let id = 2186; id <= 2212; id++) {
    try {
        const npc = npcTypeLoader.load(id);
        console.log(
            `npc ${id}: name=${JSON.stringify(npc.name)} idle=${npc.idleSeqId} walk=${npc.walkSeqId} combatLevel=${npc.combatLevel}`,
        );
    } catch (e) {
        console.log(`npc ${id}: error`);
    }
}

console.log("=== seq block 2617-2632 ===");
for (let id = 2617; id <= 2632; id++) {
    const seqType = seqTypeLoader.load(id);
    if (!seqType) {
        console.log(`seq ${id}: missing`);
        continue;
    }
    console.log(`seq ${id}: frameCount=${seqType.frameIds?.length ?? 0}`);
}
