import { Model } from "../../model/Model";
import { ModelData } from "../../model/ModelData";
import { ModelLoader } from "../../model/ModelLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { ObjType } from "./ObjType";
import { ObjTypeLoader } from "./ObjTypeLoader";

// The count/stack model selection, recolour/retexture and resize an obj's ground model gets before
// any lighting is baked in - the count-resolved ObjType is included since its own ambient/contrast
// (not necessarily the id originally asked for, once a stack model has been picked) is what a
// caller lighting this itself needs to match ObjModelLoader's own lit path.
export interface UnlitObjModel {
    readonly objType: ObjType;
    readonly modelData: ModelData;
}

export class ObjModelLoader {
    modelCache: Map<number, Model>;

    constructor(
        readonly objTypeLoader: ObjTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
    ) {
        this.objTypeLoader = objTypeLoader;
        this.modelLoader = modelLoader;
        this.textureLoader = textureLoader;
        this.modelCache = new Map();
    }

    getModel(id: number, count: number): Model | undefined {
        if (id === -1) {
            return undefined;
        }

        const objType = this.objTypeLoader.load(id);
        const countId = resolveCountModelId(objType, count);
        if (countId !== -1) {
            return this.getModel(countId, 1);
        }

        let model = this.modelCache.get(id);
        if (model) {
            return model;
        }

        const modelData = buildUnlitModelData(this.modelLoader, objType);
        if (!modelData) {
            return undefined;
        }

        model = modelData.light(
            this.textureLoader,
            objType.ambient + 64,
            objType.contrast + 768,
            -50,
            -10,
            -50,
        );
        this.modelCache.set(id, model);
        return model;
    }

    // The same count/stack model selection, recolour/retexture and resize as getModel, without
    // baking in ObjModelLoader's own scenery-direction light, for callers that need to light the
    // result differently (e.g. the ground-item bake's character light).
    getUnlitModel(id: number, count: number): UnlitObjModel | undefined {
        if (id === -1) {
            return undefined;
        }

        const objType = this.objTypeLoader.load(id);
        const countId = resolveCountModelId(objType, count);
        if (countId !== -1) {
            return this.getUnlitModel(countId, 1);
        }

        const modelData = buildUnlitModelData(this.modelLoader, objType);
        if (!modelData) {
            return undefined;
        }
        return { objType, modelData };
    }

    clearCache() {
        this.modelCache.clear();
    }
}

function resolveCountModelId(objType: ObjType, count: number): number {
    if (objType.model === undefined) {
        return -1;
    }
    if (!objType.countObj || count <= 1) {
        return -1;
    }
    let countId = -1;
    for (let i = 0; i < 10; i++) {
        if (count >= objType.countCo[i] && objType.countCo[i] !== 0) {
            countId = objType.countObj[i];
        }
    }
    return countId;
}

function buildUnlitModelData(modelLoader: ModelLoader, objType: ObjType): ModelData | undefined {
    if (objType.model === undefined) {
        return undefined;
    }

    const modelData = modelLoader.getModel(objType.model);
    if (!modelData) {
        return undefined;
    }

    if (objType.resizeX !== 128 || objType.resizeY !== 128 || objType.resizeZ !== 128) {
        modelData.resize(objType.resizeX, objType.resizeY, objType.resizeZ);
    }

    if (objType.recolorFrom) {
        const retexture =
            objType.cacheInfo.game === "runescape" && objType.cacheInfo.revision <= 464;
        for (let i = 0; i < objType.recolorFrom.length; i++) {
            modelData.recolor(objType.recolorFrom[i], objType.recolorTo[i]);
            if (retexture) {
                modelData.retexture(objType.recolorFrom[i], objType.recolorTo[i]);
            }
        }
    }

    if (objType.retextureFrom) {
        for (let i = 0; i < objType.retextureFrom.length; i++) {
            modelData.retexture(objType.retextureFrom[i], objType.retextureTo[i]);
        }
    }

    return modelData;
}
