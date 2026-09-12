// Builds the cache pack for an encounter and prints what it holds:
//   npx tsx scripts/cache/pack-encounter.ts <encounterId> [output.pack]
import fs from "fs";

import { packRequest } from "../../src/mapviewer/assets/cacheRoots";
import { EncounterId, getEncounter } from "../../src/mapviewer/game/Encounter";
import { CacheIndex } from "../../src/rs/cache/CacheIndex";
import { IndexType } from "../../src/rs/cache/IndexType";
import { CachePack, encodeCachePack } from "../../src/rs/cache/pack/CachePack";
import { CachePackBuilder } from "../../src/rs/cache/pack/CachePackBuilder";
import { CacheSelectionResolver } from "../../src/rs/cache/pack/resolveCacheSelection";
import { Bzip2 } from "../../src/rs/compression/Bzip2";
import { readSourceCache } from "../../src/server/CacheDirectory";
import { readWorldSpawns } from "../../src/server/WorldSpawns";
import { packContents } from "../../src/server/packContents";
import { loadCacheInfos, loadCacheList } from "./load-util";

function parseEncounterId(arg: string | undefined): EncounterId {
    const validIds = Object.values(EncounterId);
    const encounterId = validIds.find((id) => id === arg);
    if (!encounterId) {
        throw new Error(
            `Usage: pack-encounter.ts <encounterId> [output.pack]. Valid ids: ${validIds.join(
                ", ",
            )}`,
        );
    }
    return encounterId;
}

function formatBytes(bytes: number): string {
    return bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
        : `${(bytes / 1024).toFixed(1)} KB`;
}

type Tally = { bytes: number; entries: number };

function tally(tallies: Map<number, Tally>, key: number, bytes: number): void {
    const current = tallies.get(key) ?? { bytes: 0, entries: 0 };
    tallies.set(key, { bytes: current.bytes + bytes, entries: current.entries + 1 });
}

function printBreakdown(pack: CachePack, totalBytes: number): void {
    const byIndex = new Map<number, Tally>();
    const byConfigArchive = new Map<number, Tally>();
    for (const { indexId, archiveId, data } of pack.entries) {
        tally(byIndex, indexId, data.length);
        if (indexId === IndexType.DAT2.configs) {
            tally(byConfigArchive, archiveId, data.length);
        }
    }

    console.log(`total ${formatBytes(totalBytes)}, ${pack.entries.length} entries`);
    for (const [indexId, { bytes, entries }] of [...byIndex].sort(([a], [b]) => a - b)) {
        const label = indexId === CacheIndex.META_INDEX_ID ? "reference tables" : "";
        console.log(
            `  index ${String(indexId).padStart(3)} ${formatBytes(bytes).padStart(10)} ` +
                `${String(entries).padStart(6)} entries ${label}`,
        );
    }
    console.log("  config archives (index 2):");
    for (const [archiveId, { bytes }] of [...byConfigArchive].sort(([a], [b]) => a - b)) {
        console.log(
            `    archive ${String(archiveId).padStart(3)} ${formatBytes(bytes).padStart(10)}`,
        );
    }
}

async function main(): Promise<void> {
    const encounterId = parseEncounterId(process.argv[2]);
    const outputPath = process.argv[3];
    await Bzip2.initWasm();

    const source = readSourceCache("./caches", loadCacheList(loadCacheInfos()).latest);

    const { roots, spawns } = packContents(
        readWorldSpawns(),
        packRequest(getEncounter(encounterId), undefined),
    );

    const resolveStart = performance.now();
    const selection = new CacheSelectionResolver(source).resolve(roots);
    const resolveMs = performance.now() - resolveStart;

    const encodeStart = performance.now();
    const pack: CachePack = { ...new CachePackBuilder(source).build(selection), spawns };
    const bytes = encodeCachePack(pack);
    const encodeMs = performance.now() - encodeStart;

    console.log(
        `${encounterId}: ${roots.mapSquares.length} squares, ${roots.npcTypeIds.length} npcs, ` +
            `${roots.objTypeIds.length} objs, ${roots.seqIds.length} seqs, ` +
            `${roots.spotAnimIds.length} spot anims, ${spawns.npcSpawns.length} npc spawns, ` +
            `${spawns.objSpawns.length} obj spawns`,
    );
    console.log(`resolve ${resolveMs.toFixed(0)} ms, build and encode ${encodeMs.toFixed(0)} ms`);
    printBreakdown(pack, bytes.length);

    if (outputPath) {
        fs.writeFileSync(outputPath, bytes);
        console.log(`wrote ${outputPath}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
