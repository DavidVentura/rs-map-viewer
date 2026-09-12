import { SpotAnimType } from "../../../rs/config/spotanimtype/SpotAnimType";
import { Model } from "../../../rs/model/Model";
import { ModelData } from "../../../rs/model/ModelData";
import { ModelLoader } from "../../../rs/model/ModelLoader";
import { TextureLoader } from "../../../rs/texture/TextureLoader";

export function buildSpotAnimModel(
    modelLoader: ModelLoader,
    textureLoader: TextureLoader,
    spotAnim: SpotAnimType,
): Model | undefined {
    const modelData = modelLoader.getModel(spotAnim.modelId);
    if (!modelData) {
        return undefined;
    }
    const model = ModelData.merge([modelData], 1).light(
        textureLoader,
        spotAnim.ambient + 64,
        spotAnim.contrast + 768,
        -50,
        -10,
        -50,
    );
    if (spotAnim.widthScale !== 128 || spotAnim.heightScale !== 128) {
        model.scale(spotAnim.widthScale, spotAnim.heightScale, spotAnim.widthScale);
    }
    return model;
}

export function brightenModel(model: Model, lightnessBoost: number): void {
    const boost = (colors: Int32Array) => {
        for (let i = 0; i < colors.length; i++) {
            const packed = colors[i];
            if (packed === -1 || packed === -2) {
                continue;
            }
            const hsl = packed & 0xffff;
            const lightness = Math.min(126, (hsl & 0x7f) + lightnessBoost);
            colors[i] = (packed & ~0xffff) | (hsl & 0xff80) | lightness;
        }
    };
    boost(model.faceColors1);
    boost(model.faceColors2);
    boost(model.faceColors3);
}
