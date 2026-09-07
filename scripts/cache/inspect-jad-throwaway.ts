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
const seqFrameLoader = cacheLoaderFactory.getSeqFrameLoader();

console.log("=== npc types ===");
for (const id of [3121, 3122, 3123, 3124, 3125, 3126, 3127, 3128, 3129, 3130, 3131]) {
    try {
        const npc = npcTypeLoader.load(id);
        console.log(
            `npc ${id}: name=${JSON.stringify(npc.name)} idle=${npc.idleSeqId} walk=${
                npc.walkSeqId
            } size=${npc.size} combatLevel=${npc.combatLevel}`,
        );
    } catch (e) {
        console.log(`npc ${id}: error ${e}`);
    }
}

function frameArchiveOf(seqId: number): string {
    const seqType = seqTypeLoader.load(seqId);
    if (!seqType || !seqType.frameIds || seqType.frameIds.length === 0) {
        return "none";
    }
    const archives = new Set<number>();
    for (const frameId of seqType.frameIds) {
        archives.add(frameId >>> 16);
    }
    return [...archives].join(",");
}

console.log("=== seq block 2640-2720 ===");
const rigGroups = new Map<string, number[]>();
for (let id = 2640; id <= 2720; id++) {
    const seqType = seqTypeLoader.load(id);
    if (!seqType) {
        console.log(`seq ${id}: missing`);
        continue;
    }
    const frameCount = seqType.frameIds?.length ?? 0;
    let totalDuration = 0;
    for (let i = 0; i < frameCount; i++) {
        totalDuration += seqType.getFrameLength(seqFrameLoader, i);
    }
    const archive = frameArchiveOf(id);
    console.log(
        `seq ${id}: frames=${frameCount} duration=${totalDuration} priority=${seqType.priority} forcedPriority=${seqType.forcedPriority} looping=${seqType.looping} skeletalId=${seqType.skeletalId} archive=${archive}`,
    );
    const key = archive;
    if (!rigGroups.has(key)) {
        rigGroups.set(key, []);
    }
    rigGroups.get(key)!.push(id);
}

console.log("=== grouped by rig/archive ===");
for (const [archive, seqIds] of [...rigGroups.entries()].sort()) {
    console.log(`archive ${archive}: ${seqIds.join(", ")}`);
}
