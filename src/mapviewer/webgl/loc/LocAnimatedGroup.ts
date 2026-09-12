import { SkinAnimation } from "../skin/SkinAnimation";
import { SceneLocEntity } from "./SceneLocEntity";

export type LocAnimatedGroup = {
    animation: SkinAnimation;
    locs: SceneLocEntity[];
};
