import { DefaultsGroup } from "../../config/defaults/DefaultsGroup";
import { GraphicsDefaults } from "../../config/defaults/GraphicsDefaults";
import { FloorTypeLoader, OverlayFloorTypeLoader } from "../../config/floortype/FloorTypeLoader";
import { LocModelLoader } from "../../config/loctype/LocModelLoader";
import { LocTypeLoader } from "../../config/loctype/LocTypeLoader";
import { ArchiveMapElementTypeLoader } from "../../config/meltype/MapElementTypeLoader";
import { NpcTypeLoader } from "../../config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../../config/objtype/ObjTypeLoader";
import { SeqTypeLoader } from "../../config/seqtype/SeqTypeLoader";
import { SpotAnimTypeLoader } from "../../config/spotanimtype/SpotAnimTypeLoader";
import { ModernMapFileLoader } from "../../map/MapFileLoader";
import { MapSquareCoord } from "../../map/MapSquareCoord";
import { ModelLoader } from "../../model/ModelLoader";
import { SeqBase } from "../../model/seq/SeqBase";
import { IndexSeqBaseLoader, SeqBaseLoader } from "../../model/seq/SeqBaseLoader";
import { Dat2SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { IndexSkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
import { Scene } from "../../scene/Scene";
import {
    SceneBuilder,
    decodeLocPlacements,
    isLocPlacedInScene,
    mapSquareSceneBounds,
    sceneMapSquares,
} from "../../scene/SceneBuilder";
import { SpriteTextureLoader } from "../../texture/SpriteTextureLoader";
import { CacheIndex } from "../CacheIndex";
import { ConfigType } from "../ConfigType";
import { IndexType } from "../IndexType";
import { getCacheLoaderFactory } from "../loader/CacheLoaderFactory";
import { CacheRoots } from "./CacheRoots";
import { CacheSelection, CacheSelectionBuilder } from "./CacheSelection";
import { SourceCache } from "./SourceCache";

// The config archives the loader factory decodes whenever the matching loader is built, which
// every worker and the main thread do at startup whether or not any of their types are used.
const STARTUP_CONFIG_ARCHIVES = [
    ConfigType.DAT2.underlays,
    ConfigType.DAT2.overlays,
    ConfigType.DAT2.varbits,
    ConfigType.DAT2.locs,
    ConfigType.DAT2.npcs,
    ConfigType.DAT2.objs,
    ConfigType.DAT2.seqs,
    ConfigType.DAT2.spotAnims,
];

// Packs follow the loaders of modern oldschool caches: config types in archives of index 2, one
// map archive per square holding terrain and locs (revision 237), sprite-backed textures.
const MIN_PACKABLE_REVISION = 237;

// Records which bases the frame and skeletal decoders ask for, so the walk follows exactly the
// references those decoders follow.
class CollectingSeqBaseLoader implements SeqBaseLoader {
    constructor(
        private readonly inner: SeqBaseLoader,
        private readonly onLoad: (baseId: number) => void,
    ) {}

    load(id: number): SeqBase | undefined {
        this.onLoad(id);
        return this.inner.load(id);
    }

    clearCache(): void {
        this.inner.clearCache();
    }
}

// What a map square's scene reads: the map archives of the square and its neighbours, and the
// locs and floor types of the scene they build.
type MapSquareReferences = {
    readonly mapArchiveIds: readonly number[];
    readonly locIds: readonly number[];
    readonly underlayIds: readonly number[];
    readonly overlayIds: readonly number[];
};

// The roots-independent half of a resolve, built once per source cache: the decoders the walk
// reads through, whose type caches persist across resolves, and the memoised references of the
// nodes no loader caches (map squares, models, frame archives, skeletal seqs).
class CacheGraph {
    readonly underlayTypes: FloorTypeLoader;
    readonly overlayTypes: OverlayFloorTypeLoader;
    readonly locTypes: LocTypeLoader;
    readonly npcTypes: NpcTypeLoader;
    readonly objTypes: ObjTypeLoader;
    readonly seqTypes: SeqTypeLoader;
    readonly spotAnimTypes: SpotAnimTypeLoader;
    readonly textures: SpriteTextureLoader;

    // Sprites every startup reads, whatever the roots.
    readonly startupSpriteIds: readonly number[];

    private readonly modelLoader: ModelLoader;
    private readonly mapFileLoader: ModernMapFileLoader;
    private readonly sceneBuilder: SceneBuilder;
    private readonly seqBases: IndexSeqBaseLoader;

    private readonly modelIndex: CacheIndex;
    private readonly spriteIndex: CacheIndex;
    private readonly configIndex: CacheIndex;
    // Built on first use per config archive, since an ArchiveReference is decoded on every lookup.
    private readonly configFileIds = new Map<number, ReadonlySet<number>>();

    private readonly mapSquareReferenceMemo = new Map<number, MapSquareReferences>();
    private readonly modelTextureIdMemo = new Map<number, readonly number[]>();
    private readonly frameArchiveBaseIdMemo = new Map<number, readonly number[]>();
    private readonly skeletalBaseIdMemo = new Map<number, readonly number[]>();

    constructor(private readonly source: SourceCache) {
        const { info, system } = source;
        if (info.game !== "oldschool" || info.revision < MIN_PACKABLE_REVISION) {
            throw new Error(
                `Cache packs need an oldschool cache of revision ${MIN_PACKABLE_REVISION} or ` +
                    `later, got ${info.game} ${info.revision}`,
            );
        }
        const factory = getCacheLoaderFactory(info, system);

        this.underlayTypes = factory.getUnderlayTypeLoader();
        this.overlayTypes = factory.getOverlayTypeLoader();
        this.locTypes = factory.getLocTypeLoader();
        this.npcTypes = factory.getNpcTypeLoader();
        this.objTypes = factory.getObjTypeLoader();
        this.seqTypes = factory.getSeqTypeLoader();
        const spotAnimTypes = factory.getSpotAnimTypeLoader();
        if (!spotAnimTypes) {
            throw new Error("Cache has no spot anim archive");
        }
        this.spotAnimTypes = spotAnimTypes;
        const textures = factory.getTextureLoader();
        if (!(textures instanceof SpriteTextureLoader)) {
            throw new Error("Cache packs need sprite-backed textures");
        }
        this.textures = textures;
        this.modelLoader = factory.getModelLoader();
        const mapFileLoader = factory.getMapFileLoader();
        if (!(mapFileLoader instanceof ModernMapFileLoader)) {
            throw new Error("Cache packs need one map archive per square");
        }
        this.mapFileLoader = mapFileLoader;

        this.seqBases = new IndexSeqBaseLoader(info, system.getIndex(IndexType.DAT2.skeletons));

        // Only its terrain decoder is used; the rest is what its constructor asks for.
        this.sceneBuilder = new SceneBuilder(
            info,
            this.mapFileLoader,
            this.underlayTypes,
            this.overlayTypes,
            this.locTypes,
            new LocModelLoader(
                this.locTypes,
                this.modelLoader,
                this.textures,
                this.seqTypes,
                new Dat2SeqFrameLoader(
                    info,
                    system.getIndex(IndexType.DAT2.animations),
                    this.seqBases,
                ),
                new IndexSkeletalSeqLoader(
                    system.getIndex(IndexType.OSRS.animKeyFrames),
                    this.seqBases,
                ),
            ),
            source.xteas,
        );

        this.modelIndex = system.getIndex(IndexType.DAT2.models);
        this.spriteIndex = system.getIndex(IndexType.DAT2.sprites);
        this.configIndex = system.getIndex(IndexType.DAT2.configs);

        const mapElementArchive = this.configIndex.getArchive(ConfigType.OSRS.mapFunctions);
        const mapElementTypes = new ArchiveMapElementTypeLoader(info, mapElementArchive);
        this.startupSpriteIds = [
            ...Array.from(mapElementArchive.fileIds, (id) => mapElementTypes.load(id).spriteId),
            GraphicsDefaults.load(info, system).mapScenes,
        ];
    }

    configTypeExists(configArchiveId: number, id: number): boolean {
        let fileIds = this.configFileIds.get(configArchiveId);
        if (!fileIds) {
            fileIds = new Set(this.configIndex.getArchiveReference(configArchiveId)?.fileIds);
            this.configFileIds.set(configArchiveId, fileIds);
        }
        return fileIds.has(id);
    }

    spriteExists(id: number): boolean {
        return id !== -1 && this.spriteIndex.archiveExists(id);
    }

    modelExists(id: number): boolean {
        return id !== -1 && this.modelIndex.archiveExists(id);
    }

    // SceneBuilder.buildScene reads the neighbouring squares' terrain and the locs placed in the
    // scene's border, and an absent neighbour would silently build as empty terrain.
    mapSquareReferences(square: MapSquareCoord): MapSquareReferences {
        const key = (square.mapX << 8) | square.mapY;
        const memoised = this.mapSquareReferenceMemo.get(key);
        if (memoised) {
            return memoised;
        }

        const bounds = mapSquareSceneBounds(square.mapX, square.mapY);
        const scene = new Scene(Scene.MAX_LEVELS, bounds.sizeX, bounds.sizeY);
        const mapFileIndex = this.mapFileLoader.mapFileIndex;
        const mapArchiveIds = new Set<number>();
        const locIds = new Set<number>();

        for (const { mapX, mapY } of sceneMapSquares(bounds)) {
            const terrainArchiveId = mapFileIndex.getTerrainArchiveId(mapX, mapY);
            const locArchiveId = mapFileIndex.getLocArchiveId(mapX, mapY);
            if (terrainArchiveId !== -1) {
                mapArchiveIds.add(terrainArchiveId);
            }
            if (locArchiveId !== -1) {
                mapArchiveIds.add(locArchiveId);
            }

            const offsetX = mapX * Scene.MAP_SQUARE_SIZE - bounds.baseX;
            const offsetY = mapY * Scene.MAP_SQUARE_SIZE - bounds.baseY;
            const terrain = this.mapFileLoader.getTerrainData(mapX, mapY);
            if (terrain) {
                this.sceneBuilder.decodeTerrain(
                    scene,
                    terrain,
                    offsetX,
                    offsetY,
                    bounds.baseX,
                    bounds.baseY,
                );
            }
            const locs = this.mapFileLoader.getLocData(mapX, mapY, this.source.xteas);
            if (!locs) {
                continue;
            }
            for (const placement of decodeLocPlacements(locs)) {
                const sceneX = placement.localX + offsetX;
                const sceneY = placement.localY + offsetY;
                if (isLocPlacedInScene(scene.sizeX, scene.sizeY, sceneX, sceneY)) {
                    locIds.add(placement.id);
                }
            }
        }

        const underlayIds = new Set<number>();
        const overlayIds = new Set<number>();
        for (let level = 0; level < scene.levels; level++) {
            for (let x = 0; x < scene.sizeX; x++) {
                for (let y = 0; y < scene.sizeY; y++) {
                    // Tiles store floor ids plus one, zero meaning none.
                    const underlayId = scene.tileUnderlays[level][x][y];
                    if (underlayId > 0) {
                        underlayIds.add(underlayId - 1);
                    }
                    const overlayId = scene.tileOverlays[level][x][y];
                    if (overlayId > 0) {
                        overlayIds.add(overlayId - 1);
                    }
                }
            }
        }

        const references: MapSquareReferences = {
            mapArchiveIds: [...mapArchiveIds],
            locIds: [...locIds],
            underlayIds: [...underlayIds],
            overlayIds: [...overlayIds],
        };
        this.mapSquareReferenceMemo.set(key, references);
        return references;
    }

    modelTextureIds(modelId: number): readonly number[] {
        const memoised = this.modelTextureIdMemo.get(modelId);
        if (memoised) {
            return memoised;
        }
        const faceTextures = this.modelLoader.getModel(modelId)?.faceTextures ?? [];
        const textureIds = [...new Set(faceTextures)];
        this.modelTextureIdMemo.set(modelId, textureIds);
        return textureIds;
    }

    // A frame archive decodes every frame it holds, each asking for its base.
    frameArchiveBaseIds(archiveId: number): readonly number[] {
        const memoised = this.frameArchiveBaseIdMemo.get(archiveId);
        if (memoised) {
            return memoised;
        }
        const baseIds = new Set<number>();
        const frames = new Dat2SeqFrameLoader(
            this.source.info,
            this.source.system.getIndex(IndexType.DAT2.animations),
            new CollectingSeqBaseLoader(this.seqBases, (baseId) => baseIds.add(baseId)),
        );
        frames.load(archiveId << 16);
        const result = [...baseIds];
        this.frameArchiveBaseIdMemo.set(archiveId, result);
        return result;
    }

    skeletalBaseIds(skeletalId: number): readonly number[] {
        const memoised = this.skeletalBaseIdMemo.get(skeletalId);
        if (memoised) {
            return memoised;
        }
        const baseIds = new Set<number>();
        const skeletalSeqs = new IndexSkeletalSeqLoader(
            this.source.system.getIndex(IndexType.OSRS.animKeyFrames),
            new CollectingSeqBaseLoader(this.seqBases, (baseId) => baseIds.add(baseId)),
        );
        skeletalSeqs.load(skeletalId);
        const result = [...baseIds];
        this.skeletalBaseIdMemo.set(skeletalId, result);
        return result;
    }
}

// One resolve: the selection it accumulates and the nodes it has visited.
class CacheSelectionWalk {
    private readonly selection = new CacheSelectionBuilder();

    private readonly seenTextureIds = new Set<number>();
    private readonly seenFrameArchiveIds = new Set<number>();
    private readonly seenSkeletalIds = new Set<number>();

    constructor(private readonly graph: CacheGraph) {}

    walk(roots: CacheRoots): CacheSelection {
        this.addStartupReads();
        for (const square of roots.mapSquares) {
            this.addMapSquare(square);
        }
        roots.npcTypeIds.forEach((id) => this.addNpc(id));
        roots.objTypeIds.forEach((id) => this.addObj(id));
        roots.seqIds.forEach((id) => this.addSeq(id));
        roots.spotAnimIds.forEach((id) => this.addSpotAnim(id));
        return this.selection.build();
    }

    // Mirrors what Dat2CacheLoaderFactory reads while the workers and MapViewer.initCache build
    // their loaders, before anything is loaded by id.
    private addStartupReads(): void {
        this.selection.addWhole(IndexType.DAT2.textures, 0);
        for (const archiveId of STARTUP_CONFIG_ARCHIVES) {
            this.selection.addArchive(IndexType.DAT2.configs, archiveId);
        }
        this.selection.addWhole(IndexType.DAT2.configs, ConfigType.OSRS.mapFunctions);
        this.selection.addWhole(IndexType.OSRS.graphicDefaults, DefaultsGroup.GRAPHICS);
        this.graph.startupSpriteIds.forEach((id) => this.addSprite(id));
    }

    private addMapSquare(square: MapSquareCoord): void {
        const references = this.graph.mapSquareReferences(square);
        for (const archiveId of references.mapArchiveIds) {
            this.selection.addWhole(IndexType.DAT2.maps, archiveId);
        }
        references.locIds.forEach((id) => this.addLoc(id));
        references.underlayIds.forEach((id) => this.addUnderlay(id));
        references.overlayIds.forEach((id) => this.addOverlay(id));
    }

    private addUnderlay(id: number): void {
        if (this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.underlays, id)) {
            this.graph.underlayTypes.load(id);
        }
    }

    private addOverlay(id: number): void {
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.overlays, id)) {
            return;
        }
        const overlay = this.graph.overlayTypes.load(id);
        this.addTexture(overlay.textureId);
        this.addTexture(overlay.secondaryTextureId);
    }

    private addLoc(id: number): void {
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.locs, id)) {
            return;
        }
        const loc = this.graph.locTypes.load(id);
        // Every shape's models: transforms and placements pick shapes independently of each other.
        for (const modelIds of loc.models ?? []) {
            modelIds.forEach((modelId) => this.addModel(modelId));
        }
        this.addTextures(loc.retextureTo);
        this.addSeq(loc.seqId);
        loc.randomSeqIds?.forEach((seqId) => this.addSeq(seqId));
        this.addVarbit(loc.transformVarbit);
        // Every transform, since var values can change after the pack is built.
        for (const transformId of loc.transforms ?? []) {
            if (transformId !== -1) {
                this.addLoc(transformId);
            }
        }
    }

    // Idle and walk are the only npc seqs the map and actor loaders pose; anything else an npc
    // plays is declared as a seq root.
    private addNpc(id: number): void {
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.npcs, id)) {
            return;
        }
        const npc = this.graph.npcTypes.load(id);
        (npc.modelIds ?? []).forEach((modelId) => this.addModel(modelId));
        this.addTextures(npc.retextureTo);
        this.addSeq(npc.idleSeqId);
        this.addSeq(npc.walkSeqId);
        this.addVarbit(npc.transformVarbit);
        for (const transformId of npc.transforms ?? []) {
            if (transformId !== -1) {
                this.addNpc(transformId);
            }
        }
    }

    // Both genders' worn models, since gender is a runtime appearance choice.
    private addObj(id: number): void {
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.objs, id)) {
            return;
        }
        const obj = this.graph.objTypes.load(id);
        const modelIds = [
            obj.model ?? -1,
            obj.maleModel,
            obj.maleModel1,
            obj.maleModel2,
            obj.femaleModel,
            obj.femaleModel1,
            obj.femaleModel2,
        ];
        modelIds.forEach((modelId) => this.addModel(modelId));
        this.addTextures(obj.retextureTo);
        // ObjModelLoader swaps in the variant of every count threshold that is set.
        (obj.countObj ?? []).forEach((countId, i) => {
            const threshold = obj.countCo[i];
            if (threshold !== undefined && threshold !== 0) {
                this.addObj(countId);
            }
        });
    }

    private addSpotAnim(id: number): void {
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.spotAnims, id)) {
            return;
        }
        const spotAnim = this.graph.spotAnimTypes.load(id);
        if (typeof spotAnim.modelId === "number") {
            this.addModel(spotAnim.modelId);
        }
        this.addTextures(spotAnim.retextureTo);
        this.addSeq(spotAnim.sequenceId);
    }

    private addSeq(id: number): void {
        if (id === -1) {
            return;
        }
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.seqs, id)) {
            return;
        }
        const seq = this.graph.seqTypes.load(id);
        if (seq.isSkeletalSeq()) {
            this.addSkeletalSeq(seq.skeletalId);
            return;
        }
        for (const frameId of seq.frameIds ?? []) {
            this.addFrameArchive(frameId);
        }
    }

    private addFrameArchive(frameId: number): void {
        const archiveId = frameId >> 16;
        if (this.seenFrameArchiveIds.has(archiveId)) {
            return;
        }
        this.seenFrameArchiveIds.add(archiveId);
        this.selection.addWhole(IndexType.DAT2.animations, archiveId);
        for (const baseId of this.graph.frameArchiveBaseIds(archiveId)) {
            this.selection.addWhole(IndexType.DAT2.skeletons, baseId);
        }
    }

    private addSkeletalSeq(skeletalId: number): void {
        if (this.seenSkeletalIds.has(skeletalId)) {
            return;
        }
        this.seenSkeletalIds.add(skeletalId);
        this.selection.addWhole(IndexType.OSRS.animKeyFrames, skeletalId >> 16);
        for (const baseId of this.graph.skeletalBaseIds(skeletalId)) {
            this.selection.addWhole(IndexType.DAT2.skeletons, baseId);
        }
    }

    private addVarbit(id: number): void {
        if (id !== -1) {
            this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.varbits, id);
        }
    }

    // A model the cache does not have loads as absent on the full cache too.
    private addModel(id: number): void {
        if (!this.graph.modelExists(id)) {
            return;
        }
        if (!this.selection.addWhole(IndexType.DAT2.models, id)) {
            return;
        }
        this.graph.modelTextureIds(id).forEach((textureId) => this.addTexture(textureId));
    }

    private addTextures(textureIds: readonly number[] | undefined): void {
        textureIds?.forEach((textureId) => this.addTexture(textureId));
    }

    // A texture without a definition or sprite fails to load on the full cache too.
    private addTexture(id: number): void {
        if (id === -1 || this.seenTextureIds.has(id)) {
            return;
        }
        this.seenTextureIds.add(id);
        this.graph.textures.definitions
            .get(id)
            ?.spriteIds.forEach((spriteId) => this.addSprite(spriteId));
    }

    private addSprite(id: number): void {
        if (this.graph.spriteExists(id)) {
            this.selection.addWhole(IndexType.DAT2.sprites, id);
        }
    }
}

// Walks the cache's own references from the roots, through the same decoders the engine loads
// with, to every archive and config file the map and actor loaders read for them. Built once per
// source cache: resolves share its decoded types and memoised references.
export class CacheSelectionResolver {
    private readonly graph: CacheGraph;

    constructor(source: SourceCache) {
        this.graph = new CacheGraph(source);
    }

    // The first root this cache has no type for, which the walk would fail on deep inside a type
    // loader.
    unknownRoot(roots: CacheRoots): string | undefined {
        const idLists: [string, number, readonly number[]][] = [
            ["npc type", ConfigType.DAT2.npcs, roots.npcTypeIds],
            ["obj type", ConfigType.DAT2.objs, roots.objTypeIds],
            ["seq", ConfigType.DAT2.seqs, roots.seqIds],
            ["spot anim", ConfigType.DAT2.spotAnims, roots.spotAnimIds],
        ];
        for (const [kind, configArchiveId, ids] of idLists) {
            const unknownId = ids.find((id) => !this.graph.configTypeExists(configArchiveId, id));
            if (unknownId !== undefined) {
                return `The cache has no ${kind} ${unknownId}`;
            }
        }
        return undefined;
    }

    // Every root must be known to the cache (see unknownRoot).
    resolve(roots: CacheRoots): CacheSelection {
        return new CacheSelectionWalk(this.graph).walk(roots);
    }
}
