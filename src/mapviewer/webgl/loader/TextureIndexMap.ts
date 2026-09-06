import { TextureLoader } from "../../../rs/texture/TextureLoader";

export function buildTextureIdIndexMap(textureLoader: TextureLoader): Map<number, number> {
    const textureIds = textureLoader
        .getTextureIds()
        .filter((id) => textureLoader.isSd(id))
        .slice(0, 2047);

    const textureIdIndexMap = new Map<number, number>();
    for (let i = 0; i < textureIds.length; i++) {
        textureIdIndexMap.set(textureIds[i], i);
    }
    return textureIdIndexMap;
}
