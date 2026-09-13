import { TransformableGroundDecorations } from "../../game/LocTransform";

export type SdMapLoaderInput = {
    mapX: number;
    mapY: number;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    minimizeDrawCalls: boolean;

    loadedTextureIds: Set<number>;

    // Only the tiles within this map square.
    transformableGroundDecorations: readonly TransformableGroundDecorations[];
};
