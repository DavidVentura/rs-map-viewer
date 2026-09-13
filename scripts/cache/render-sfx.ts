import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import {
    SFX_DIR,
    SfxClip,
    loadSeqSoundCatalog,
    sfxClipPath,
    sfxClips,
    soundSeqIds,
} from "../../src/mapviewer/audio/FrameSounds";
import { EncounterId, getEncounter } from "../../src/mapviewer/game/Encounter";
import { loadSeqCatalog } from "../../src/mapviewer/game/SeqCatalog";
import { CacheIndex } from "../../src/rs/cache/CacheIndex";
import { IndexType } from "../../src/rs/cache/IndexType";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/getCacheLoaderFactory";
import { openCacheFiles } from "../../src/rs/cache/openCacheFiles";
import { decodeSoundEffect } from "../../src/rs/sound/SoundEffect";
import { SOUND_SAMPLE_RATE, mixSoundEffect, repeatSoundLoop } from "../../src/rs/sound/SoundSynth";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const PUBLIC_DIR = path.join(__dirname, "../../public");
const OPUS_BITRATE = "48k";
const OPUS_SAMPLE_RATE = "48000";

// A mono 8-bit WAV, whose samples are unsigned around 128.
function wavFile(samples: Int8Array): Buffer {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + samples.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SOUND_SAMPLE_RATE, 24);
    header.writeUInt32LE(SOUND_SAMPLE_RATE, 28);
    header.writeUInt16LE(1, 32);
    header.writeUInt16LE(8, 34);
    header.write("data", 36);
    header.writeUInt32LE(samples.length, 40);
    const data = Buffer.from(Uint8Array.from(samples, (sample) => (sample + 128) & 0xff));
    return Buffer.concat([header, data]);
}

function renderClip(soundIndex: CacheIndex, clip: SfxClip): Int8Array {
    const archive = soundIndex.getArchive(clip.soundId);
    const file = archive.getFile(archive.fileIds[0]);
    if (!file) {
        throw new Error(`Sound effect ${clip.soundId} has no file data`);
    }
    const sound = decodeSoundEffect(file.data);
    const samples = repeatSoundLoop(mixSoundEffect(sound), sound.loop, clip.plays);
    if (samples.length === 0) {
        throw new Error(`Sound effect ${clip.soundId} renders to no samples`);
    }
    return samples;
}

function encodeOpus(samples: Int8Array, outFile: string): void {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-sfx-"));
    const wavPath = path.join(tmpDir, "sound.wav");
    try {
        fs.writeFileSync(wavPath, wavFile(samples));
        execFileSync("ffmpeg", [
            "-y",
            "-loglevel",
            "error",
            "-i",
            wavPath,
            "-ar",
            OPUS_SAMPLE_RATE,
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

function main(): void {
    const cacheList = loadCacheList(loadCacheInfos());
    const cacheInfo = cacheList.latest;
    console.log(`Using cache ${cacheInfo.name} (revision ${cacheInfo.revision})`);
    const loadedCache = loadCache(cacheInfo);
    const cacheSystem = openCacheFiles(loadedCache.type, loadedCache.files, loadedCache.xteas);
    const factory = getCacheLoaderFactory(cacheInfo, cacheSystem);
    const skeletalSeqLoader = factory.getSkeletalSeqLoader();
    if (!skeletalSeqLoader) {
        throw new Error(`Cache ${cacheInfo.name} has no skeletal sequences`);
    }
    const loaders = {
        seqTypeLoader: factory.getSeqTypeLoader(),
        seqFrameLoader: factory.getSeqFrameLoader(),
        skeletalSeqLoader,
    };

    const clips = new Map<string, SfxClip>();
    for (const encounterId of Object.values(EncounterId)) {
        const seqIds = soundSeqIds(getEncounter(encounterId));
        const catalog = loadSeqSoundCatalog(
            seqIds,
            loaders.seqTypeLoader,
            loadSeqCatalog(seqIds, loaders),
        );
        const encounterClips = sfxClips(catalog);
        console.log(`${encounterId}: ${encounterClips.length} sounds`);
        for (const clip of encounterClips) {
            clips.set(sfxClipPath(clip), clip);
        }
    }

    // Only what the encounters play now is kept, so a sound nothing plays any more disappears.
    const outDir = path.join(PUBLIC_DIR, SFX_DIR);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const soundIndex = cacheSystem.getIndex(IndexType.DAT2.soundEffects);
    let totalBytes = 0;
    for (const [clipPath, clip] of clips) {
        const outFile = path.join(PUBLIC_DIR, clipPath);
        encodeOpus(renderClip(soundIndex, clip), outFile);
        totalBytes += fs.statSync(outFile).size;
    }
    console.log(`wrote ${clips.size} sounds to ${outDir} (${(totalBytes / 1024).toFixed(0)} KiB)`);
}

main();
