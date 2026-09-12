import {
    AppearanceSlot,
    BodyKitPart,
    ItemWearInfo,
    itemWearInfo,
    resolveAppearance,
} from "./Appearance";

describe("itemWearInfo", () => {
    it("parses a plain item with no hides", () => {
        expect(itemWearInfo(1333, 3, -1, -1)).toEqual({
            itemId: 1333,
            slot: AppearanceSlot.WEAPON,
            hides: [],
        });
    });

    it("parses hides from op14 and op27, dropping unset (-1) values", () => {
        expect(itemWearInfo(1163, 0, 8, 11)).toEqual({
            itemId: 1163,
            slot: AppearanceSlot.HEAD,
            hides: [AppearanceSlot.HAIR, AppearanceSlot.JAW],
        });
    });

    it("throws for an item with no wear slot", () => {
        expect(() => itemWearInfo(999, -1, -1, -1)).toThrow(RangeError);
    });
});

const HEAD_KIT: BodyKitPart = { slot: AppearanceSlot.HAIR, modelIds: [217] };
const JAW_KIT: BodyKitPart = { slot: AppearanceSlot.JAW, modelIds: [246] };
const TORSO_KIT: BodyKitPart = { slot: AppearanceSlot.TORSO, modelIds: [28515, 320] };
const ARMS_KIT: BodyKitPart = { slot: AppearanceSlot.ARMS, modelIds: [26630] };
const LEGS_KIT: BodyKitPart = { slot: AppearanceSlot.LEGS, modelIds: [28285] };
const HANDS_KIT: BodyKitPart = { slot: AppearanceSlot.HANDS, modelIds: [176] };
const BOOTS_KIT: BodyKitPart = { slot: AppearanceSlot.BOOTS, modelIds: [185] };
const FULL_BODY_KIT: readonly BodyKitPart[] = [
    HEAD_KIT,
    JAW_KIT,
    TORSO_KIT,
    ARMS_KIT,
    LEGS_KIT,
    HANDS_KIT,
    BOOTS_KIT,
];

describe("resolveAppearance", () => {
    it("shows every body-kit part when nothing is worn", () => {
        const resolved = resolveAppearance(FULL_BODY_KIT, []);
        expect(new Set(resolved.bodyModelIds)).toEqual(
            new Set([217, 246, 28515, 320, 26630, 28285, 176, 185]),
        );
        expect(resolved.itemIds).toEqual([]);
    });

    it("a torso item replaces the torso kit but leaves arms/legs alone", () => {
        const blackDhideBody = itemWearInfo(2503, AppearanceSlot.TORSO, -1, -1);
        const resolved = resolveAppearance(FULL_BODY_KIT, [blackDhideBody]);
        expect(resolved.bodyModelIds).not.toContain(28515);
        expect(resolved.bodyModelIds).not.toContain(320);
        expect(resolved.bodyModelIds).toContain(26630);
        expect(resolved.bodyModelIds).toContain(28285);
        expect(resolved.itemIds).toEqual([2503]);
    });

    it("a torso item that hides arms removes both the torso and arms kit (rune platebody)", () => {
        const runePlatebody = itemWearInfo(1127, AppearanceSlot.TORSO, AppearanceSlot.ARMS, -1);
        const resolved = resolveAppearance(FULL_BODY_KIT, [runePlatebody]);
        expect(resolved.bodyModelIds).not.toContain(28515);
        expect(resolved.bodyModelIds).not.toContain(26630);
        expect(resolved.bodyModelIds).toContain(176);
        expect(resolved.bodyModelIds).toContain(185);
    });

    it("a full helm hides hair and jaw without occupying either slot", () => {
        const runeFullHelm = itemWearInfo(
            1163,
            AppearanceSlot.HEAD,
            AppearanceSlot.HAIR,
            AppearanceSlot.JAW,
        );
        const resolved = resolveAppearance(FULL_BODY_KIT, [runeFullHelm]);
        expect(resolved.bodyModelIds).not.toContain(217);
        expect(resolved.bodyModelIds).not.toContain(246);
        expect(resolved.itemIds).toEqual([1163]);
    });

    it("a two-handed weapon hides a worn shield-slot item generically, with no body kit involved", () => {
        const scythe = itemWearInfo(22325, AppearanceSlot.WEAPON, AppearanceSlot.SHIELD, -1);
        const defender: ItemWearInfo = itemWearInfo(8844, AppearanceSlot.SHIELD, -1, -1);
        const resolved = resolveAppearance([], [scythe, defender]);
        expect(resolved.itemIds).toEqual([22325]);
    });

    it("a one-handed weapon leaves a worn shield-slot item visible", () => {
        const whip = itemWearInfo(4151, AppearanceSlot.WEAPON, -1, -1);
        const defender = itemWearInfo(8844, AppearanceSlot.SHIELD, -1, -1);
        const resolved = resolveAppearance([], [whip, defender]);
        expect(new Set(resolved.itemIds)).toEqual(new Set([4151, 8844]));
    });

    it("throws when two worn items occupy the same slot", () => {
        const a = itemWearInfo(1, AppearanceSlot.WEAPON, -1, -1);
        const b = itemWearInfo(2, AppearanceSlot.WEAPON, -1, -1);
        expect(() => resolveAppearance([], [a, b])).toThrow(RangeError);
    });
});
