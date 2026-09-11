import { AnimPreviewParams } from "../../game/AnimPreview";
import { EncounterId } from "../../game/Encounter";

export type ActorLoaderInput = {
    encounterId: EncounterId;
    loadedTextureIds: Set<number>;
    preview?: AnimPreviewParams;
};
