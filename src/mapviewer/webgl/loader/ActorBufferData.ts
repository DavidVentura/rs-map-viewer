import { EncounterId } from "../../game/Encounter";
import { ActorRenderData } from "../actor/ActorRenderData";
import { SkinnedGeometry } from "../skin/Skinning";

export type ActorBufferData = {
    cacheName: string;
    encounterId: EncounterId;

    skinned: SkinnedGeometry;

    actorData: ActorRenderData;

    loadedTextures: Map<number, Int32Array>;
};
