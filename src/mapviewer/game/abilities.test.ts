import { WeaponStyle } from "./Ability";
import {
    CAST_ITEM_OVERRIDES_BY_SEQ_ID,
    CLEAVE,
    CLEAVE_CAST_SEQ_ID,
    CRYSTAL_HALBERD_ITEM_ID,
    ELDER_MAUL_ITEM_ID,
    HEALING_POTION,
    MAUL_SMASH,
    MAUL_SMASH_CAST_SEQ_ID,
    WEAPON_LADDERS,
    allPlayerAbilities,
} from "./abilities";

describe("WEAPON_LADDERS", () => {
    it("every style has a 4-tier ladder, one basic attack per tier", () => {
        for (const style of [WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC]) {
            expect(WEAPON_LADDERS[style]).toHaveLength(4);
        }
    });

    it("every tier's item id and basic attack id are unique within a style", () => {
        for (const style of [WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC]) {
            const tiers = WEAPON_LADDERS[style];
            expect(new Set(tiers.map((tier) => tier.itemId)).size).toBe(tiers.length);
            expect(new Set(tiers.map((tier) => tier.basicAttack.id)).size).toBe(tiers.length);
        }
    });
});

describe("allPlayerAbilities", () => {
    it("has no duplicate ability ids, other than healing_potion shared by every style", () => {
        const ids = allPlayerAbilities().map((ability) => ability.id);
        const counts = new Map<string, number>();
        for (const id of ids) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const [id, count] of counts) {
            expect(count === 1 || id === HEALING_POTION.id).toBe(true);
        }
    });

    it("includes every weapon tier's basic attack and every skill", () => {
        const ids = new Set(allPlayerAbilities().map((ability) => ability.id));
        for (const style of [WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC]) {
            for (const tier of WEAPON_LADDERS[style]) {
                expect(ids.has(tier.basicAttack.id)).toBe(true);
            }
        }
        expect(ids.has(CLEAVE.id)).toBe(true);
        expect(ids.has(MAUL_SMASH.id)).toBe(true);
    });
});

describe("CAST_ITEM_OVERRIDES_BY_SEQ_ID", () => {
    it("maps Cleave's cast seq to the crystal halberd, two-handed", () => {
        expect(CAST_ITEM_OVERRIDES_BY_SEQ_ID.get(CLEAVE_CAST_SEQ_ID)).toEqual({
            itemId: CRYSTAL_HALBERD_ITEM_ID,
            hidesShield: true,
        });
    });

    it("maps Maul Smash's cast seq to the elder maul, two-handed", () => {
        expect(CAST_ITEM_OVERRIDES_BY_SEQ_ID.get(MAUL_SMASH_CAST_SEQ_ID)).toEqual({
            itemId: ELDER_MAUL_ITEM_ID,
            hidesShield: true,
        });
    });

    it("has no entry for an ability with no cast-item override", () => {
        expect(
            CAST_ITEM_OVERRIDES_BY_SEQ_ID.get(
                WEAPON_LADDERS[WeaponStyle.MELEE][0].basicAttack.castSeqId,
            ),
        ).toBeUndefined();
    });
});
