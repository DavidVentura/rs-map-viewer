import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { Archive } from "../../src/rs/cache/Archive";
import { CacheIndex } from "../../src/rs/cache/CacheIndex";
import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { ConfigType } from "../../src/rs/cache/ConfigType";
import { IndexType } from "../../src/rs/cache/IndexType";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";
import { COL_MIDI, convertJagexTrackToStandardMidi, findMusicRowByName } from "./musicTranscode";

const SOUNDFONT_PATH = "/home/david/rs-music/Old_School_RuneScape.sf2";
const OUT_DIR = path.join(__dirname, "../../public/audio");
const OPUS_BITRATE = "64k";
const SAMPLE_RATE = "48000";
// Only trims trailing silence: reversing, removing leading silence, then reversing back leaves
// the track's actual start untouched.
const TRIM_TRAILING_SILENCE_FILTER =
    "areverse,silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB,areverse";

type Track = {
    readonly dbRowName: string;
    readonly outFile: string;
};

const TRACKS: readonly Track[] = [
    { dbRowName: "Harmony", outFile: "harmony.opus" },
    { dbRowName: "TzHaar!", outFile: "tzhaar.opus" },
];

function transcodeTrack(dbRowArchive: Archive, musicIndex: CacheIndex, dbRowName: string): Buffer {
    const { rowId, row } = findMusicRowByName(dbRowArchive, dbRowName);
    const midiTrackId = row.columnValues[COL_MIDI]?.[0] as number;
    console.log(`"${dbRowName}" -> dbrow ${rowId}, musicTracks archive id ${midiTrackId}`);

    const archive = musicIndex.getArchive(midiTrackId);
    const file = archive.getFile(archive.fileIds[0]);
    if (!file) {
        throw new Error(`Track ${midiTrackId} has no file data`);
    }

    return convertJagexTrackToStandardMidi(file.data);
}

function renderTrackToOpus(midi: Buffer, outFile: string): void {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-music-"));
    const midPath = path.join(tmpDir, "track.mid");
    const wavPath = path.join(tmpDir, "track.wav");
    try {
        fs.writeFileSync(midPath, midi);

        execFileSync("fluidsynth", [
            "-ni",
            SOUNDFONT_PATH,
            midPath,
            "-F",
            wavPath,
            "-r",
            SAMPLE_RATE,
        ]);

        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        execFileSync("ffmpeg", [
            "-y",
            "-i",
            wavPath,
            "-af",
            TRIM_TRAILING_SILENCE_FILTER,
            "-c:a",
            "libopus",
            "-b:a",
            OPUS_BITRATE,
            outFile,
        ]);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function main() {
    const caches = loadCacheInfos();
    const cacheList = loadCacheList(caches);
    const cacheInfo = cacheList.latest;
    console.log(`Using cache ${cacheInfo.name} (revision ${cacheInfo.revision})`);

    const loadedCache = loadCache(cacheInfo);
    const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);

    const configIndex = cacheSystem.getIndex(IndexType.DAT2.configs);
    const dbRowArchive = configIndex.getArchive(ConfigType.OSRS.dbRow);
    const musicIndex = cacheSystem.getIndex(IndexType.DAT2.musicTracks);

    for (const track of TRACKS) {
        const midi = transcodeTrack(dbRowArchive, musicIndex, track.dbRowName);
        const outFile = path.join(OUT_DIR, track.outFile);
        renderTrackToOpus(midi, outFile);
        const { size } = fs.statSync(outFile);
        console.log(`  wrote ${outFile} (${(size / 1024).toFixed(0)} KiB)`);
    }
}

main();
