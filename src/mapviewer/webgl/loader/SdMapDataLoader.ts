import { BasTypeLoader } from "../../../rs/config/bastype/BasTypeLoader";
import { ContourGroundInfo, LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocType } from "../../../rs/config/loctype/LocType";
import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../../rs/config/npctype/NpcType";
import { NpcTypeLoader } from "../../../rs/config/npctype/NpcTypeLoader";
import { ObjModelLoader } from "../../../rs/config/objtype/ObjModelLoader";
import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { SpotAnimType } from "../../../rs/config/spotanimtype/SpotAnimType";
import { SpotAnimTypeLoader } from "../../../rs/config/spotanimtype/SpotAnimTypeLoader";
import { VarManager } from "../../../rs/config/vartype/VarManager";
import { Model } from "../../../rs/model/Model";
import { ModelData } from "../../../rs/model/ModelData";
import { ModelLoader } from "../../../rs/model/ModelLoader";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { CollisionFlag } from "../../../rs/pathfinder/flag/CollisionFlag";
import { Scene } from "../../../rs/scene/Scene";
import { LocEntity } from "../../../rs/scene/entity/LocEntity";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { NpcSpawn, getMapNpcSpawns } from "../../data/npc/NpcSpawn";
import { ObjSpawn, getMapObjSpawns } from "../../data/obj/ObjSpawn";
import { WeaponStyle } from "../../game/Ability";
import { StanceSeqIds } from "../../game/Player";
import {
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    ProjectileKind,
} from "../../game/Projectile";
import { ICE_BARRAGE_HIT_SEQ_ID, VisualEffectKind } from "../../game/VisualEffect";
import { ICE_BARRAGE_CAST_SEQ_ID } from "../../game/abilities";
import { PlayerAppearance, PlayerGender } from "../../player/PlayerAppearance";
import { PlayerModelLoader } from "../../player/PlayerModelLoader";
import { loadMinimapBlob } from "../../worker/MinimapData";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { toWorld } from "../WorldCoords";
import { ModelHashBuffer, getModelHash } from "../buffer/ModelHashBuffer";
import {
    ContourGroundType,
    DrawCommand,
    ModelFace,
    ModelMergeGroup,
    SceneBuffer,
    SceneModel,
    createModelInfoTextureData,
    getModelFaces,
    isModelFaceTransparent,
} from "../buffer/SceneBuffer";
import { EnemyRenderData } from "../enemy/EnemyRenderData";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { SceneLocEntity } from "../loc/SceneLocEntity";
import { getSceneLocs, isLowDetail } from "../loc/SceneLocs";
import { createNpcDatas } from "../npc/NpcData";
import { NpcSpawnGroup } from "../npc/NpcSpawnGroup";
import { PlayerRenderData, StanceAnimationSet } from "../player/PlayerRenderData";
import { ProjectileRenderData } from "../projectile/ProjectileRenderData";
import { EnemySpawnData, SdMapData } from "./SdMapData";
import { SdMapLoaderInput } from "./SdMapLoaderInput";

function loadHeightMapTextureData(scene: Scene): Int16Array {
    const heightMapTextureData = new Int16Array(Scene.MAX_LEVELS * scene.sizeX * scene.sizeY);

    let dataIndex = 0;
    for (let level = 0; level < scene.levels; level++) {
        for (let y = 0; y < scene.sizeY; y++) {
            for (let x = 0; x < scene.sizeX; x++) {
                heightMapTextureData[dataIndex++] =
                    (-scene.tileHeights[level][x][y] / Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
            }
        }
    }

    return heightMapTextureData;
}

function createObjSceneModels(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawns: ObjSpawn[],
): void {
    for (const spawn of spawns) {
        createObjSceneModel(objModelLoader, sceneModels, scene, borderSize, spawn);
    }
}

function createObjSceneModel(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawn: ObjSpawn,
): void {
    const objType = objModelLoader.objTypeLoader.load(spawn.id);
    if (objType.name === "null") {
        return;
    }

    const localX = spawn.x % 64;
    const localY = spawn.y % 64;

    const tileX = localX + borderSize;
    const tileY = localY + borderSize;

    const model = objModelLoader.getModel(spawn.id, spawn.count);
    if (!model) {
        return undefined;
    }

    let renderLevel = spawn.plane;
    if (renderLevel < 3 && (scene.tileRenderFlags[1][tileX][tileY] & 0x2) === 2) {
        renderLevel = spawn.plane + 1;
    }

    const sceneHeight = scene.getCenterHeight(renderLevel, tileX, tileY);

    let heightOffset = 0;
    const tile = scene.tiles[renderLevel][tileX][tileY];
    if (!tile || !tile.tileModel || tile.tileModel.faces.length === 0) {
        return undefined;
    }
    if (tile) {
        for (const loc of tile.locs) {
            if ((loc.flags & 256) === 256 && loc.entity instanceof Model) {
                const model = loc.entity;
                model.calculateBoundsCylinder();
                if (model.contourHeight > heightOffset) {
                    heightOffset = model.contourHeight;
                }
            }
        }
    }

    let contourGround = ContourGroundType.CENTER_TILE;

    if (heightOffset !== 0) {
        heightOffset -= sceneHeight;
        contourGround = ContourGroundType.NONE;
    }

    sceneModels.push({
        model,
        lowDetail: false,
        forceMerge: false,
        sceneHeight,
        sceneX: localX * 128 + 64,
        sceneZ: localY * 128 + 64,
        heightOffset,
        level: renderLevel,
        contourGround,
        priority: 10,
        interactType: InteractType.OBJ,
        interactId: spawn.id,
    });
}

function createModelGroups(
    modelGroupMap: Map<number, ModelMergeGroup>,
    sceneModels: SceneModel[],
    transparent: boolean,
): void {
    for (const sceneModel of sceneModels) {
        const key =
            Number(transparent) |
            ((sceneModel.lowDetail ? 1 : 0) << 1) |
            (sceneModel.level << 2) |
            (sceneModel.priority << 4);

        const group = modelGroupMap.get(key);
        if (group) {
            group.models.push(sceneModel);
        } else {
            modelGroupMap.set(key, {
                transparent,
                lowDetail: sceneModel.lowDetail,
                level: sceneModel.level,
                priority: sceneModel.priority,
                models: [sceneModel],
            });
        }
    }
}

function addSceneModels(
    modelHashBuf: ModelHashBuffer,
    textureLoader: TextureLoader,
    sceneBuf: SceneBuffer,
    sceneModels: SceneModel[],
    minimizeDrawCalls: boolean,
): void {
    const groupedModels = new Map<number, SceneModel[]>();
    for (const sceneModel of sceneModels) {
        const model = sceneModel.model;
        const hash = getModelHash(modelHashBuf, model);
        const locs = groupedModels.get(hash);
        if (locs) {
            locs.push(sceneModel);
        } else {
            groupedModels.set(hash, [sceneModel]);
        }
    }

    const modelGroupMap: Map<number, ModelMergeGroup> = new Map();
    for (const sceneModels of groupedModels.values()) {
        const model = sceneModels[0].model;
        const faces = getModelFaces(model);

        const opaqueFaces: ModelFace[] = [];
        const transparentFaces: ModelFace[] = [];
        for (const face of faces) {
            if (isModelFaceTransparent(textureLoader, face)) {
                transparentFaces.push(face);
            } else {
                opaqueFaces.push(face);
            }
        }

        const mergeModels: SceneModel[] = [];
        const instancedModels: SceneModel[] = [];
        const lodModels: SceneModel[] = [];
        for (const sceneModel of sceneModels) {
            if (sceneModel.forceMerge) {
                mergeModels.push(sceneModel);
            } else {
                instancedModels.push(sceneModel);
                if (!sceneModel.lowDetail) {
                    lodModels.push(sceneModel);
                }
            }
        }

        createModelGroups(modelGroupMap, mergeModels, false);
        if (transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, mergeModels, true);
        }

        const instanceCount = instancedModels.length;
        const mergeOpaque =
            instanceCount === 1 || instanceCount * opaqueFaces.length < 100 || minimizeDrawCalls;
        const mergeTransparent =
            instanceCount === 1 ||
            instanceCount * transparentFaces.length < 100 ||
            minimizeDrawCalls;

        // mergeOpaque = false;
        // mergeTransparent = false;

        if (mergeOpaque) {
            createModelGroups(modelGroupMap, instancedModels, false);
        } else if (opaqueFaces.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, opaqueFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            const drawCommand: DrawCommand = {
                offset: indexOffset,
                elements: elementCount,
                instances: sceneModels,
            };

            sceneBuf.drawCommands.push(drawCommand);
            sceneBuf.drawCommandsInteract.push(drawCommand);
            if (lodModels.length > 0) {
                const drawCommandLod: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: lodModels,
                };
                sceneBuf.drawCommandsLod.push(drawCommandLod);
                sceneBuf.drawCommandsInteractLod.push(drawCommandLod);
            }
        }

        if (mergeTransparent && transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, instancedModels, true);
        } else if (transparentFaces.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, transparentFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            const drawCommand: DrawCommand = {
                offset: indexOffset,
                elements: elementCount,
                instances: sceneModels,
            };

            sceneBuf.drawCommandsAlpha.push(drawCommand);
            sceneBuf.drawCommandsInteractAlpha.push(drawCommand);
            if (lodModels.length > 0) {
                const drawCommandLod: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: lodModels,
                };
                sceneBuf.drawCommandsLodAlpha.push(drawCommandLod);
                sceneBuf.drawCommandsInteractLodAlpha.push(drawCommandLod);
            }
        }
    }

    for (const group of modelGroupMap.values()) {
        sceneBuf.addModelGroup(group);
    }
}

function addLocAnimationFrames(
    locModelLoader: LocModelLoader,
    sceneBuf: SceneBuffer,
    entity: LocEntity,
    locType: LocType,
): AnimationFrames | undefined {
    const seqType = locModelLoader.seqTypeLoader.load(entity.seqId);
    let frameCount: number;
    if (seqType.isSkeletalSeq()) {
        frameCount = seqType.getSkeletalDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = locModelLoader.getModelAnimated(
            locType,
            entity.type,
            entity.rotation,
            entity.seqId,
            i,
        );
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function addLocEntities(
    centerLocHeightWithSize: boolean,
    locModelLoader: LocModelLoader,
    varManager: VarManager,
    scene: Scene,
    sceneModels: SceneModel[],
    sceneBuf: SceneBuffer,
    locEntities: SceneLocEntity[],
): Iterable<LocAnimatedGroup> {
    const locAnimatedGroupMap = new Map<number, LocAnimatedGroup>();

    for (const sceneLocEntity of locEntities) {
        const entity = sceneLocEntity.entity;
        const id = entity.id;
        const type = entity.type;
        const rotation = entity.rotation;
        const tileX = entity.tileX;
        const tileY = entity.tileY;
        const level = entity.level;

        let locType = locModelLoader.locTypeLoader.load(id);
        let sizeX = locType.sizeX;
        let sizeY = locType.sizeY;
        if (rotation === 1 || rotation === 3) {
            sizeX = locType.sizeY;
            sizeY = locType.sizeX;
        }

        if (locType.transforms) {
            const transformed = locType.transform(varManager, locModelLoader.locTypeLoader);
            if (!transformed) {
                continue;
            }
            locType = transformed;
        }

        let startX = (sizeX >> 1) + tileX;
        let endX = ((sizeX + 1) >> 1) + tileX;
        let startY = (sizeY >> 1) + tileY;
        let endY = ((sizeY + 1) >> 1) + tileY;

        if (!centerLocHeightWithSize) {
            startX = tileX;
            endX = tileX + 1;
            startY = tileY;
            endY = tileY + 1;
        }

        const heightMap = scene.tileHeights[level];
        let heightMapAbove: Int32Array[] | undefined;
        if (entity.level < scene.levels - 1) {
            heightMapAbove = scene.tileHeights[level + 1];
        }

        const centerHeight =
            (heightMap[endX][endY] +
                heightMap[startX][endY] +
                heightMap[startX][startY] +
                heightMap[endX][startY]) >>
            2;
        const entityX = (tileX << 7) + (sizeX << 6);
        const entityZ = (tileY << 7) + (sizeY << 6);

        const contourGroundInfo: ContourGroundInfo = {
            type: locType.contourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove,
            entityX: entityX,
            entityY: centerHeight,
            entityZ: entityZ,
        };
        const lowDetail = isLowDetail(scene, level, tileX, tileY, locType, type);
        if (entity.seqId !== -1) {
            const loc = {
                ...sceneLocEntity,
                lowDetail,
                interactId: locType.id,
            };

            const key = rotation + (type << 3) + (locType.id << 10);
            const group = locAnimatedGroupMap.get(key);
            if (group) {
                group.locs.push(loc);
            } else {
                const anim = addLocAnimationFrames(locModelLoader, sceneBuf, entity, locType);
                if (!anim) {
                    continue;
                }

                locAnimatedGroupMap.set(key, {
                    anim,
                    locs: [loc],
                });
            }
        } else {
            const model = locModelLoader.getModelAnimated(
                locType,
                type,
                rotation,
                -1,
                -1,
                contourGroundInfo,
            );
            if (!model) {
                continue;
            }
            sceneModels.push({
                ...sceneLocEntity,

                model,
                sceneHeight: centerHeight,
                lowDetail,
                forceMerge: locType.contourGroundType > 1,
                interactId: locType.id,
            });
        }
    }

    return locAnimatedGroupMap.values();
}

function addNpcAnimationFrames(
    npcModelLoader: NpcModelLoader,
    sceneBuf: SceneBuffer,
    npcType: NpcType,
    seqId: number,
): AnimationFrames | undefined {
    const seqType = npcModelLoader.seqTypeLoader.load(seqId);
    if (!seqType) {
        return undefined;
    }
    let frameCount: number;
    if (seqType.isSkeletalSeq()) {
        frameCount = seqType.getSkeletalDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = npcModelLoader.getModel(npcType, seqId, i);
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function addPlayerAnimationFrames(
    playerModelLoader: PlayerModelLoader,
    sceneBuf: SceneBuffer,
    appearance: PlayerAppearance,
    seqId: number,
): AnimationFrames | undefined {
    const seqType = playerModelLoader.seqTypeLoader.load(seqId);
    if (!seqType.frameIds || seqType.frameIds.length === 0) {
        return undefined;
    }

    const frames = new Array<DrawRange>(seqType.frameIds.length);
    const framesAlpha = new Array<DrawRange>(seqType.frameIds.length);
    let alphaFrameCount = 0;
    for (let i = 0; i < seqType.frameIds.length; i++) {
        const model = playerModelLoader.getModel(appearance, seqId, i);
        if (!model) {
            return undefined;
        }
        frames[i] = sceneBuf.addModelAnimFrame(model, false);
        framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
        if (framesAlpha[i][1] > 0) {
            alphaFrameCount++;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function createPlayerRenderData(
    playerModelLoader: PlayerModelLoader,
    npcTypeLoader: NpcTypeLoader,
    sceneBuf: SceneBuffer,
    mapX: number,
    mapY: number,
): PlayerRenderData | undefined {
    const playerWorldX = 3237;
    const playerWorldY = 3225;
    if (mapX !== playerWorldX >> 6 || mapY !== playerWorldY >> 6) {
        return undefined;
    }

    const baseNpc = npcTypeLoader.load(3105);

    const stances: Partial<Record<WeaponStyle, StanceAnimationSet>> = {};
    for (const style of [WeaponStyle.RANGED, WeaponStyle.MAGIC, WeaponStyle.MELEE] as const) {
        const equipment = STANCE_EQUIPMENT[style];
        const set = createStanceAnimationSet(playerModelLoader, sceneBuf, baseNpc, equipment);
        if (!set) {
            return undefined;
        }
        stances[style] = set;
    }

    return {
        x: (playerWorldX & 0x3f) * 128,
        y: (playerWorldY & 0x3f) * 128,
        level: 0,
        id: baseNpc.id,
        stances: stances as Record<WeaponStyle, StanceAnimationSet>,
    };
}

type StanceEquipment = StanceSeqIds & { itemId: number; extraSeqIds?: readonly number[] };

// bow: shortbow, unarmed idle/walk/run, bow attack
// staff: staff of fire, standard spellcast idle/walk/run/attack, plus the ice barrage cast
// scimitar: rune scimitar, unarmed idle/walk/run, slash attack
const STANCE_EQUIPMENT: Record<WeaponStyle, StanceEquipment> = {
    [WeaponStyle.RANGED]: {
        itemId: 841,
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: 426,
    },
    [WeaponStyle.MAGIC]: {
        itemId: 1387,
        idleSeqId: 813,
        walkSeqId: 1146,
        runSeqId: 1210,
        attackSeqId: 711,
        extraSeqIds: [ICE_BARRAGE_CAST_SEQ_ID],
    },
    [WeaponStyle.MELEE]: {
        itemId: 1333,
        idleSeqId: 808,
        walkSeqId: 819,
        runSeqId: 824,
        attackSeqId: 390,
    },
};

function createStanceAnimationSet(
    playerModelLoader: PlayerModelLoader,
    sceneBuf: SceneBuffer,
    baseNpc: NpcType,
    equipment: StanceEquipment,
): StanceAnimationSet | undefined {
    const appearance = new PlayerAppearance(
        baseNpc.modelIds,
        [equipment.itemId],
        PlayerGender.MALE,
        baseNpc.ambient,
        baseNpc.contrast,
    );

    const seqIds = [
        equipment.idleSeqId,
        equipment.walkSeqId,
        equipment.runSeqId,
        equipment.attackSeqId,
        ...(equipment.extraSeqIds ?? []),
    ];

    const animationsBySeqId = new Map<number, AnimationFrames>();
    for (const seqId of seqIds) {
        if (animationsBySeqId.has(seqId)) {
            continue;
        }
        const anim = addPlayerAnimationFrames(playerModelLoader, sceneBuf, appearance, seqId);
        if (!anim) {
            return undefined;
        }
        animationsBySeqId.set(seqId, anim);
    }

    return {
        idleSeqId: equipment.idleSeqId,
        walkSeqId: equipment.walkSeqId,
        runSeqId: equipment.runSeqId,
        attackSeqId: equipment.attackSeqId,
        idleAnim: animationsBySeqId.get(equipment.idleSeqId)!,
        animationsBySeqId,
    };
}

// Lumbridge "Goblin" (id 3029): idle/walk/death share the same unarmed-squat animation set.
const ENEMY_NPC_ID = 3029;
const ENEMY_IDLE_SEQ_ID = 6181;
const ENEMY_WALK_SEQ_ID = 6180;
const ENEMY_DEATH_SEQ_ID = 6182;

const ENEMY_SPAWN_TILE_OFFSETS = [
    { x: 3, y: 1 },
    { x: -3, y: 1 },
    { x: 1, y: -3 },
    { x: -1, y: 3 },
];

const ENEMY_SPAWN_BLOCKING_FLAGS =
    CollisionFlag.OBJECT |
    CollisionFlag.FLOOR_DECORATION |
    CollisionFlag.FLOOR |
    CollisionFlag.BLOCK_PLAYERS;

function createEnemyRenderData(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: NpcTypeLoader,
    sceneBuf: SceneBuffer,
    mapX: number,
    mapY: number,
): EnemyRenderData | undefined {
    const playerWorldX = 3237;
    const playerWorldY = 3225;
    if (mapX !== playerWorldX >> 6 || mapY !== playerWorldY >> 6) {
        return undefined;
    }

    const npcType = npcTypeLoader.load(ENEMY_NPC_ID);

    const idleAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, ENEMY_IDLE_SEQ_ID);
    const walkAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, ENEMY_WALK_SEQ_ID);
    const deathAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, ENEMY_DEATH_SEQ_ID);
    if (!idleAnim || !walkAnim || !deathAnim) {
        return undefined;
    }

    return {
        id: npcType.id,
        idleAnim,
        walkAnim,
        deathAnim,
        idleSeqId: ENEMY_IDLE_SEQ_ID,
        walkSeqId: ENEMY_WALK_SEQ_ID,
        deathSeqId: ENEMY_DEATH_SEQ_ID,
    };
}

function createEnemySpawns(
    scene: Scene,
    borderSize: number,
    mapX: number,
    mapY: number,
): EnemySpawnData[] {
    const playerWorldX = 3237;
    const playerWorldY = 3225;
    if (mapX !== playerWorldX >> 6 || mapY !== playerWorldY >> 6) {
        return [];
    }

    const level = 0;
    const collisionMap = scene.collisionMaps[level];
    const centerTileX = playerWorldX & 0x3f;
    const centerTileY = playerWorldY & 0x3f;

    const spawns: EnemySpawnData[] = [];
    for (const offset of ENEMY_SPAWN_TILE_OFFSETS) {
        const tileX = centerTileX + offset.x;
        const tileY = centerTileY + offset.y;
        if (
            collisionMap.hasFlag(tileX + borderSize, tileY + borderSize, ENEMY_SPAWN_BLOCKING_FLAGS)
        ) {
            continue;
        }
        spawns.push({
            x: toWorld(mapX, tileX * 128 + 64),
            y: toWorld(mapY, tileY * 128 + 64),
            level,
        });
    }
    return spawns;
}

// Fire Bolt spell (SpotAnimType ids): 127 travels, 128 hits.
const FIRE_BOLT_PROJECTILE_SPOTANIM_ID = 127;
const FIRE_BOLT_HIT_SPOTANIM_ID = 128;

// Ice Barrage hit graphic (SpotAnimType id): 369.
const ICE_BARRAGE_HIT_SPOTANIM_ID = 369;

// A visually distinct, larger arrow model for the ranged Power Shot special.
const POWER_SHOT_MODEL_SCALE = 200;

function addStaticModelAnimationFrames(sceneBuf: SceneBuffer, model: Model): AnimationFrames {
    const frame = sceneBuf.addModelAnimFrame(model, false);
    const frameAlpha = sceneBuf.addModelAnimFrame(model, true);
    return {
        frames: [frame],
        framesAlpha: frameAlpha[1] > 0 ? [frameAlpha] : undefined,
    };
}

function buildSpotAnimModel(
    modelLoader: ModelLoader,
    textureLoader: TextureLoader,
    spotAnim: SpotAnimType,
): Model | undefined {
    const modelData = modelLoader.getModel(spotAnim.modelId);
    if (!modelData) {
        return undefined;
    }
    const model = ModelData.merge([modelData], 1).light(
        textureLoader,
        spotAnim.ambient + 64,
        spotAnim.contrast + 768,
        -50,
        -10,
        -50,
    );
    if (spotAnim.widthScale !== 128 || spotAnim.heightScale !== 128) {
        model.scale(spotAnim.widthScale, spotAnim.heightScale, spotAnim.widthScale);
    }
    return model;
}

function addSpotAnimAnimationFrames(
    sceneBuf: SceneBuffer,
    seqTypeLoader: SeqTypeLoader,
    seqFrameLoader: SeqFrameLoader,
    baseModel: Model,
    seqId: number,
): AnimationFrames {
    const seqType = seqTypeLoader.load(seqId);
    if (!seqType.frameIds || seqType.frameIds.length === 0) {
        throw new Error(`Spot animation sequence ${seqId} has no frames`);
    }

    const frames = new Array<DrawRange>(seqType.frameIds.length);
    const framesAlpha = new Array<DrawRange>(seqType.frameIds.length);
    let alphaFrameCount = 0;
    for (let i = 0; i < seqType.frameIds.length; i++) {
        const seqFrame = seqFrameLoader.load(seqType.frameIds[i]);
        let frameModel = baseModel;
        if (seqFrame) {
            frameModel = Model.copyAnimated(
                baseModel,
                !seqFrame.hasAlphaTransform,
                !seqFrame.hasColorTransform,
            );
            frameModel.animate(seqFrame, undefined, seqType.op14);
        }
        frames[i] = sceneBuf.addModelAnimFrame(frameModel, false);
        framesAlpha[i] = sceneBuf.addModelAnimFrame(frameModel, true);
        if (framesAlpha[i][1] > 0) {
            alphaFrameCount++;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function createProjectileRenderData(
    objModelLoader: ObjModelLoader,
    spotAnimTypeLoader: SpotAnimTypeLoader | undefined,
    modelLoader: ModelLoader,
    textureLoader: TextureLoader,
    seqTypeLoader: SeqTypeLoader,
    seqFrameLoader: SeqFrameLoader,
    sceneBuf: SceneBuffer,
): ProjectileRenderData {
    const arrowModel = objModelLoader.getModel(882, 1);
    if (!arrowModel) {
        throw new Error("Arrow projectile model is missing from the cache");
    }
    if (!spotAnimTypeLoader) {
        throw new Error("Spot animations are not available in this cache");
    }
    const arrowAnim = addStaticModelAnimationFrames(sceneBuf, arrowModel);

    const powerShotModel = Model.copy(arrowModel);
    powerShotModel.scale(POWER_SHOT_MODEL_SCALE, POWER_SHOT_MODEL_SCALE, POWER_SHOT_MODEL_SCALE);
    const powerShotAnim = addStaticModelAnimationFrames(sceneBuf, powerShotModel);

    const boltSpotAnim = spotAnimTypeLoader.load(FIRE_BOLT_PROJECTILE_SPOTANIM_ID);
    const boltModel = buildSpotAnimModel(modelLoader, textureLoader, boltSpotAnim);
    if (!boltModel || boltSpotAnim.sequenceId !== FIRE_BOLT_TRAVEL_SEQ_ID) {
        throw new Error("Fire bolt projectile spot animation does not match the expected sequence");
    }
    const boltAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        boltModel,
        FIRE_BOLT_TRAVEL_SEQ_ID,
    );

    const boltHitSpotAnim = spotAnimTypeLoader.load(FIRE_BOLT_HIT_SPOTANIM_ID);
    const boltHitModel = buildSpotAnimModel(modelLoader, textureLoader, boltHitSpotAnim);
    if (!boltHitModel || boltHitSpotAnim.sequenceId !== FIRE_BOLT_HIT_SEQ_ID) {
        throw new Error("Fire bolt hit spot animation does not match the expected sequence");
    }
    const boltHitAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        boltHitModel,
        FIRE_BOLT_HIT_SEQ_ID,
    );

    const iceBarrageSpotAnim = spotAnimTypeLoader.load(ICE_BARRAGE_HIT_SPOTANIM_ID);
    const iceBarrageModel = buildSpotAnimModel(modelLoader, textureLoader, iceBarrageSpotAnim);
    if (!iceBarrageModel || iceBarrageSpotAnim.sequenceId !== ICE_BARRAGE_HIT_SEQ_ID) {
        throw new Error("Ice barrage hit spot animation does not match the expected sequence");
    }
    const iceBarrageAnim = addSpotAnimAnimationFrames(
        sceneBuf,
        seqTypeLoader,
        seqFrameLoader,
        iceBarrageModel,
        ICE_BARRAGE_HIT_SEQ_ID,
    );

    return {
        projectileMeshes: {
            [ProjectileKind.ARROW]: { anim: arrowAnim, rotationOffset: 1024 },
            [ProjectileKind.MAGIC]: { anim: boltAnim, rotationOffset: 0 },
            [ProjectileKind.POWER_SHOT]: { anim: powerShotAnim, rotationOffset: 1024 },
        },
        effectAnimations: {
            [VisualEffectKind.MAGIC_HIT]: boltHitAnim,
            [VisualEffectKind.ICE_BARRAGE_HIT]: iceBarrageAnim,
        },
    };
}

function createNpcSpawnGroups(
    npcModelLoader: NpcModelLoader,
    basTypeLoader: BasTypeLoader,
    sceneBuf: SceneBuffer,
    npcSpawns: NpcSpawn[],
): NpcSpawnGroup[] {
    const groupedSpawns = new Map<number, NpcSpawn[]>();
    for (const spawn of npcSpawns) {
        const group = groupedSpawns.get(spawn.id);
        if (group) {
            group.push(spawn);
        } else {
            groupedSpawns.set(spawn.id, [spawn]);
        }
    }

    const groups: NpcSpawnGroup[] = [];

    for (const spawns of groupedSpawns.values()) {
        const npcType = npcModelLoader.npcTypeLoader.load(spawns[0].id);

        const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(basTypeLoader);

        if (idleSeqId === -1) {
            continue;
        }

        const idleAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, idleSeqId);
        let walkAnim = idleAnim;
        if (walkSeqId !== -1 && walkSeqId !== idleSeqId) {
            walkAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, walkSeqId);
        }

        if (!idleAnim) {
            continue;
        }

        groups.push({
            idleAnim,
            walkAnim,
            spawns,
        });
    }

    return groups;
}

export class SdMapDataLoader implements RenderDataLoader<SdMapLoaderInput, SdMapData | undefined> {
    __type = "sdMapDataLoader" as const;

    modelHashBuf?: ModelHashBuffer;

    init(): void {
        if (!this.modelHashBuf) {
            this.modelHashBuf = new ModelHashBuffer(5000);
        }
    }

    async load(
        state: WorkerState,
        {
            mapX,
            mapY,
            maxLevel,
            loadObjs,
            loadNpcs,
            smoothTerrain,
            minimizeDrawCalls,
            loadedTextureIds,
        }: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        console.time(`load map ${mapX},${mapY}`);
        this.init();

        const locTypeLoader = state.locTypeLoader;
        const npcTypeLoader = state.npcTypeLoader;
        const basTypeLoader = state.basTypeLoader;
        const textureLoader = state.textureLoader;

        const locModelLoader = state.locModelLoader;
        const objModelLoader = state.objModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const varManager = state.varManager;

        let textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
        textureIds = textureIds.slice(0, 2047);
        const textureIdIndexMap = new Map<number, number>();
        for (let i = 0; i < textureIds.length; i++) {
            textureIdIndexMap.set(textureIds[i], i);
        }

        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        console.time(`build scene ${mapX},${mapY}`);
        const scene = state.sceneBuilder.buildScene(baseX, baseY, mapSize, mapSize, smoothTerrain);
        console.timeEnd(`build scene ${mapX},${mapY}`);

        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);
        sceneBuf.addTerrain(scene, borderSize, maxLevel);

        const sceneLocs = getSceneLocs(locTypeLoader, scene, borderSize, maxLevel);
        const sceneModels = sceneLocs.locs;

        // Create loc animated groups and add transformed locs
        const locAnimatedGroups = addLocEntities(
            state.sceneBuilder.centerLocHeightWithSize,
            locModelLoader,
            varManager,
            scene,
            sceneModels,
            sceneBuf,
            sceneLocs.locEntities,
        );

        if (loadObjs) {
            const objSpawns = getMapObjSpawns(state.objSpawns, maxLevel, mapX, mapY);
            createObjSceneModels(objModelLoader, sceneModels, scene, borderSize, objSpawns);
        }

        addSceneModels(this.modelHashBuf!, textureLoader, sceneBuf, sceneModels, minimizeDrawCalls);

        // Animated locs
        const locsAnimated = sceneBuf.addLocAnimatedGroups(locAnimatedGroups);
        console.log(`animated locs: ${locsAnimated.length}`);

        // Npcs

        let npcSpawns: NpcSpawn[] = [];
        if (loadNpcs) {
            const cacheNpcSpawns = state.sceneBuilder.decodeNpcSpawns(
                scene,
                borderSize,
                mapX,
                mapY,
            );
            if (cacheNpcSpawns) {
                npcSpawns = cacheNpcSpawns.filter((spawn) => {
                    const npcType = npcTypeLoader.load(spawn.id);
                    return (npcType.loginScreenProps & 0x1) > 0;
                });
            } else {
                npcSpawns = getMapNpcSpawns(state.npcSpawns, maxLevel, mapX, mapY);
                npcSpawns = npcSpawns.filter((spawn) => {
                    return (
                        spawn.name === undefined || spawn.name === npcTypeLoader.load(spawn.id).name
                    );
                });
            }
        }
        const npcSpawnGroups = createNpcSpawnGroups(
            npcModelLoader,
            basTypeLoader,
            sceneBuf,
            npcSpawns,
        );
        const npcs = createNpcDatas(npcSpawnGroups);
        const playerModelLoader = new PlayerModelLoader(
            state.objTypeLoader,
            state.cacheLoaderFactory.getModelLoader(),
            textureLoader,
            state.seqTypeLoader,
            state.seqFrameLoader,
            state.skeletalSeqLoader,
        );
        const player = createPlayerRenderData(
            playerModelLoader,
            npcTypeLoader,
            sceneBuf,
            mapX,
            mapY,
        );
        const enemy = createEnemyRenderData(npcModelLoader, npcTypeLoader, sceneBuf, mapX, mapY);
        const enemySpawns = createEnemySpawns(scene, borderSize, mapX, mapY);

        const projectiles = player
            ? createProjectileRenderData(
                  objModelLoader,
                  state.cacheLoaderFactory.getSpotAnimTypeLoader(),
                  state.cacheLoaderFactory.getModelLoader(),
                  textureLoader,
                  state.seqTypeLoader,
                  state.seqFrameLoader,
                  sceneBuf,
              )
            : undefined;

        // Draw ranges

        // Normal (merged)
        const drawRanges = sceneBuf.drawCommands.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesAlpha = sceneBuf.drawCommandsAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(
            `draw ranges: ${drawRanges.length}, alpha: ${drawRangesAlpha.length}`,
            mapX,
            mapY,
        );

        // Lod (merged)
        const drawRangesLod = sceneBuf.drawCommandsLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesLodAlpha = sceneBuf.drawCommandsLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(
            `draw ranges lod: ${drawRangesLod.length}, alpha: ${drawRangesLodAlpha.length}`,
            mapX,
            mapY,
        );

        // Interact (non merged)
        const drawRangesInteract = sceneBuf.drawCommandsInteract.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractAlpha = sceneBuf.drawCommandsInteractAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(`draw ranges interact: ${drawRangesInteract.length}`, mapX, mapY);

        // Interact Lod (non merged)
        const drawRangesInteractLod = sceneBuf.drawCommandsInteractLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractLodAlpha = sceneBuf.drawCommandsInteractLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        // Model info textures
        const modelTextureData = createModelInfoTextureData(sceneBuf.drawCommands);
        const modelTextureDataAlpha = createModelInfoTextureData(sceneBuf.drawCommandsAlpha);

        const modelTextureDataLod = createModelInfoTextureData(sceneBuf.drawCommandsLod);
        const modelTextureDataLodAlpha = createModelInfoTextureData(sceneBuf.drawCommandsLodAlpha);

        const modelTextureDataInteract = createModelInfoTextureData(sceneBuf.drawCommandsInteract);
        const modelTextureDataInteractAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractAlpha,
        );

        const modelTextureDataInteractLod = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLod,
        );
        const modelTextureDataInteractLodAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLodAlpha,
        );

        const heightMapTextureData = loadHeightMapTextureData(scene);

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);

        const minimapBlob = await loadMinimapBlob(
            state.mapImageRenderer,
            scene,
            0,
            borderSize,
            false,
        );

        const loadedTextures = new Map<number, Int32Array>();
        for (const textureId of sceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) {}
            }
        }

        console.timeEnd(`load map ${mapX},${mapY}`);

        const transferables = [
            ...scene.tileRenderFlags.flat().map((buf) => buf.buffer),
            ...scene.collisionMaps.map((map) => map.flags.buffer),
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),

            vertices.buffer,
            indices.buffer,
            heightMapTextureData.buffer,

            modelTextureData.buffer,
            modelTextureDataAlpha.buffer,

            modelTextureDataLod.buffer,
            modelTextureDataLodAlpha.buffer,

            modelTextureDataInteract.buffer,
            modelTextureDataInteractAlpha.buffer,

            modelTextureDataInteractLod.buffer,
            modelTextureDataInteractLodAlpha.buffer,
        ];

        const totalBytes = transferables.reduce((sum, buf) => sum + buf.byteLength, 0);

        console.log(
            `total bytes: ${totalBytes} ${mapX},${mapY}`,
            sceneBuf.usedTextureIds,
            loadedTextures.size,
        );

        return {
            data: {
                mapX,
                mapY,

                cacheName: state.cache.info.name,

                maxLevel,
                loadObjs,
                loadNpcs,

                smoothTerrain,

                borderSize,
                tileRenderFlags: scene.tileRenderFlags,
                collisionDatas: scene.collisionMaps,

                minimapBlob,

                vertices,
                indices,

                modelTextureData,
                modelTextureDataAlpha,

                modelTextureDataLod,
                modelTextureDataLodAlpha,

                modelTextureDataInteract,
                modelTextureDataInteractAlpha,

                modelTextureDataInteractLod,
                modelTextureDataInteractLodAlpha,

                heightMapTextureData,

                drawRanges,
                drawRangesAlpha,

                drawRangesLod,
                drawRangesLodAlpha,

                drawRangesInteract,
                drawRangesInteractAlpha,

                drawRangesInteractLod,
                drawRangesInteractLodAlpha,

                locsAnimated,
                npcs,
                player,
                enemy,
                enemySpawns,
                projectiles,

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {
        this.modelHashBuf = undefined;
    }
}
