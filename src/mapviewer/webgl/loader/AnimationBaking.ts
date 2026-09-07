import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../../rs/config/npctype/NpcType";
import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { SpotAnimType } from "../../../rs/config/spotanimtype/SpotAnimType";
import { Model } from "../../../rs/model/Model";
import { ModelData } from "../../../rs/model/ModelData";
import { ModelLoader } from "../../../rs/model/ModelLoader";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { PlayerAppearance } from "../../player/PlayerAppearance";
import { PlayerModelLoader } from "../../player/PlayerModelLoader";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE } from "../DrawRange";
import { SceneBuffer } from "../buffer/SceneBuffer";

export function addNpcAnimationFrames(
    npcModelLoader: NpcModelLoader,
    sceneBuf: SceneBuffer,
    npcType: NpcType,
    seqId: number,
): AnimationFrames | undefined {
    const seqType = npcModelLoader.seqTypeLoader.load(seqId);
    if (!seqType) {
        return undefined;
    }
    let frameCount: number;
    if (seqType.isSkeletalSeq()) {
        frameCount = seqType.getSkeletalDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = npcModelLoader.getModel(npcType, seqId, i);
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

// minFaceIndex restricts what gets written to the scene buffer to faces at or past that index,
// e.g. an item baked merged with the body (for correct posing, see ActorRenderDataLoader.
// createItemAnimationSet) but written as only its own attachment mesh, discarding the body's faces
// that precede it in the merged model.
export function addPlayerAnimationFrames(
    playerModelLoader: PlayerModelLoader,
    sceneBuf: SceneBuffer,
    appearance: PlayerAppearance,
    seqId: number,
    minFaceIndex: number = 0,
): AnimationFrames | undefined {
    const seqType = playerModelLoader.seqTypeLoader.load(seqId);
    if (!seqType.frameIds || seqType.frameIds.length === 0) {
        return undefined;
    }

    const frames = new Array<DrawRange>(seqType.frameIds.length);
    const framesAlpha = new Array<DrawRange>(seqType.frameIds.length);
    let alphaFrameCount = 0;
    for (let i = 0; i < seqType.frameIds.length; i++) {
        const model = playerModelLoader.getModel(appearance, seqId, i);
        if (!model) {
            return undefined;
        }
        frames[i] = sceneBuf.addModelAnimFrame(model, false, minFaceIndex);
        framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true, minFaceIndex);
        if (framesAlpha[i][1] > 0) {
            alphaFrameCount++;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

export function addStaticModelAnimationFrames(
    sceneBuf: SceneBuffer,
    model: Model,
): AnimationFrames {
    const frame = sceneBuf.addModelAnimFrame(model, false);
    const frameAlpha = sceneBuf.addModelAnimFrame(model, true);
    return {
        frames: [frame],
        framesAlpha: frameAlpha[1] > 0 ? [frameAlpha] : undefined,
    };
}

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

export function addSpotAnimAnimationFrames(
    sceneBuf: SceneBuffer,
    seqTypeLoader: SeqTypeLoader,
    seqFrameLoader: SeqFrameLoader,
    baseModel: Model,
    seqId: number,
): AnimationFrames {
    const seqType = seqTypeLoader.load(seqId);
    if (!seqType.frameIds || seqType.frameIds.length === 0) {
        throw new Error(`Spot animation sequence ${seqId} has no frames`);
    }

    const frames = new Array<DrawRange>(seqType.frameIds.length);
    const framesAlpha = new Array<DrawRange>(seqType.frameIds.length);
    let alphaFrameCount = 0;
    for (let i = 0; i < seqType.frameIds.length; i++) {
        const seqFrame = seqFrameLoader.load(seqType.frameIds[i]);
        let frameModel = baseModel;
        if (seqFrame) {
            frameModel = Model.copyAnimated(
                baseModel,
                !seqFrame.hasAlphaTransform,
                !seqFrame.hasColorTransform,
            );
            frameModel.animate(seqFrame, undefined, seqType.op14);
        }
        frames[i] = sceneBuf.addModelAnimFrame(frameModel, false);
        framesAlpha[i] = sceneBuf.addModelAnimFrame(frameModel, true);
        if (framesAlpha[i][1] > 0) {
            alphaFrameCount++;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
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
