import { LocTypeLoader } from "../../../rs/config/loctype/LocTypeLoader";
import { Model } from "../../../rs/model/Model";
import { Scene } from "../../../rs/scene/Scene";
import { SceneLoc } from "../../../rs/scene/SceneLoc";
import { getIdFromTag } from "../../../rs/scene/entity/EntityTag";
import { LocTile, TransformableGroundDecorations } from "../../game/LocTransform";
import { ModelHashBuffer, getModelHash } from "../buffer/ModelHashBuffer";
import { ModelInfo, SceneModel } from "../buffer/SceneBuffer";
import { SkinAnimation, SkinFrame } from "../skin/SkinAnimation";
import { SkinnedMesh } from "../skin/SkinnedMeshBuilder";
import { Skinning } from "../skin/Skinning";
import { FLOOR_DECORATION_PRIORITY, createSceneModel, isSceneTileRendered } from "./SceneLocs";

// A declared loc found in the built scene, with the model and placement the static bake would
// have drawn it with.
export type TransformableSceneLoc = {
    readonly sceneLoc: SceneLoc;
    readonly sceneModel: SceneModel;
    readonly tile: LocTile;
};

// A loc the skinned loc pass draws each frame with its LocTransform. It has no sequence, so it
// always samples its mesh's rest frame.
export type TransformableLocData = {
    readonly placement: ModelInfo;
    readonly mesh: SkinnedMesh;
    readonly restFrame: SkinFrame;
    readonly tile: LocTile;
};

// The faces of a lit slab model that reach below its top plane, where a flat ground decoration's
// top lies (model y points down): the slab's sides and bottom. The rest are hidden the way the
// cache hides a face.
function slabUnderside(slab: Model): Model {
    const underside = Model.copy(slab);
    for (let face = 0; face < underside.faceCount; face++) {
        const vertices = [
            underside.indices1[face],
            underside.indices2[face],
            underside.indices3[face],
        ];
        if (!vertices.some((vertex) => underside.verticesY[vertex] > 0)) {
            underside.faceColors3[face] = -2;
        }
    }
    return underside;
}

// Each resolved decoration carries its declaration's slab underside (see slabSpotAnimId), cut from
// the lit model loadSpotAnimModel returns.
export function resolveTransformableGroundDecorations(
    locTypeLoader: LocTypeLoader,
    loadSpotAnimModel: (spotAnimId: number) => Model,
    scene: Scene,
    declarations: readonly TransformableGroundDecorations[],
    baseX: number,
    baseY: number,
    borderSize: number,
    maxLevel: number,
): TransformableSceneLoc[] {
    const sceneOffset = borderSize * -128;
    const resolved: TransformableSceneLoc[] = [];
    for (const { level, locIds, tiles, slabSpotAnimId } of declarations) {
        const underside = slabUnderside(loadSpotAnimModel(slabSpotAnimId));
        for (const tile of tiles) {
            const tileX = tile.x - baseX;
            const tileY = tile.y - baseY;
            const where = `level ${level} tile ${tile.x},${tile.y}`;
            if (
                tileX < borderSize ||
                tileY < borderSize ||
                tileX >= borderSize + Scene.MAP_SQUARE_SIZE ||
                tileY >= borderSize + Scene.MAP_SQUARE_SIZE
            ) {
                throw new Error(`Transformable ground decoration at ${where} is outside this map`);
            }
            const sceneTile = scene.tiles[level][tileX][tileY];
            if (!sceneTile) {
                throw new Error(
                    `No scene tile for the transformable ground decoration at ${where}`,
                );
            }
            // A max level setting that leaves the tile out would have kept it out of the static
            // bake too.
            if (!isSceneTileRendered(scene, sceneTile, level, tileX, tileY, maxLevel)) {
                continue;
            }
            const decoration = sceneTile.floorDecoration;
            if (!decoration || !locIds.includes(getIdFromTag(decoration.tag))) {
                throw new Error(
                    `No ground decoration with loc id ${locIds.join("/")} at ${where} to transform`,
                );
            }
            if (!(decoration.entity instanceof Model)) {
                throw new Error(
                    `The ground decoration at ${where} is animated or varbit driven, which loc transforms do not pose`,
                );
            }
            // Merging drops the contour, which would move the decoration.
            if (decoration.entity.contourVerticesY) {
                throw new Error(
                    `The ground decoration at ${where} follows the ground's contour, which its slab does not`,
                );
            }
            resolved.push({
                sceneLoc: decoration,
                sceneModel: createSceneModel(
                    locTypeLoader,
                    Model.merge([decoration.entity, underside], 2),
                    decoration,
                    sceneOffset,
                    sceneOffset,
                    level,
                    FLOOR_DECORATION_PRIORITY,
                ),
                tile,
            });
        }
    }
    return resolved;
}

// Identical models share one skinned mesh, the way the static bake instances them.
export function createTransformableLocDatas(
    skinning: Skinning,
    modelHashBuf: ModelHashBuffer,
    locs: readonly TransformableSceneLoc[],
): TransformableLocData[] {
    const animationsByHash = new Map<number, SkinAnimation>();
    return locs.map(({ sceneModel, tile }) => {
        const hash = getModelHash(modelHashBuf, sceneModel.model);
        const animation = animationsByHash.get(hash) ?? skinning.addStatic(sceneModel.model);
        animationsByHash.set(hash, animation);
        return {
            placement: {
                sceneX: sceneModel.sceneX,
                sceneZ: sceneModel.sceneZ,
                heightOffset: sceneModel.heightOffset,
                level: sceneModel.level,
                contourGround: sceneModel.contourGround,
                priority: sceneModel.priority,
            },
            mesh: animation.mesh,
            restFrame: animation.frames[0],
            tile,
        };
    });
}
