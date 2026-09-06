# Music playback: findings and options

Investigated against cache `osrs-240_2026-09-02` (revision 240).

## Where the data lives

- **Track audio**: index 6 (`IndexType.DAT2.musicTracks`), 882 archives with one file each. The files are not standard MIDI. Jagex uses its own compact encoding: a per-event type/channel byte stream with delta-time varints and separate delta-encoded parameter arrays per event type and controller. The real client's `MusicTrack(Buffer)` constructor (RuneLite's deobfuscated `MusicTrack.java`) transcodes this into a standard MIDI byte stream in memory before handing it to `MidiFileReader` / `MidiPcmStream`. That transcode is ported to TypeScript in `scripts/cache/export-music.ts`.
- **Jingles**: index 11, same encoding.
- **Instrument samples / soundbank**: indices 14 (sound effects) and 15 (instruments), in Jagex's `MusicPatch` format (raw PCM samples plus envelope parameters).
- **Track list and area mapping**: config index 2, DBTable and DBRow config types (`ConfigType.OSRS.dbTable` = 39, `ConfigType.OSRS.dbRow` = 38). This is DBTable id 44 (Music) as named in RuneLite's `DBTableID.Music`, with columns `SORTNAME`, `DISPLAYNAME`, `UNLOCKHINT` (strings), `DURATION` (int), `MIDI` (int, the track archive id in index 6), `AREA` and `AREA_DEFAULT` (int area ids). The repo had no dbtable/dbrow loader; `export-music.ts` re-implements RuneLite's `DBRowLoader` / `DBTableLoader` opcode format against the repo's `ByteBuffer` and `Archive` classes. `IndexType.OSRS.dbTableIndex` (21) is a different index and is unrelated.
- The area id groups tracks by zone (area 1 is Lumbridge's "Harmony", area 4 is Varrock's "Adventure") but the further area-id to region-rectangle table was not identified. Tracks were matched to zones through each row's `UNLOCKHINT` text cross-checked with the OSRS Wiki's music-by-location pages, which is enough for fixed encounters but not for a general region-to-track lookup.
- The legacy enums historically used for this (1351, 1345) exist in the cache but are empty: dead in modern revisions.

## Tracks identified

| Zone | Track | DBRow | MIDI archive |
|---|---|---|---|
| Lumbridge (map square 50,50) | Harmony | 2777 | 76 |
| TzHaar Fight Caves (map square 37,79) | TzHaar! | 3168 | 473 |

`scripts/cache/export-music.ts` resolves both rows by name, transcodes each track to a standard MIDI file (format 1; 14 and 15 tracks respectively), validates chunk structure, and writes them to `/home/david/rs-music/`. Both pass `file(1)`'s "Standard MIDI data" detection. No `timidity` or `fluidsynth` binary is installed locally, so audio rendering was not verified by ear, only structurally. General MIDI soundfonts exist under `/usr/share/sounds/sf2/` and `libfluidsynth3` is installed as a runtime library.

## Playback options

1. **Port Jagex's synth** (`MusicPatch` about 580 lines plus `MidiPcmStream` about 1650 lines of decompiled custom envelope and resampling DSP over the raw PCM samples in indices 14 and 15). Tractable but large: comparable to writing a small sampler synth from scratch, on top of reverse-engineering the `MusicPatch` binary format the way `MusicTrack` was, plus real-time Web Audio / AudioWorklet integration. Rough estimate: several weeks for one engineer.
2. **Generic soft synth plus a General MIDI soundfont** (recommended first step). Now that valid standard MIDI exists, feed it to a browser synth. `spessasynth_lib` (Apache-2.0, pure JS/TS, runs in an AudioWorklet, no native WASM dependency) is a good fit: the library is a few hundred kilobytes minified, the soundfont dominates size (a compact GM bank such as `TimGM6mb.sf2` is about 6 MB). `js-synthesizer` (FluidSynth compiled to WASM, LGPL) is a solid alternative. Web Audio needs a user gesture before playback starts. This will not sound authentically OSRS: generic GM timbres, which matches the community's experience with dumped tracks.
3. **Authentic middle ground**: convert the patches in indices 14 and 15 into a standard SoundFont offline, then play with option 2. A community project has produced an "OSRS Soundfont" SF2 from this exact cache data (distributed informally, redistribution licensing unclear), which confirms the conversion is feasible as a one-time format conversion rather than a real-time synth port. Reasonable follow-up if authentic instrument timbre matters.

## OSRS soundfont (provided by the project owner)

- `CypherNL/OSRS-MIDI-Player` on GitHub is a Java desktop MIDI player that uses a community "OSRS Soundbank v1.3" SoundFont (`OSRS.sf2`, distributed via Google Drive, fork of an older RuneScape MIDI player; no explicit license in the repo, soundfont origin undocumented). It confirms the approach in option 3: authentic timbre comes from an SF2 built from the cache patches, played by any standard synth.
- A copy is at `/home/david/rs-music/Old_School_RuneScape.sf2` (32 MB, RIFF header verified). At that size it is too large to ship to every visitor as is; options are to trim it to the presets the demo's tracks actually use (the exported MIDIs list their programs) or to serve it compressed and cached, on demand after the first user gesture.
- With this file, option 2 (a JS soft synth in an AudioWorklet such as `spessasynth_lib`) gives authentic playback without porting the client synth.
- **Verified by ear (2026-09-06):** `fluidsynth -ni ~/Downloads/Old_School_RuneScape.sf2 ~/rs-music/lumbridge-harmony.mid` sounds exactly like the game. The exported MIDI transcode is correct and the soundfont is authentic; the only remaining work is the browser synth and track selection.

## Decision (2026-09-06): pre-rendered Opus per encounter

The demo has a fixed track per encounter, so there is no need for a browser synth or for shipping the soundfont. Each encounter's track is exported from the cache, rendered once with `fluidsynth` and the OSRS soundfont, encoded to Opus at 64 kbps with `ffmpeg`, and played with a looping `HTMLAudioElement` started on the first user gesture. See `scripts/cache/render-music.ts` and `src/mapviewer/audio/`.

## Open items

- Pin down the area-id to region mapping so the track follows the loaded region instead of being fixed per encounter.
- A general region-following player (any area, any track) would need the synth route above; not needed for the demo.
- Sound effects (later): OSRS sound effects are not MIDI. They are parametric synth definitions in index 4 rendered by the client's own tone generator (`SoundEffect` / `Synthesizer` in RuneLite), so they would also be rendered once offline (client synth port or capture) rather than played live.
