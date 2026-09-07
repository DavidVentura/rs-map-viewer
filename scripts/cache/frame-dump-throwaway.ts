import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

function main(): void {
    const [seqArg] = process.argv.slice(2);
    const seqId = Number(seqArg);
    const cacheList = loadCacheList(loadCacheInfos());
    const loadedCache = loadCache(cacheList.latest);
    const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);
    const factory = getCacheLoaderFactory(cacheList.latest, cacheSystem);
    const seqTypeLoader = factory.getSeqTypeLoader();
    const seqFrameLoader = factory.getSeqFrameLoader();
    const seq = seqTypeLoader.load(seqId);
    const frames = seq.frameIds?.length ?? 0;
    let cum = 0;
    let total = 0;
    for (let f = 0; f < frames; f++) {
        total += seq.getFrameLength(seqFrameLoader, f);
    }
    console.log(`seq ${seqId}: ${frames} frames, total ${total} ticks (${total * 20}ms)`);
    for (let f = 0; f < frames; f++) {
        const len = seq.getFrameLength(seqFrameLoader, f);
        console.log(
            `  frame ${String(f).padStart(2)}: len ${String(len).padStart(3)} ticks, starts@ ${String(cum).padStart(3)}t (${(cum * 20).toString().padStart(4)}ms) fracStart=${(cum / total).toFixed(2)}`,
        );
        cum += len;
    }
}

main();
