import { CacheIndex } from "../../rs/cache/CacheIndex";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { WeaponStyle } from "../game/Ability";
import { ActiveProtectionPrayers } from "../game/ProtectionPrayers";
import { ClickCrossKind, CrossSprites } from "../hud/ClickCross";

// Sprite group 299 (SpriteId.CROSS): the click cross's 8 frames, 4 yellow "walk here" then 4 red
// action, each animating in from a smaller first frame - verified against this cache with a
// throwaway script (not checked in).
const CROSS_SPRITE_GROUP_ID = 299;
const CROSS_SPRITE_FRAME_COUNT = 8;

// Sprite group 440 (SpriteId.HEADICONS_PRAYER), in RuneLite's HeadIcon order: melee, ranged and
// magic, then the combined ranged+magic, ranged+melee and magic+melee icons at 6, 7 and 8.
const PRAYER_HEAD_ICON_GROUP_ID = 440;
const SINGLE_PRAYER_HEAD_ICON_FRAMES: Readonly<Record<WeaponStyle, number>> = {
    [WeaponStyle.MELEE]: 0,
    [WeaponStyle.RANGED]: 1,
    [WeaponStyle.MAGIC]: 2,
};
const RANGED_MAGIC_HEAD_ICON_FRAME = 6;
// SpriteId.Hitmark's classic splats: blue for a hit that did nothing, red for damage.
const BLOCKED_HITSPLAT_SPRITE_ID = 1358;
const DAMAGE_HITSPLAT_SPRITE_ID = 1359;
const RANGED_MELEE_HEAD_ICON_FRAME = 7;
const MAGIC_MELEE_HEAD_ICON_FRAME = 8;

export type HitsplatSprites = {
    readonly blocked: CanvasImageSource;
    readonly damage: CanvasImageSource;
};

export type HudAssets = {
    readonly crossSprites: CrossSprites;
    readonly prayerHeadIcons: readonly CanvasImageSource[];
    readonly hitsplats: HitsplatSprites;
};

// Every sprite id the HUD reads by id, flattened into the cache roots next to ActorAssets (see
// assets/cacheRoots.ts).
export const HUD_SPRITE_GROUP_IDS: readonly number[] = [
    CROSS_SPRITE_GROUP_ID,
    PRAYER_HEAD_ICON_GROUP_ID,
    BLOCKED_HITSPLAT_SPRITE_ID,
    DAMAGE_HITSPLAT_SPRITE_ID,
];

export function prayerHeadIconFrame(active: ActiveProtectionPrayers): number | undefined {
    switch (active.length) {
        case 0:
            return undefined;
        case 1:
            return SINGLE_PRAYER_HEAD_ICON_FRAMES[active[0]];
        case 2: {
            const prays = (style: WeaponStyle) => active.includes(style);
            if (prays(WeaponStyle.RANGED) && prays(WeaponStyle.MAGIC)) {
                return RANGED_MAGIC_HEAD_ICON_FRAME;
            }
            if (prays(WeaponStyle.RANGED) && prays(WeaponStyle.MELEE)) {
                return RANGED_MELEE_HEAD_ICON_FRAME;
            }
            if (prays(WeaponStyle.MAGIC) && prays(WeaponStyle.MELEE)) {
                return MAGIC_MELEE_HEAD_ICON_FRAME;
            }
            throw new Error(`Both prayer slots hold the same style: ${active[0]}`);
        }
    }
}

function loadSingleSprite(spriteIndex: CacheIndex, groupId: number): CanvasImageSource {
    const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, groupId);
    if (!sprites || sprites.length !== 1) {
        throw new Error(`Sprite group ${groupId} did not decode into a single frame`);
    }
    return sprites[0].getCanvas();
}

function loadPrayerHeadIcons(spriteIndex: CacheIndex): readonly CanvasImageSource[] {
    const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, PRAYER_HEAD_ICON_GROUP_ID);
    if (!sprites || sprites.length <= MAGIC_MELEE_HEAD_ICON_FRAME) {
        throw new Error(
            `Prayer head icon group ${PRAYER_HEAD_ICON_GROUP_ID} lacks the combined prayer frames`,
        );
    }
    return sprites.map((sprite) => sprite.getCanvas());
}

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
    return {
        crossSprites: loadCrossSprites(spriteIndex),
        prayerHeadIcons: loadPrayerHeadIcons(spriteIndex),
        hitsplats: {
            blocked: loadSingleSprite(spriteIndex, BLOCKED_HITSPLAT_SPRITE_ID),
            damage: loadSingleSprite(spriteIndex, DAMAGE_HITSPLAT_SPRITE_ID),
        },
    };
}
