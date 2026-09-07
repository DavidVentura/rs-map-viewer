import { WeaponStyle } from "./Ability";
import {
    ALL_EQUIPMENT_PATHS,
    DEFAULT_EQUIPMENT,
    EQUIPMENT_PATHS,
    EquipmentPath,
    equipAtTier,
    equipmentAbilityModifiers,
    equipmentDamageTakenMultiplier,
    equipmentMaxHealthBonus,
    isAtMaxTier,
    itemIdForTier,
    maxTierIndex,
    stanceVisualKey,
    stanceVisualVariants,
} from "./Equipment";
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

describe("stanceVisualKey / stanceVisualVariants", () => {
    it("only changes when a tier crosses into a different visual group", () => {
        const base = stanceVisualKey(WeaponStyle.MELEE, DEFAULT_EQUIPMENT);
        const midDefender = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER, 3);
        expect(stanceVisualKey(WeaponStyle.MELEE, midDefender)).toBe(base);

        const maxDefender = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER, 5);
        expect(stanceVisualKey(WeaponStyle.MELEE, maxDefender)).not.toBe(base);
    });

    it("bow and scimitar each weapon tier introduces its own visual group", () => {
        const styleAndPath = [
            { style: WeaponStyle.RANGED, path: EquipmentPath.BOW },
            { style: WeaponStyle.MELEE, path: EquipmentPath.SCIMITAR },
        ];
        for (const { style, path } of styleAndPath) {
            const keys = new Set<string>();
            for (let tier = 0; tier <= maxTierIndex(path); tier++) {
                keys.add(stanceVisualKey(style, equipAtTier(DEFAULT_EQUIPMENT, path, tier)));
            }
            expect(keys.size).toBe(maxTierIndex(path) + 1);
        }
    });

    it("the staff's max tier introduces a new visual group", () => {
        const base = stanceVisualKey(WeaponStyle.MAGIC, DEFAULT_EQUIPMENT);
        const maxStaff = equipAtTier(
            DEFAULT_EQUIPMENT,
            EquipmentPath.STAFF,
            maxTierIndex(EquipmentPath.STAFF),
        );
        expect(stanceVisualKey(WeaponStyle.MAGIC, maxStaff)).not.toBe(base);
    });

    it("enumerates every variant with a distinct key, and every current-equipment key resolves to one of them", () => {
        for (const style of [WeaponStyle.RANGED, WeaponStyle.MELEE, WeaponStyle.MAGIC]) {
            const variants = stanceVisualVariants(style);
            const keys = new Set(variants.map((variant) => variant.key));
            expect(keys.size).toBe(variants.length);
            expect(keys.has(stanceVisualKey(style, DEFAULT_EQUIPMENT))).toBe(true);
        }
    });
});
