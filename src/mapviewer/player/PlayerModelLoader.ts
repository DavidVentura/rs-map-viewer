import { ObjType } from "../../rs/config/objtype/ObjType";
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
        const models: ModelData[] = [];
        for (const id of appearance.baseModelIds) {
            const model = this.modelLoader.getModel(id);
            if (!model) {
                return undefined;
            }
            models.push(model);
        }

        for (const itemId of appearance.equippedItemIds) {
            const equipmentModels = this.getEquipmentModels(itemId, appearance.gender);
            if (!equipmentModels) {
                return undefined;
            }
            models.push(...equipmentModels);
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

    // Recolor/retexture indices are the item's own palette values, so each item's tables must be
    // applied to that item's own worn model(s) here, before merging with other equipped items:
    // applying them after merging could recolor unrelated faces from other items that happen to
    // share the same "from" palette value.
    private getEquipmentModels(itemId: number, gender: PlayerGender): ModelData[] | undefined {
        const item = this.objTypeLoader.load(itemId);
        const wornModelIds =
            gender === PlayerGender.MALE
                ? [item.maleModel, item.maleModel1, item.maleModel2]
                : [item.femaleModel, item.femaleModel1, item.femaleModel2];

        const models: ModelData[] = [];
        for (const modelId of wornModelIds) {
            if (modelId === -1) {
                continue;
            }
            const modelData = this.modelLoader.getModel(modelId);
            if (!modelData) {
                return undefined;
            }
            this.applyItemRecolor(modelData, item);
            models.push(modelData);
        }
        return models;
    }

    private applyItemRecolor(modelData: ModelData, item: ObjType): void {
        if (item.recolorFrom) {
            const retexture = item.cacheInfo.game === "runescape" && item.cacheInfo.revision <= 464;
            for (let i = 0; i < item.recolorFrom.length; i++) {
                modelData.recolor(item.recolorFrom[i], item.recolorTo[i]);
                if (retexture) {
                    modelData.retexture(item.recolorFrom[i], item.recolorTo[i]);
                }
            }
        }

        if (item.retextureFrom) {
            for (let i = 0; i < item.retextureFrom.length; i++) {
                modelData.retexture(item.retextureFrom[i], item.retextureTo[i]);
            }
        }
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
