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

export function resolveTransformableGroundDecorations(
    locTypeLoader: LocTypeLoader,
    scene: Scene,
    declarations: readonly TransformableGroundDecorations[],
    baseX: number,
    baseY: number,
    borderSize: number,
    maxLevel: number,
): TransformableSceneLoc[] {
    const sceneOffset = borderSize * -128;
    const resolved: TransformableSceneLoc[] = [];
    for (const { level, locIds, tiles } of declarations) {
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
            resolved.push({
                sceneLoc: decoration,
                sceneModel: createSceneModel(
                    locTypeLoader,
                    decoration.entity,
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
