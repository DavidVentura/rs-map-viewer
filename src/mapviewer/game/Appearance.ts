// The player's worn appearance, modelled the way OSRS models it: 12 appearance slots (see
// AppearanceSlot), each holding either an equipped item or a body-kit part, with items able to
// hide other slots outright (a two-handed weapon hiding the shield, a full helm hiding hair and
// jaw). One pure resolver (resolveAppearance) drives both the player's baked body mesh (which body
// kit parts are visible for a style's permanently-worn armour, see ActorAssets) and which item
// attachments are drawn each frame (see Equipment.equippedVisualItemIds) - nothing else special-
// cases individual items.

// OSRS wearpos ordinals (ObjType op13/op14/op27 and the identikit's own bodyPartyId share this
// numbering). HAIR here is whatever body-kit part a full helm's own hide list targets alongside
// JAW - for the body-kit asset actually baked in this project (see ActorAssets' PLAYER_BODY_KIT)
// that's the whole head/hair/face piece, since that asset has no separate bare-face mesh to keep
// visible once a full helm covers it.
export enum AppearanceSlot {
    HEAD = 0,
    CAPE = 1,
    AMULET = 2,
    WEAPON = 3,
    TORSO = 4,
    SHIELD = 5,
    ARMS = 6,
    LEGS = 7,
    HAIR = 8,
    HANDS = 9,
    BOOTS = 10,
    JAW = 11,
}

function isAppearanceSlot(value: number): value is AppearanceSlot {
    return Number.isInteger(value) && value >= AppearanceSlot.HEAD && value <= AppearanceSlot.JAW;
}

// An equippable item's own wear info, parsed once from ObjType's op13 (wearpos)/op14 (wearpos2)/
// op27 (wearpos3) - see itemWearInfo - rather than threading raw ObjType fields through the
// appearance resolver.
export type ItemWearInfo = {
    readonly itemId: number;
    readonly slot: AppearanceSlot;
    readonly hides: readonly AppearanceSlot[];
};

// Parses one item's wear info from its cache-verified op13/op14/op27 values. Values are hardcoded
// per item elsewhere in this project (see Equipment.ts) rather than read from the cache at
// runtime, the same way other cache-verified ids in this project are: this function is what turns
// those raw numbers into a typed, pre-validated value once, at the point they're declared.
export function itemWearInfo(
    itemId: number,
    op13: number,
    op14: number,
    op27: number,
): ItemWearInfo {
    if (!isAppearanceSlot(op13)) {
        throw new RangeError(`Item ${itemId} has no wear slot (op13=${op13})`);
    }
    return { itemId, slot: op13, hides: [op14, op27].filter(isAppearanceSlot) };
}

// One of the player's always-present body regions (see ActorAssets' PLAYER_BODY_KIT): shown
// whenever nothing occupies or hides its slot. A torso kit groups every raw model that disappears
// together with it (e.g. a collar drawn as part of the shirt).
export type BodyKitPart = {
    readonly slot: AppearanceSlot;
    readonly modelIds: readonly number[];
};

export type ResolvedAppearance = {
    // Body-kit model ids to draw: every part whose slot is neither occupied by a worn item nor hidden.
    readonly bodyModelIds: readonly number[];
    // Worn item ids to draw: every item whose own slot isn't hidden by another worn item.
    readonly itemIds: readonly number[];
};

// The single OSRS-style appearance rule: each worn item occupies its own slot (replacing whatever
// body-kit part lived there) and hides every slot in its hides list; the 12 slots are otherwise
// independent. Used both to bake a style's permanently-worn armour into the body mesh (bodyKit
// non-empty) and to pick which item attachments are visible each frame (bodyKit empty) - the same
// two-handed weapon that hides a shield attachment would, with a body kit, just as generically hide
// a hair or arms body part.
export function resolveAppearance(
    bodyKit: readonly BodyKitPart[],
    items: readonly ItemWearInfo[],
): ResolvedAppearance {
    const occupiedSlots = new Set<AppearanceSlot>();
    const hiddenSlots = new Set<AppearanceSlot>();
    for (const item of items) {
        if (occupiedSlots.has(item.slot)) {
            throw new RangeError(`Two worn items both occupy appearance slot ${item.slot}`);
        }
        occupiedSlots.add(item.slot);
        for (const hidden of item.hides) {
            hiddenSlots.add(hidden);
        }
    }
    const bodyModelIds = bodyKit
        .filter((part) => !occupiedSlots.has(part.slot) && !hiddenSlots.has(part.slot))
        .flatMap((part) => part.modelIds);
    const itemIds = items.filter((item) => !hiddenSlots.has(item.slot)).map((item) => item.itemId);
    return { bodyModelIds, itemIds };
}
