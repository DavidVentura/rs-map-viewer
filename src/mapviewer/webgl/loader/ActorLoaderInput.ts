import { SeqRange } from "../../game/AnimPreview";
import { EncounterId } from "../../game/Encounter";

export type PreviewAnimInput = {
    readonly npcTypeId: number;
    readonly seqRange: SeqRange;
};

export type ActorLoaderInput = {
    encounterId: EncounterId;
    loadedTextureIds: Set<number>;
    preview?: PreviewAnimInput;
};
