import { WeaponStyle } from "./Ability";
import {
    ALL_EQUIPMENT_PATHS,
    DEFAULT_EQUIPMENT,
    ELDER_MAUL_ITEM_ID,
    EQUIPMENT_PATHS,
    EquipmentPath,
    equipAtTier,
    equipmentAbilityModifiers,
    equipmentDamageTakenMultiplier,
    equipmentMaxHealthBonus,
    equippedVisualItemIds,
    isAtMaxTier,
    itemIdForTier,
    maxTierIndex,
    secondaryPathForStyle,
    visualGroupItemId,
    visualGroupItemIds,
    weaponItemId,
    weaponVisualItemIds,
} from "./Equipment";
import { MAUL_SMASH_CAST_SEQ_ID } from "./abilities";
import { DEFAULT_ABILITY_MODIFIERS, composeModifiers } from "./upgrades";

describe("equipment tier ladders", () => {
    it("every path has a non-empty ladder with unique item ids", () => {
        for (const path of ALL_EQUIPMENT_PATHS) {
            const { itemIds } = EQUIPMENT_PATHS[path];
            expect(itemIds.length).toBeGreaterThan(1);
            expect(new Set(itemIds).size).toBe(itemIds.length);
        }
    });

    it("equipAtTier never exceeds a path's max tier", () => {
        for (const path of ALL_EQUIPMENT_PATHS) {
            const bumped = equipAtTier(DEFAULT_EQUIPMENT, path, maxTierIndex(path) + 5);
            expect(bumped[path]).toBe(maxTierIndex(path));
        }
    });

    it("equipAtTier never moves a path backwards", () => {
        const atTierTwo = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.BOW, 2);
        const attemptedDowngrade = equipAtTier(atTierTwo, EquipmentPath.BOW, 0);
        expect(attemptedDowngrade[EquipmentPath.BOW]).toBe(2);
    });

    it("isAtMaxTier is false until the ladder's last tier", () => {
        const path = EquipmentPath.SCIMITAR;
        const maxTier = maxTierIndex(path);
        expect(isAtMaxTier(DEFAULT_EQUIPMENT, path)).toBe(false);
        const maxed = equipAtTier(DEFAULT_EQUIPMENT, path, maxTier);
        expect(isAtMaxTier(maxed, path)).toBe(true);
    });

    it("itemIdForTier matches the ladder's declared item ids", () => {
        const { itemIds } = EQUIPMENT_PATHS[EquipmentPath.AMULET];
        itemIds.forEach((id, tier) => {
            expect(itemIdForTier(EquipmentPath.AMULET, tier)).toBe(id);
        });
    });
});

describe("equipmentAbilityModifiers", () => {
    it("is the identity at the default (tier 0 everywhere) loadout", () => {
        for (const style of [WeaponStyle.RANGED, WeaponStyle.MELEE, WeaponStyle.MAGIC]) {
            expect(equipmentAbilityModifiers(DEFAULT_EQUIPMENT, style)).toEqual(
                DEFAULT_ABILITY_MODIFIERS,
            );
        }
    });

    it("scales ranged damage by the bow tier and adds the arrow flat bonus only for ranged", () => {
        const equipment = equipAtTier(
            equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.BOW, 2),
            EquipmentPath.ARROWS,
            3,
        );
        const ranged = equipmentAbilityModifiers(equipment, WeaponStyle.RANGED);
        expect(ranged.damageMultiplier).toBeGreaterThan(1);
        expect(ranged.flatDamageBonus).toBeGreaterThan(0);

        const melee = equipmentAbilityModifiers(equipment, WeaponStyle.MELEE);
        expect(melee.flatDamageBonus).toBe(0);
    });

    it("melee's defender speeds up attacks without touching mana cost", () => {
        const equipment = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER, 4);
        const melee = equipmentAbilityModifiers(equipment, WeaponStyle.MELEE);
        expect(melee.cooldownMultiplier).toBeLessThan(1);
        expect(melee.manaCostMultiplier).toBe(1);
    });

    it("magic's offhand reduces mana cost and adds flat damage only for magic", () => {
        const equipment = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.OFFHAND, 4);
        const magic = equipmentAbilityModifiers(equipment, WeaponStyle.MAGIC);
        expect(magic.manaCostMultiplier).toBeLessThan(1);
        expect(magic.flatDamageBonus).toBeGreaterThan(0);

        const ranged = equipmentAbilityModifiers(equipment, WeaponStyle.RANGED);
        expect(ranged.manaCostMultiplier).toBe(1);
        expect(ranged.flatDamageBonus).toBe(0);
    });

    it("the amulet adds flat damage on every style", () => {
        const equipment = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.AMULET, 3);
        for (const style of [WeaponStyle.RANGED, WeaponStyle.MELEE, WeaponStyle.MAGIC]) {
            expect(equipmentAbilityModifiers(equipment, style).flatDamageBonus).toBeGreaterThan(0);
        }
    });

    it("composes with upgrade modifiers via composeModifiers rather than overwriting them", () => {
        const upgradeModifiers = { ...DEFAULT_ABILITY_MODIFIERS, damageMultiplier: 1.2 };
        const equipment = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.BOW, 5);
        const combined = composeModifiers(
            upgradeModifiers,
            equipmentAbilityModifiers(equipment, WeaponStyle.RANGED),
        );
        expect(combined.damageMultiplier).toBeCloseTo(1.2 * 2.0);
    });
});

describe("equipmentDamageTakenMultiplier", () => {
    it("is 1 at tier 0", () => {
        expect(equipmentDamageTakenMultiplier(DEFAULT_EQUIPMENT)).toBe(1);
    });

    it("decreases as the defender is upgraded", () => {
        const equipment = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER, 5);
        expect(equipmentDamageTakenMultiplier(equipment)).toBeLessThan(1);
    });
});

describe("equipmentMaxHealthBonus", () => {
    it("grows with the amulet tier", () => {
        const low = equipmentMaxHealthBonus(DEFAULT_EQUIPMENT);
        const high = equipmentMaxHealthBonus(
            equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.AMULET, 5),
        );
        expect(high).toBeGreaterThan(low);
    });
});

describe("visualGroupItemId / visualGroupItemIds", () => {
    it("only changes when a tier crosses into a different visual group", () => {
        const base = visualGroupItemId(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER);
        const midDefender = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER, 3);
        expect(visualGroupItemId(midDefender, EquipmentPath.DEFENDER)).toBe(base);

        const maxDefender = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER, 5);
        expect(visualGroupItemId(maxDefender, EquipmentPath.DEFENDER)).not.toBe(base);
    });

    it("resolves to exactly one of the (at most 2) representative item ids visualGroupItemIds bakes", () => {
        for (const path of [EquipmentPath.DEFENDER, EquipmentPath.OFFHAND, EquipmentPath.AMULET]) {
            const representatives = visualGroupItemIds(path);
            expect(representatives.length).toBeLessThanOrEqual(2);
            for (let tier = 0; tier <= maxTierIndex(path); tier++) {
                const equipment = equipAtTier(DEFAULT_EQUIPMENT, path, tier);
                expect(representatives).toContain(visualGroupItemId(equipment, path));
            }
        }
    });
});

describe("weaponItemId / weaponVisualItemIds", () => {
    it("bow and scimitar each weapon tier introduces its own item id", () => {
        const styleAndPath = [
            { style: WeaponStyle.RANGED, path: EquipmentPath.BOW },
            { style: WeaponStyle.MELEE, path: EquipmentPath.SCIMITAR },
        ];
        for (const { style, path } of styleAndPath) {
            const ids = new Set<number>();
            for (let tier = 0; tier <= maxTierIndex(path); tier++) {
                ids.add(weaponItemId(style, equipAtTier(DEFAULT_EQUIPMENT, path, tier)));
            }
            expect(ids.size).toBe(maxTierIndex(path) + 1);
            expect(new Set(weaponVisualItemIds(style))).toEqual(ids);
        }
    });

    it("the staff's max tier introduces a new item id", () => {
        const base = weaponItemId(WeaponStyle.MAGIC, DEFAULT_EQUIPMENT);
        const maxStaff = equipAtTier(
            DEFAULT_EQUIPMENT,
            EquipmentPath.STAFF,
            maxTierIndex(EquipmentPath.STAFF),
        );
        expect(weaponItemId(WeaponStyle.MAGIC, maxStaff)).not.toBe(base);
    });
});

describe("equippedVisualItemIds", () => {
    it("wears the weapon and amulet, but no secondary, for ranged", () => {
        expect(secondaryPathForStyle(WeaponStyle.RANGED)).toBeUndefined();
        const ids = equippedVisualItemIds(WeaponStyle.RANGED, DEFAULT_EQUIPMENT, 808);
        expect(ids).toEqual([
            weaponItemId(WeaponStyle.RANGED, DEFAULT_EQUIPMENT),
            visualGroupItemId(DEFAULT_EQUIPMENT, EquipmentPath.AMULET),
        ]);
    });

    it("wears the weapon, secondary offhand and amulet for melee and magic", () => {
        for (const { style, secondaryPath } of [
            { style: WeaponStyle.MELEE, secondaryPath: EquipmentPath.DEFENDER },
            { style: WeaponStyle.MAGIC, secondaryPath: EquipmentPath.OFFHAND },
        ]) {
            expect(secondaryPathForStyle(style)).toBe(secondaryPath);
            const ids = equippedVisualItemIds(style, DEFAULT_EQUIPMENT, 808);
            expect(ids).toEqual([
                weaponItemId(style, DEFAULT_EQUIPMENT),
                visualGroupItemId(DEFAULT_EQUIPMENT, secondaryPath),
                visualGroupItemId(DEFAULT_EQUIPMENT, EquipmentPath.AMULET),
            ]);
        }
    });

    it("swaps to only the elder maul during the maul-smash special, regardless of equipment", () => {
        const equipment = equipAtTier(
            equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.SCIMITAR, 3),
            EquipmentPath.AMULET,
            5,
        );
        expect(equippedVisualItemIds(WeaponStyle.MELEE, equipment, MAUL_SMASH_CAST_SEQ_ID)).toEqual(
            [ELDER_MAUL_ITEM_ID],
        );
    });
});
