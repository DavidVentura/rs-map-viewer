import { CollisionData } from "../../../rs/scene/CollisionMap";
import { DrawRange } from "../DrawRange";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";

export type SdMapData = {
    mapX: number;
    mapY: number;

    cacheName: string;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    borderSize: number;

    tileRenderFlags: Uint8Array[][];
    collisionDatas: CollisionData[];

    minimapBlob: Blob;

    vertices: Uint8Array;
    indices: Int32Array;

    modelTextureData: Uint16Array;
    modelTextureDataAlpha: Uint16Array;

    heightMapTextureData: Int16Array;

    drawRanges: DrawRange[];
    drawRangesAlpha: DrawRange[];

    locsAnimated: LocAnimatedData[];
    npcs: NpcData[];

    loadedTextures: Map<number, Int32Array>;
};
