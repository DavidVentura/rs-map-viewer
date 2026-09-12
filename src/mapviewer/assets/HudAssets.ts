import { CacheIndex } from "../../rs/cache/CacheIndex";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { ClickCrossKind, CrossSprites } from "../hud/ClickCross";

// Sprite group 299 (SpriteId.CROSS): the click cross's 8 frames, 4 yellow "walk here" then 4 red
// action, each animating in from a smaller first frame - verified against this cache with a
// throwaway script (not checked in).
const CROSS_SPRITE_GROUP_ID = 299;
const CROSS_SPRITE_FRAME_COUNT = 8;

export type HudAssets = {
    readonly crossSprites: CrossSprites;
};

// Every sprite id the HUD reads by id, flattened into the cache roots next to ActorAssets (see
// assets/cacheRoots.ts).
export const HUD_SPRITE_GROUP_IDS: readonly number[] = [CROSS_SPRITE_GROUP_ID];

function loadCrossSprites(spriteIndex: CacheIndex): CrossSprites {
    const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, CROSS_SPRITE_GROUP_ID);
    if (!sprites || sprites.length !== CROSS_SPRITE_FRAME_COUNT) {
        throw new Error(
            `Cross sprite group ${CROSS_SPRITE_GROUP_ID} did not decode into ` +
                `${CROSS_SPRITE_FRAME_COUNT} frames`,
        );
    }
    const frames = sprites.map((sprite) => sprite.getCanvas());
    return {
        [ClickCrossKind.WALK]: [frames[0], frames[1], frames[2], frames[3]],
        [ClickCrossKind.ACTION]: [frames[4], frames[5], frames[6], frames[7]],
    };
}

// Decoded once when the pack loads (see MapViewer.initCache), so a missing sprite throws at load
// rather than silently drawing nothing later.
export function loadHudAssets(spriteIndex: CacheIndex): HudAssets {
    return { crossSprites: loadCrossSprites(spriteIndex) };
}
