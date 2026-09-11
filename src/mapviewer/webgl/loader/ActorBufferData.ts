import { EncounterId } from "../../game/Encounter";
import { ActorRenderData } from "../actor/ActorRenderData";

export type ActorBufferData = {
    cacheName: string;
    encounterId: EncounterId;

    vertices: Uint8Array;
    indices: Int32Array;
    influences: Uint32Array;
    matrixTable: Float32Array;

    actorData: ActorRenderData;

    loadedTextures: Map<number, Int32Array>;
};
