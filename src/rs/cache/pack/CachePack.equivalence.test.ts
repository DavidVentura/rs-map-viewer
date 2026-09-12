/**
 * @jest-environment node
 */
import fs from "fs";

import { loadCache, loadCacheInfos, loadCacheList } from "../../../../scripts/cache/load-util";
import { LoadedCache } from "../../../mapviewer/Caches";
import { ViewerLoaders, createViewerLoaders } from "../../../mapviewer/ViewerLoaders";
import { cacheRoots } from "../../../mapviewer/assets/cacheRoots";
import { NpcSpawn } from "../../../mapviewer/data/npc/NpcSpawn";
import { ObjSpawn } from "../../../mapviewer/data/obj/ObjSpawn";
import { AnimPreviewParams } from "../../../mapviewer/game/AnimPreview";
import { sequenceDurationSeconds } from "../../../mapviewer/game/Animation";
import {
    EncounterId,
    buildPreviewEncounter,
    getEncounter,
} from "../../../mapviewer/game/Encounter";
import { ActorRenderDataLoader } from "../../../mapviewer/webgl/loader/ActorRenderDataLoader";
import { SdMapData } from "../../../mapviewer/webgl/loader/SdMapData";
import { SdMapDataLoader } from "../../../mapviewer/webgl/loader/SdMapDataLoader";
import { createHeadlessWorkerState } from "../../../mapviewer/worker/HeadlessWorkerState";
import { WorkerState, clearWorkerStateCaches } from "../../../mapviewer/worker/WorkerState";
import { Bzip2 } from "../../compression/Bzip2";
import { ByteBuffer } from "../../io/ByteBuffer";
import { MapSquareCoord } from "../../map/MapSquareCoord";
import { Scene } from "../../scene/Scene";
import { Archive } from "../Archive";
import { ArchiveFile } from "../ArchiveFile";
import { CacheIndex } from "../CacheIndex";
import { CacheSystem } from "../CacheSystem";
import { Container } from "../Container";
import { IndexType } from "../IndexType";
import { ReferenceTable } from "../ref/ReferenceTable";
import { MemoryStore } from "../store/MemoryStore";
import { CachePack, decodeCachePack, encodeCachePack } from "./CachePack";
import { CacheRoots } from "./CacheRoots";
import { PackCacheStore } from "./PackCacheStore";
import { SourceCache, openSourceCache } from "./SourceCache";
import { buildCachePack } from "./buildCachePack";
import { resolveCacheSelection } from "./resolveCacheSelection";

type EquivalenceCase = {
    readonly name: string;
    readonly encounterId: EncounterId;
    readonly preview?: AnimPreviewParams;
};

const TZTOK_JAD_NPC_TYPE_ID = 3127;

const CASES: readonly EquivalenceCase[] = [
    ...Object.values(EncounterId).map((encounterId) => ({ name: encounterId, encounterId })),
    {
        name: "npc seqs preview",
        encounterId: EncounterId.LUMBRIDGE,
        preview: {
            kind: "NPC_SEQS",
            npcTypeId: TZTOK_JAD_NPC_TYPE_ID,
            seqRange: { from: 2650, to: 2656 },
        },
    },
    {
        name: "spot anims preview",
        encounterId: EncounterId.LUMBRIDGE,
        preview: { kind: "SPOT_ANIMS", range: { from: 445, to: 452 } },
    },
];

function loadJson<T>(path: string): T {
    return JSON.parse(fs.readFileSync(path, "utf8"));
}

function openSource(): { loadedCache: LoadedCache; source: SourceCache } {
    const info = loadCacheList(loadCacheInfos()).latest;
    const loadedCache = loadCache(info);
    const store = MemoryStore.fromFiles(loadedCache.files);
    return { loadedCache, source: openSourceCache(info, store, loadedCache.xteas) };
}

function packFor(source: SourceCache, roots: CacheRoots): Uint8Array {
    return encodeCachePack(buildCachePack(source, resolveCacheSelection(source, roots)));
}

function packSystem(pack: CachePack): CacheSystem {
    return CacheSystem.fromStore(new PackCacheStore(pack), pack.header.indexIds);
}

// The first path at which the two values differ, or undefined when they are equal byte for byte.
function firstDifference(
    a: unknown,
    b: unknown,
    path: string,
    seen = new Set<unknown>(),
): string | undefined {
    if (Object.is(a, b)) {
        return undefined;
    }
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
        if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) {
            return `${path}: only one side is a typed array`;
        }
        if (a.constructor.name !== b.constructor.name) {
            return `${path}: ${a.constructor.name} vs ${b.constructor.name}`;
        }
        const bytesA = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
        const bytesB = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
        return bytesA.equals(bytesB) ? undefined : `${path}: bytes differ`;
    }
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
        return `${path}: ${String(a)} vs ${String(b)}`;
    }
    if (seen.has(a)) {
        return undefined;
    }
    seen.add(a);
    if (a.constructor !== b.constructor) {
        return `${path}: ${a.constructor.name} vs ${b.constructor.name}`;
    }
    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size) {
            return `${path}: map sizes ${a.size} vs ${b.size}`;
        }
        for (const [key, value] of a) {
            if (!b.has(key)) {
                return `${path}: key ${String(key)} missing`;
            }
            const difference = firstDifference(value, b.get(key), `${path}[${String(key)}]`, seen);
            if (difference) {
                return difference;
            }
        }
        return undefined;
    }
    if (a instanceof Set && b instanceof Set) {
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        return firstDifference(sortedA, sortedB, path, seen);
    }
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.join() !== keysB.join()) {
        return `${path}: keys ${keysA.join()} vs ${keysB.join()}`;
    }
    for (const key of keysA) {
        const difference = firstDifference(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key],
            `${path}.${key}`,
            seen,
        );
        if (difference) {
            return difference;
        }
    }
    return undefined;
}

// One render worker plus the main thread's loaders, all over one cache. Map loads run as the
// worker runs them, clearing the model caches after each.
class HeadlessViewer {
    private readonly viewer: ViewerLoaders;
    private readonly state: WorkerState;
    private readonly mapLoader = new SdMapDataLoader();
    private readonly actorLoader = new ActorRenderDataLoader();

    constructor(
        loadedCache: LoadedCache,
        system: CacheSystem,
        objSpawns: ObjSpawn[],
        npcSpawns: NpcSpawn[],
    ) {
        this.viewer = createViewerLoaders(loadedCache.info, system);
        this.state = createHeadlessWorkerState(loadedCache, system, objSpawns, npcSpawns);
    }

    async loadMap({ mapX, mapY }: MapSquareCoord, loadNpcs: boolean) {
        const { data } = await this.mapLoader.load(this.state, {
            mapX,
            mapY,
            maxLevel: Scene.MAX_LEVELS - 1,
            loadObjs: true,
            loadNpcs,
            smoothTerrain: false,
            minimizeDrawCalls: false,
            loadedTextureIds: new Set(),
        });
        clearWorkerStateCaches(this.state);
        return data;
    }

    async loadActors(encounterId: EncounterId, preview: AnimPreviewParams | undefined) {
        const { data } = await this.actorLoader.load(this.state, {
            encounterId,
            loadedTextureIds: new Set(),
            preview,
        });
        clearWorkerStateCaches(this.state);
        return data;
    }

    // What the game itself reads on the main thread by root id: type names and seq timings.
    loadMainThreadRoots(roots: CacheRoots) {
        const { npcTypeLoader, objTypeLoader, seqTypeLoader, seqFrameLoader } = this.viewer;
        return {
            npcTypes: roots.npcTypeIds.map((id) => npcTypeLoader.load(id)),
            objTypes: roots.objTypeIds.map((id) => objTypeLoader.load(id)),
            seqDurations: roots.seqIds.map((id) =>
                sequenceDurationSeconds(id, seqTypeLoader, seqFrameLoader),
            ),
        };
    }
}

describe("cache packs", () => {
    const quietConsole = { log: console.log, time: console.time, timeEnd: console.timeEnd };

    let loadedCache: LoadedCache;
    let source: SourceCache;
    let npcSpawns: NpcSpawn[];
    let objSpawns: ObjSpawn[];
    let fullCache: HeadlessViewer;
    // Several encounters share squares; the full cache builds each the same way every time.
    const fullCacheMaps = new Map<string, Promise<SdMapData | undefined>>();

    beforeAll(async () => {
        // The app decodes bzip2 with wasm too, and the JS fallback would dominate the run.
        await Bzip2.initWasm();
        ({ loadedCache, source } = openSource());
        npcSpawns = loadJson<NpcSpawn[]>("./src/mapviewer/data/npc/npc-spawns-osrs.json");
        objSpawns = loadJson<ObjSpawn[]>("./src/mapviewer/data/obj/obj-spawns.json");
        // The loaders narrate every load; errors still show.
        console.log = () => {};
        console.time = () => {};
        console.timeEnd = () => {};
        fullCache = new HeadlessViewer(loadedCache, source.system, objSpawns, npcSpawns);
    });

    afterAll(() => {
        Object.assign(console, quietConsole);
    });

    function loadFullCacheMap(square: MapSquareCoord, loadNpcs: boolean) {
        const key = `${square.mapX},${square.mapY},${loadNpcs}`;
        let map = fullCacheMaps.get(key);
        if (!map) {
            map = fullCache.loadMap(square, loadNpcs);
            fullCacheMaps.set(key, map);
        }
        return map;
    }

    it("re-encodes every real reference table byte for byte", () => {
        for (const indexId of source.indexIds) {
            const stored = Container.decode(
                new ByteBuffer(source.store.read(CacheIndex.META_INDEX_ID, indexId)),
            ).data;
            const table = ReferenceTable.decode(new ByteBuffer(stored));
            const encoded = ReferenceTable.encode(table.format, table.archiveReferences);
            expect({ indexId, equal: Buffer.from(encoded).equals(Buffer.from(stored)) }).toEqual({
                indexId,
                equal: true,
            });
        }
    });

    it("round-trips every config archive and some map archives through the archive encoder", () => {
        const targets = [
            ...Array.from(source.system.getIndex(IndexType.DAT2.configs).getArchiveIds()).map(
                (archiveId) => ({ indexId: IndexType.DAT2.configs, archiveId }),
            ),
            ...Array.from(source.system.getIndex(IndexType.DAT2.maps).getArchiveIds())
                .slice(0, 20)
                .map((archiveId) => ({ indexId: IndexType.DAT2.maps, archiveId })),
        ];
        for (const { indexId, archiveId } of targets) {
            const index = source.system.getIndex(indexId);
            const reference = index.getArchiveReference(archiveId)!;
            const archive = index.getArchive(archiveId);
            const files = Array.from(reference.fileIds, (fileId) => archive.getFile(fileId)!);
            const container = Container.encodeUncompressed(Archive.encode(files));
            const decoded = Archive.decode(
                archiveId,
                reference.lastFileId,
                reference.fileCount,
                reference.fileIds,
                reference.fileNameHashes,
                new ByteBuffer(Container.decode(new ByteBuffer(container)).data),
            );
            const differs = files.find(
                (file: ArchiveFile) =>
                    !Buffer.from(decoded.getFile(file.id)!.data).equals(Buffer.from(file.data)),
            );
            expect({ indexId, archiveId, differs: differs?.id }).toEqual({
                indexId,
                archiveId,
                differs: undefined,
            });
        }
    });

    it("builds byte-identical packs for the same cache and roots", () => {
        const roots = cacheRoots(
            getEncounter(EncounterId.FIGHT_CAVES),
            undefined,
            npcSpawns,
            objSpawns,
        );
        const first = packFor(source, roots);
        const second = packFor(openSource().source, roots);
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    });

    it.each(CASES)(
        "loads $name from its pack exactly as from the full cache",
        async ({ encounterId, preview }) => {
            const baseEncounter = getEncounter(encounterId);
            // The renderer maps the preview encounter but bakes actors for the base encounter's id.
            const mapEncounter = preview ? buildPreviewEncounter(baseEncounter) : baseEncounter;
            const roots = cacheRoots(baseEncounter, preview, npcSpawns, objSpawns);
            const pack = decodeCachePack(packFor(source, roots).buffer);
            expect(pack.header.cacheInfo).toEqual(source.info);
            const fromPack = new HeadlessViewer(
                loadedCache,
                packSystem(pack),
                objSpawns,
                npcSpawns,
            );

            for (const square of mapEncounter.mapSquares) {
                const expected = await loadFullCacheMap(square, mapEncounter.ambientNpcs);
                expect(expected).toBeDefined();
                const actual = await fromPack.loadMap(square, mapEncounter.ambientNpcs);
                const at = `map ${square.mapX},${square.mapY}`;
                expect(firstDifference(expected, actual, at)).toBeUndefined();
            }
            expect(
                firstDifference(
                    await fullCache.loadActors(encounterId, preview),
                    await fromPack.loadActors(encounterId, preview),
                    "actors",
                ),
            ).toBeUndefined();
            expect(
                firstDifference(
                    fullCache.loadMainThreadRoots(roots),
                    fromPack.loadMainThreadRoots(roots),
                    "main thread",
                ),
            ).toBeUndefined();
        },
    );
});
