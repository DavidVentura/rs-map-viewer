# Smaller caches per encounter

Assessment from 2026-09-11 of how the app loads the OSRS cache, what the per-encounter bundles
already do, and how to make small caches the normal path.

## What loads today

- `MapViewerApp.tsx` picks the latest cache and fetches `main_file_cache.dat2` (227 MB) plus
  every `idx` file through `CacheFiles.fetchDat2`. Everything is stored in Cache Storage in 1%
  parts so the download is resumable; a second visit reads the 227 MB back into a
  `SharedArrayBuffer`.
- The main thread and each of the four render workers build their own `CacheSystem` over that
  buffer. `initTextureArray` decodes every texture at startup.
- Bundles are tried first only in production builds or with `?bundle=1`, via
  `loadCacheBundle` in `Caches.ts`. Any non-OK response falls back to the full cache silently.
  Dev mode never loads a bundle.
- All decoders are synchronous: `CacheStore.read(index, archive)` returns the compressed
  container bytes. The async index variants in `CacheIndex.ts` have no users.
- The stash `experiment: cache range streaming` fetched 1 MiB windows of the dat2 with
  synchronous XHR through a service worker. It over-fetches because an encounter's archives are
  scattered across the file, blocks the main thread, and still pulls every reference table at
  startup.

## What a bundle is

`src/rs/cache/bundle/CacheBundle.ts`: an `RSCB` header (cache info, index ids, xteas), a table
of `(index, archive, offset, length)`, then the raw compressed containers exactly as stored in
the dat2. No recompression. `BundleCacheStore` serves reads from a map and throws on any archive
the bundle does not contain.

Built outputs under `caches/bundles/` (gitignored):

| Encounter | Size | Entries |
|---|---|---|
| fightcaves | 4.6 MB | 824 |
| quickcave | 4.5 MB | 812 |
| lumbridge | 5.1 MB | 1727 |

Fight Caves breakdown: config archives 2.0 MB (whole loc/npc/obj/seq tables), sprites 1.1 MB
(every texture, because the renderer preloads all of them), reference tables 1.1 MB, models
218 KB, maps 110 KB, animations 35 KB. Encounter-specific data is about 370 KB; the rest is the
floor set by archive granularity and the texture preload, not by the encounter.

## Why building is slow and why it is bypassed

`scripts/cache/bundle-encounter.ts` discovers what to include by running the real loaders against
a `RecordingCacheStore`: scene build for every declared square padded to its 3x3 neighbourhood
(24 squares for Fight Caves) including minimap rendering, the full actor bake for every enemy type
and player style, and decoding all textures. On top of that `load-util.ts` reads the 227 MB file
and copies it byte by byte in a JS loop, once per encounter. The `prebuild` hook runs all of this
on every production build, and the staleness hash covers so much source that nearly any edit
marks every bundle stale.

At the time of writing all three bundles are stale and `sandbox` has none, so a production build
would fall back to the full cache for sandbox and throw on the others.

## Does the storage format need to change

No. The dat2 and idx files already give random access by `(index, archive)`, and the bundle
format already extracts only what is needed. Re-serving the cache as per-group static files is
the only option that changes storage, and it cannot go below the bundle floor.

Fetching exact byte ranges from the client is possible with the existing format (the dev server
and `fetchCachedFile` already use Range requests) but an encounter is a few hundred to a couple
of thousand archives, each a chain of scattered 520-byte sectors, so it is either thousands of
requests or large over-fetching windows. Pre-generated bundles win.

## Options

| Option | Work | Download | Storage change | Risk |
|---|---|---|---|---|
| Lazy Range fetch on dat2 (the stash) | async store or sync XHR in workers, main-thread strategy, SW cache | 1 MB of idx plus whatever windows are touched, realistically tens of MB | no | high: blocking, request storms, unbounded reads |
| Per-group static files plus manifest | build script plus an async or prefetching store | same floor as bundles | yes | medium: many files, hosting |
| Fix the existing bundles | separate discovery from extraction, load dat2 once, drop prebuild, add sandbox | 4.6 MB now, about half after trimming | no | low |
| Hybrid: core bundle plus lazy misses | the above plus a miss path | 4.6 MB first paint | partial | medium: misses must be prefetched, decoders are sync |

## Recommended design

Separate what an encounter needs from how the bytes get to the client.

1. **Manifest per encounter.** A committed list of `(index, archive)` pairs per encounter, one
   file each. This is the "set of index entries per type" idea. It is produced by recording real
   reads, not by hand.
2. **Extraction is cheap.** `npm run bundles` becomes a pure extraction: open the dat2 once as a
   `Buffer` view shared across encounters, copy the listed containers, write the bundle. Seconds,
   not minutes. Discovery runs only when explicitly asked.
3. **Staleness is detected at runtime, not by a hash.** In dev the app keeps running on the full
   cache, but the `CacheStore` is wrapped in the recorder and every read outside the committed
   manifest logs a bundle miss with the index and archive. Forgetting to re-record becomes
   visible the first time the missing thing is touched, during normal development, rather than
   in production. A leva button or console call exports the recorded set to update the manifest.
4. **Dev endpoint (optional).** Once extraction is cheap, the craco dev server can serve
   `/caches/bundles/<encounter>.bin` by extracting from the manifest on request, so dev can also
   run on the bundle path with `?bundle=1` and exercise `BundleCacheStore`'s throw-on-miss. It
   does not need to track anything itself; the manifest is the tracking.
5. **Production.** Build from the manifests, no discovery, no `prebuild` surprise. Serve
   `caches/bundles/` alongside `build/`.

Independent size wins after that: trim `header.indexIds` to the indices actually read, and stop
`initTextureArray` preloading every texture (record the texture ids an encounter uses instead).
Reference tables and sprites are about half of the current bundle.

## First step

Split `bundle-encounter.ts` into `record` (runs the loaders with `RecordingCacheStore`, writes
the manifest) and `extract` (manifest to bundle). Replace the byte-copy loop in `load-util.ts`
with a single `Buffer` to `ArrayBuffer` view. Add the sandbox encounter. Then wire the dev-mode
miss logging.
