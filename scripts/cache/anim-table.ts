import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { NpcType } from "../../src/rs/config/npctype/NpcType";
import { SeqType } from "../../src/rs/config/seqtype/SeqType";
import { SeqFrameLoader } from "../../src/rs/model/seq/SeqFrameLoader";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const DEFAULT_BLOCK_BEFORE = 2;
const DEFAULT_BLOCK_AFTER = 10;
const HELD_LAST_FRAME_TICKS = 100;
const DEATH_PRIORITY = 10;
const HIT_REACTION_PRIORITY = 5;

type SeqRange = { from: number; to: number };

enum SeqRole {
    IDLE = "idle",
    WALK = "walk",
    DEATH = "death?",
    HIT = "hit?",
    ATTACK = "attack/cast?",
}

type SeqRow = {
    seqId: number;
    frames: number;
    totalTicks: number;
    lastFrameTicks: number;
    forcedPriority: number;
    role: SeqRole;
};

function parseArgs(): { npcId: number; range?: SeqRange } {
    const [npcArg, rangeArg] = process.argv.slice(2);
    const npcId = Number(npcArg);
    if (!Number.isInteger(npcId)) {
        throw new Error("Usage: anim-table.ts <npcId> [from-to]");
    }
    if (!rangeArg) {
        return { npcId };
    }
    const match = /^(\d+)-(\d+)$/.exec(rangeArg);
    if (!match) {
        throw new Error("Range must look like 2650-2656");
    }
    return { npcId, range: { from: Number(match[1]), to: Number(match[2]) } };
}

function classify(
    seqId: number,
    npc: NpcType,
    frames: number,
    lastFrameTicks: number,
    forcedPriority: number,
): SeqRole {
    if (seqId === npc.idleSeqId) {
        return SeqRole.IDLE;
    }
    if (seqId === npc.walkSeqId) {
        return SeqRole.WALK;
    }
    if (forcedPriority === DEATH_PRIORITY && lastFrameTicks >= HELD_LAST_FRAME_TICKS) {
        return SeqRole.DEATH;
    }
    if (forcedPriority <= HIT_REACTION_PRIORITY) {
        return SeqRole.HIT;
    }
    return SeqRole.ATTACK;
}

function describeSeq(
    seqId: number,
    seq: SeqType,
    seqFrameLoader: SeqFrameLoader,
    npc: NpcType,
): SeqRow | undefined {
    const frames = seq.frameIds?.length ?? 0;
    if (frames === 0) {
        return undefined;
    }
    let totalTicks = 0;
    for (let frame = 0; frame < frames; frame++) {
        totalTicks += seq.getFrameLength(seqFrameLoader, frame);
    }
    const lastFrameTicks = seq.getFrameLength(seqFrameLoader, frames - 1);
    return {
        seqId,
        frames,
        totalTicks,
        lastFrameTicks,
        forcedPriority: seq.forcedPriority,
        role: classify(seqId, npc, frames, lastFrameTicks, seq.forcedPriority),
    };
}

function main(): void {
    const { npcId, range } = parseArgs();
    const cacheList = loadCacheList(loadCacheInfos());
    const loadedCache = loadCache(cacheList.latest);
    const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);
    const factory = getCacheLoaderFactory(cacheList.latest, cacheSystem);
    const npc = factory.getNpcTypeLoader().load(npcId);
    const seqTypeLoader = factory.getSeqTypeLoader();
    const seqFrameLoader = factory.getSeqFrameLoader();

    const anchor = Math.min(npc.idleSeqId, npc.walkSeqId);
    const block = range ?? {
        from: anchor - DEFAULT_BLOCK_BEFORE,
        to: Math.max(npc.idleSeqId, npc.walkSeqId) + DEFAULT_BLOCK_AFTER,
    };

    console.log(
        `npc ${npcId} "${npc.name}" size ${npc.size} idle ${npc.idleSeqId} walk ${npc.walkSeqId}`,
    );
    console.log(`viewer: ?anim=${npcId}&seqs=${block.from}-${block.to}`);
    console.log("seq    frames  ticks    ms  last  prio  role");
    for (let seqId = block.from; seqId <= block.to; seqId++) {
        const row = describeSeq(seqId, seqTypeLoader.load(seqId), seqFrameLoader, npc);
        if (!row) {
            continue;
        }
        console.log(
            [
                String(row.seqId).padEnd(6),
                String(row.frames).padStart(6),
                String(row.totalTicks).padStart(6),
                String(row.totalTicks * 20).padStart(6),
                String(row.lastFrameTicks).padStart(5),
                String(row.forcedPriority).padStart(5),
                `  ${row.role}`,
            ].join(" "),
        );
    }
}

main();
