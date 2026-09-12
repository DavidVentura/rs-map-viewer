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
import { MapFileLoader, ModernMapFileLoader } from "../../map/MapFileLoader";
import { MapSquareCoord } from "../../map/MapSquareCoord";
import { ModelLoader } from "../../model/ModelLoader";
import { SeqBase } from "../../model/seq/SeqBase";
import { IndexSeqBaseLoader, SeqBaseLoader } from "../../model/seq/SeqBaseLoader";
import { Dat2SeqFrameLoader, SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { IndexSkeletalSeqLoader, SkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
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

class CacheSelectionResolver {
    private readonly selection = new CacheSelectionBuilder();

    private readonly underlayTypes: FloorTypeLoader;
    private readonly overlayTypes: OverlayFloorTypeLoader;
    private readonly locTypes: LocTypeLoader;
    private readonly npcTypes: NpcTypeLoader;
    private readonly objTypes: ObjTypeLoader;
    private readonly seqTypes: SeqTypeLoader;
    private readonly spotAnimTypes: SpotAnimTypeLoader;
    private readonly textures: SpriteTextureLoader;
    private readonly modelLoader: ModelLoader;
    private readonly seqFrames: SeqFrameLoader;
    private readonly skeletalSeqs: SkeletalSeqLoader;
    private readonly mapFileLoader: MapFileLoader;
    private readonly sceneBuilder: SceneBuilder;

    private readonly modelIndex: CacheIndex;
    private readonly spriteIndex: CacheIndex;

    private readonly seenTextureIds = new Set<number>();
    private readonly seenFrameArchiveIds = new Set<number>();
    private readonly seenSkeletalIds = new Set<number>();

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
        this.mapFileLoader = factory.getMapFileLoader();
        if (!(this.mapFileLoader instanceof ModernMapFileLoader)) {
            throw new Error("Cache packs need one map archive per square");
        }

        const bases = new CollectingSeqBaseLoader(
            new IndexSeqBaseLoader(info, system.getIndex(IndexType.DAT2.skeletons)),
            (baseId) => this.selection.addWhole(IndexType.DAT2.skeletons, baseId),
        );
        this.seqFrames = new Dat2SeqFrameLoader(
            info,
            system.getIndex(IndexType.DAT2.animations),
            bases,
        );
        this.skeletalSeqs = new IndexSkeletalSeqLoader(
            system.getIndex(IndexType.OSRS.animKeyFrames),
            bases,
        );

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
                this.seqFrames,
                this.skeletalSeqs,
            ),
            source.xteas,
        );

        this.modelIndex = system.getIndex(IndexType.DAT2.models);
        this.spriteIndex = system.getIndex(IndexType.DAT2.sprites);
    }

    resolve(roots: CacheRoots): CacheSelection {
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
        const { info, system } = this.source;
        const configIndex = system.getIndex(IndexType.DAT2.configs);

        this.selection.addWhole(IndexType.DAT2.textures, 0);
        for (const archiveId of STARTUP_CONFIG_ARCHIVES) {
            this.selection.addArchive(IndexType.DAT2.configs, archiveId);
        }

        this.selection.addWhole(IndexType.DAT2.configs, ConfigType.OSRS.mapFunctions);
        const mapElementArchive = configIndex.getArchive(ConfigType.OSRS.mapFunctions);
        const mapElementTypes = new ArchiveMapElementTypeLoader(info, mapElementArchive);
        for (const id of mapElementArchive.fileIds) {
            this.addSprite(mapElementTypes.load(id).spriteId);
        }

        this.selection.addWhole(IndexType.OSRS.graphicDefaults, DefaultsGroup.GRAPHICS);
        this.addSprite(GraphicsDefaults.load(info, system).mapScenes);
    }

    // SceneBuilder.buildScene reads the neighbouring squares' terrain and the locs placed in the
    // scene's border, and an absent neighbour would silently build as empty terrain.
    private addMapSquare(square: MapSquareCoord): void {
        const bounds = mapSquareSceneBounds(square.mapX, square.mapY);
        const scene = new Scene(Scene.MAX_LEVELS, bounds.sizeX, bounds.sizeY);
        const mapFileIndex = this.mapFileLoader.mapFileIndex;

        for (const { mapX, mapY } of sceneMapSquares(bounds)) {
            const terrainArchiveId = mapFileIndex.getTerrainArchiveId(mapX, mapY);
            const locArchiveId = mapFileIndex.getLocArchiveId(mapX, mapY);
            if (terrainArchiveId !== -1) {
                this.selection.addWhole(IndexType.DAT2.maps, terrainArchiveId);
            }
            if (locArchiveId !== -1) {
                this.selection.addWhole(IndexType.DAT2.maps, locArchiveId);
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
                    this.addLoc(placement.id);
                }
            }
        }

        for (let level = 0; level < scene.levels; level++) {
            for (let x = 0; x < scene.sizeX; x++) {
                for (let y = 0; y < scene.sizeY; y++) {
                    // Tiles store floor ids plus one, zero meaning none.
                    const underlayId = scene.tileUnderlays[level][x][y];
                    if (underlayId > 0) {
                        this.addUnderlay(underlayId - 1);
                    }
                    const overlayId = scene.tileOverlays[level][x][y];
                    if (overlayId > 0) {
                        this.addOverlay(overlayId - 1);
                    }
                }
            }
        }
    }

    private addUnderlay(id: number): void {
        if (this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.underlays, id)) {
            this.underlayTypes.load(id);
        }
    }

    private addOverlay(id: number): void {
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.overlays, id)) {
            return;
        }
        const overlay = this.overlayTypes.load(id);
        this.addTexture(overlay.textureId);
        this.addTexture(overlay.secondaryTextureId);
    }

    private addLoc(id: number): void {
        if (!this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.locs, id)) {
            return;
        }
        const loc = this.locTypes.load(id);
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
        const npc = this.npcTypes.load(id);
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
        const obj = this.objTypes.load(id);
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
        const spotAnim = this.spotAnimTypes.load(id);
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
        const seq = this.seqTypes.load(id);
        if (seq.isSkeletalSeq()) {
            this.addSkeletalSeq(seq.skeletalId);
            return;
        }
        for (const frameId of seq.frameIds ?? []) {
            this.addFrameArchive(frameId);
        }
    }

    // A frame archive decodes every frame it holds, each asking for its base.
    private addFrameArchive(frameId: number): void {
        const archiveId = frameId >> 16;
        if (this.seenFrameArchiveIds.has(archiveId)) {
            return;
        }
        this.seenFrameArchiveIds.add(archiveId);
        this.selection.addWhole(IndexType.DAT2.animations, archiveId);
        this.seqFrames.load(frameId);
    }

    private addSkeletalSeq(skeletalId: number): void {
        if (this.seenSkeletalIds.has(skeletalId)) {
            return;
        }
        this.seenSkeletalIds.add(skeletalId);
        this.selection.addWhole(IndexType.OSRS.animKeyFrames, skeletalId >> 16);
        this.skeletalSeqs.load(skeletalId);
    }

    private addVarbit(id: number): void {
        if (id !== -1) {
            this.selection.addFile(IndexType.DAT2.configs, ConfigType.DAT2.varbits, id);
        }
    }

    // A model the cache does not have loads as absent on the full cache too.
    private addModel(id: number): void {
        if (id === -1 || !this.modelIndex.archiveExists(id)) {
            return;
        }
        if (!this.selection.addWhole(IndexType.DAT2.models, id)) {
            return;
        }
        const model = this.modelLoader.getModel(id);
        model?.faceTextures?.forEach((textureId) => this.addTexture(textureId));
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
        this.textures.definitions
            .get(id)
            ?.spriteIds.forEach((spriteId) => this.addSprite(spriteId));
    }

    private addSprite(id: number): void {
        if (id !== -1 && this.spriteIndex.archiveExists(id)) {
            this.selection.addWhole(IndexType.DAT2.sprites, id);
        }
    }
}

// Walks the cache's own references from the roots, through the same decoders the engine loads
// with, to every archive and config file the map and actor loaders read for them.
export function resolveCacheSelection(source: SourceCache, roots: CacheRoots): CacheSelection {
    return new CacheSelectionResolver(source).resolve(roots);
}
