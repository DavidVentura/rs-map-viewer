import fs from "fs";
import path from "path";

import { Archive } from "../../src/rs/cache/Archive";
import { CacheIndex } from "../../src/rs/cache/CacheIndex";
import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { ConfigType } from "../../src/rs/cache/ConfigType";
import { IndexType } from "../../src/rs/cache/IndexType";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";
import {
    COL_MIDI,
    convertJagexTrackToStandardMidi,
    findMusicRowByName,
    validateStandardMidi,
} from "./musicTranscode";

function exportTrack(
    dbRowArchive: Archive,
    musicIndex: CacheIndex,
    trackName: string,
    outFile: string,
) {
    const { rowId, row } = findMusicRowByName(dbRowArchive, trackName);
    const midiTrackId = row.columnValues[COL_MIDI]?.[0] as number;
    console.log(`"${trackName}" -> dbrow ${rowId}, musicTracks archive id ${midiTrackId}`);

    const archive = musicIndex.getArchive(midiTrackId);
    const file = archive.getFile(archive.fileIds[0]);
    if (!file) {
        throw new Error(`Track ${midiTrackId} has no file data`);
    }

    const standardMidi = convertJagexTrackToStandardMidi(file.data);
    const info = validateStandardMidi(standardMidi);
    console.log(
        `  converted: ${file.data.length} bytes (jagex format) -> ${standardMidi.length} bytes (standard MIDI), ` +
            `format ${info.format}, ${info.trackChunks} track(s), division ${info.division}`,
    );

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, standardMidi);
    console.log(`  wrote ${outFile}`);
}

function main() {
    const outDir = "/home/david/rs-music";

    const caches = loadCacheInfos();
    const cacheList = loadCacheList(caches);
    const cacheInfo = cacheList.latest;
    console.log(`Using cache ${cacheInfo.name} (revision ${cacheInfo.revision})`);

    const loadedCache = loadCache(cacheInfo);
    const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);

    const configIndex = cacheSystem.getIndex(IndexType.DAT2.configs);
    const dbRowArchive = configIndex.getArchive(ConfigType.OSRS.dbRow);
    const musicIndex = cacheSystem.getIndex(IndexType.DAT2.musicTracks);

    // "Harmony" unlocks "in Lumbridge." and is part of Lumbridge's music pool (region 50,50).
    exportTrack(dbRowArchive, musicIndex, "Harmony", path.join(outDir, "lumbridge-harmony.mid"));
    // "TzHaar!" unlocks "in the TzHaar Fight Cave." (region 37,79 and neighbours).
    exportTrack(dbRowArchive, musicIndex, "TzHaar!", path.join(outDir, "fight-caves-tzhaar.mid"));
}

main();
