import { Model } from "../../model/Model";
import { ModelData } from "../../model/ModelData";
import { ModelLoader } from "../../model/ModelLoader";
import { SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { SeqType } from "../seqtype/SeqType";
import { SeqTypeLoader } from "../seqtype/SeqTypeLoader";
import { VarManager } from "../vartype/VarManager";
import { NpcType } from "./NpcType";
import { NpcTypeLoader } from "./NpcTypeLoader";

export interface NpcRestModel {
    readonly npcType: NpcType;
    readonly model: Model;
}

export class NpcModelLoader {
    modelCache: Map<number, Model>;

    constructor(
        readonly npcTypeLoader: NpcTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
        readonly seqTypeLoader: SeqTypeLoader,
        readonly seqFrameLoader: SeqFrameLoader,
        readonly skeletalSeqLoader: SkeletalSeqLoader | undefined,
        readonly varManager: VarManager,
    ) {
        this.modelCache = new Map();
    }

    getModel(npcType: NpcType, seqId: number, frame: number): Model | undefined {
        const rest = this.getRestModel(npcType);
        if (!rest) {
            return undefined;
        }
        const resolvedType = rest.npcType;
        let model = rest.model;

        const hasScale = resolvedType.widthScale !== 128 || resolvedType.heightScale !== 128;
        const seqType = this.seqTypeLoader.load(seqId);
        if (seqType && seqId !== -1 && frame !== -1) {
            model = this.transformNpcModel(model, seqType, frame);
        } else if (hasScale) {
            model = Model.copyAnimated(model, true, true);
        }

        if (hasScale) {
            model.scale(resolvedType.widthScale, resolvedType.heightScale, resolvedType.widthScale);
        }
        return model;
    }

    // Resolves varbit/varp transforms first, so the returned type is the one whose model and scale
    // are actually rendered.
    getRestModel(npcType: NpcType): NpcRestModel | undefined {
        if (npcType.transforms) {
            const transformed = npcType.transform(this.varManager, this.npcTypeLoader);
            if (!transformed) {
                return undefined;
            }
            return this.getRestModel(transformed);
        }

        let model = this.modelCache.get(npcType.id);
        if (!model) {
            const models = new Array<ModelData>(npcType.modelIds.length);
            for (let i = 0; i < models.length; i++) {
                const modelData = this.modelLoader.getModel(npcType.modelIds[i]);
                if (modelData) {
                    models[i] = modelData;
                }
            }

            const merged = ModelData.merge(models, models.length);

            if (npcType.recolorFrom) {
                const retexture =
                    npcType.cacheInfo.game === "runescape" && npcType.cacheInfo.revision <= 464;
                for (let i = 0; i < npcType.recolorFrom.length; i++) {
                    merged.recolor(npcType.recolorFrom[i], npcType.recolorTo[i]);
                    if (retexture) {
                        merged.retexture(npcType.recolorFrom[i], npcType.recolorTo[i]);
                    }
                }
            }

            if (npcType.retextureFrom) {
                for (let i = 0; i < npcType.retextureFrom.length; i++) {
                    merged.retexture(npcType.retextureFrom[i], npcType.retextureTo[i]);
                }
            }

            model = merged.light(
                this.textureLoader,
                npcType.ambient + 64,
                npcType.contrast * 5 + 850,
                -30,
                -50,
                -30,
            );

            this.modelCache.set(npcType.id, model);
        }

        return { npcType, model };
    }

    transformNpcModel(model: Model, seqType: SeqType, frame: number): Model {
        if (seqType.isSkeletalSeq()) {
            const skeletalSeq = this.skeletalSeqLoader?.load(seqType.skeletalId);
            if (!skeletalSeq) {
                return Model.copyAnimated(model, true, true);
            }
            model = Model.copyAnimated(model, !skeletalSeq.hasAlphaTransform, true);

            model.animateSkeletal(skeletalSeq, frame);
        } else {
            if (!seqType.frameIds || seqType.frameIds.length === 0) {
                return Model.copyAnimated(model, true, true);
            }

            const seqFrame = this.seqFrameLoader.load(seqType.frameIds[frame]);

            if (seqFrame) {
                model = Model.copyAnimated(
                    model,
                    !seqFrame.hasAlphaTransform,
                    !seqFrame.hasColorTransform,
                );

                model.animate(seqFrame, undefined, seqType.op14);
            }
        }

        return model;
    }

    clearCache(): void {
        this.modelCache.clear();
    }
}
