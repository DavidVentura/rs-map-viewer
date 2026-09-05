import { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { SeqType } from "../../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { Model } from "../../rs/model/Model";
import { ModelData } from "../../rs/model/ModelData";
import { ModelLoader } from "../../rs/model/ModelLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { PlayerAppearance, PlayerGender } from "./PlayerAppearance";

export class PlayerModelLoader {
    constructor(
        readonly objTypeLoader: ObjTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
        readonly seqTypeLoader: SeqTypeLoader,
        readonly seqFrameLoader: SeqFrameLoader,
        readonly skeletalSeqLoader: SkeletalSeqLoader | undefined,
    ) {}

    getModel(appearance: PlayerAppearance, seqId: number, frame: number): Model | undefined {
        const model = this.buildBaseModel(appearance);
        if (!model || seqId === -1 || frame === -1) {
            return model;
        }

        const sequence = this.seqTypeLoader.load(seqId);
        return this.transformModel(model, sequence, frame);
    }

    private buildBaseModel(appearance: PlayerAppearance): Model | undefined {
        const modelIds = [...appearance.baseModelIds, ...this.getEquipmentModelIds(appearance)];
        const models: ModelData[] = [];
        for (const id of modelIds) {
            const model = this.modelLoader.getModel(id);
            if (!model) {
                return undefined;
            }
            models.push(model);
        }

        if (models.length === 0) {
            return undefined;
        }

        return ModelData.merge(models, models.length).light(
            this.textureLoader,
            appearance.ambient + 64,
            appearance.contrast + 850,
            -30,
            -50,
            -30,
        );
    }

    private getEquipmentModelIds(appearance: PlayerAppearance): number[] {
        const modelIds: number[] = [];
        for (const itemId of appearance.equippedItemIds) {
            const item = this.objTypeLoader.load(itemId);
            const wornModelIds =
                appearance.gender === PlayerGender.MALE
                    ? [item.maleModel, item.maleModel1, item.maleModel2]
                    : [item.femaleModel, item.femaleModel1, item.femaleModel2];
            for (const modelId of wornModelIds) {
                if (modelId !== -1) {
                    modelIds.push(modelId);
                }
            }
        }
        return modelIds;
    }

    private transformModel(model: Model, sequence: SeqType, frame: number): Model {
        if (sequence.isSkeletalSeq()) {
            const skeletalSequence = this.skeletalSeqLoader?.load(sequence.skeletalId);
            if (!skeletalSequence) {
                return Model.copyAnimated(model, true, true);
            }

            const animated = Model.copyAnimated(model, !skeletalSequence.hasAlphaTransform, true);
            animated.animateSkeletal(skeletalSequence, frame);
            return animated;
        }

        if (!sequence.frameIds || sequence.frameIds.length === 0) {
            return Model.copyAnimated(model, true, true);
        }

        const sequenceFrame = this.seqFrameLoader.load(sequence.frameIds[frame]);
        if (!sequenceFrame) {
            return Model.copyAnimated(model, true, true);
        }

        const animated = Model.copyAnimated(
            model,
            !sequenceFrame.hasAlphaTransform,
            !sequenceFrame.hasColorTransform,
        );
        animated.animate(sequenceFrame, undefined, sequence.op14);
        return animated;
    }
}
