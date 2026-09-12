import { WeaponStyle } from "./Ability";
import {
    ALL_EQUIPMENT_PATHS,
    DEFAULT_EQUIPMENT,
    EquipmentGrantId,
    EquipmentPath,
    allDroppableItemDrops,
    applyEquipmentGrant,
    armourItemIdsForStyle,
    createEquipmentGrant,
    equipAtTier,
    equipmentAbilityModifiers,
    equipmentDamageTakenMultiplier,
    equipmentMaxHealthBonus,
    equippedVisualItemIds,
    groundItemDisplayCount,
    isAtMaxTier,
    itemIdForTier,
    maxTierIndex,
    parseGearOverride,
    secondaryPathForStyle,
    styleSetGrant,
    visualGroupItemId,
    visualGroupItemIds,
    weaponItemId,
} from "./Equipment";
import { CLEAVE, CRYSTAL_HALBERD_ITEM_ID, ELDER_MAUL_ITEM_ID, MAUL_SMASH } from "./abilities";
import { DEFAULT_ABILITY_MODIFIERS, composeModifiers } from "./upgrades";

describe("equipment tier ladders", () => {
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
});

describe("equipment grants", () => {
    it("applies every change in a named set as one immutable transition", () => {
        const grant = styleSetGrant(WeaponStyle.MELEE, 2);
        const equipment = applyEquipmentGrant(DEFAULT_EQUIPMENT, grant);
        expect(equipment[EquipmentPath.SCIMITAR]).toBe(2);
        expect(equipment[EquipmentPath.DEFENDER]).toBe(2);
        expect(DEFAULT_EQUIPMENT[EquipmentPath.SCIMITAR]).toBe(0);
    });

    it("rejects the whole grant when any change is invalid", () => {
        expect(() =>
            createEquipmentGrant(EquipmentGrantId.MELEE_SET, "Broken set", [
                { path: EquipmentPath.SCIMITAR, tierIndex: 2 },
                { path: EquipmentPath.DEFENDER, tierIndex: 99 },
            ]),
        ).toThrow("Invalid defender tier");
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
        const equipment = equipAtTier(
            DEFAULT_EQUIPMENT,
            EquipmentPath.BOW,
            maxTierIndex(EquipmentPath.BOW),
        );
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

describe("equippedVisualItemIds", () => {
    it("wears the weapon, amulet and armour, but no secondary, for ranged", () => {
        expect(secondaryPathForStyle(WeaponStyle.RANGED)).toBeUndefined();
        const ids = equippedVisualItemIds(WeaponStyle.RANGED, DEFAULT_EQUIPMENT, undefined);
        expect(ids).toEqual([
            weaponItemId(WeaponStyle.RANGED, DEFAULT_EQUIPMENT),
            visualGroupItemId(DEFAULT_EQUIPMENT, EquipmentPath.AMULET),
            ...armourItemIdsForStyle(WeaponStyle.RANGED),
        ]);
    });

    it("wears the weapon, secondary offhand, amulet and armour for melee and magic", () => {
        for (const { style, secondaryPath } of [
            { style: WeaponStyle.MELEE, secondaryPath: EquipmentPath.DEFENDER },
            { style: WeaponStyle.MAGIC, secondaryPath: EquipmentPath.OFFHAND },
        ]) {
            expect(secondaryPathForStyle(style)).toBe(secondaryPath);
            const ids = equippedVisualItemIds(style, DEFAULT_EQUIPMENT, undefined);
            expect(ids).toEqual([
                weaponItemId(style, DEFAULT_EQUIPMENT),
                visualGroupItemId(DEFAULT_EQUIPMENT, secondaryPath),
                visualGroupItemId(DEFAULT_EQUIPMENT, EquipmentPath.AMULET),
                ...armourItemIdsForStyle(style),
            ]);
        }
    });

    it("a two-handed melee weapon (scythe of vitur) drops the defender but keeps armour and amulet", () => {
        const equipment = equipAtTier(
            DEFAULT_EQUIPMENT,
            EquipmentPath.SCIMITAR,
            maxTierIndex(EquipmentPath.SCIMITAR),
        );
        const ids = equippedVisualItemIds(WeaponStyle.MELEE, equipment, undefined);
        expect(ids).toEqual([
            weaponItemId(WeaponStyle.MELEE, equipment),
            visualGroupItemId(equipment, EquipmentPath.AMULET),
            ...armourItemIdsForStyle(WeaponStyle.MELEE),
        ]);
    });

    it("swaps to only the crystal halberd plus armour/amulet during Cleave, regardless of equipment", () => {
        const equipment = equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.DEFENDER, 5);
        expect(CLEAVE.castItemOverride).toEqual({
            itemId: CRYSTAL_HALBERD_ITEM_ID,
            hidesShield: true,
        });
        const ids = equippedVisualItemIds(WeaponStyle.MELEE, equipment, CLEAVE.castItemOverride);
        expect(ids).toEqual([
            CRYSTAL_HALBERD_ITEM_ID,
            visualGroupItemId(equipment, EquipmentPath.AMULET),
            ...armourItemIdsForStyle(WeaponStyle.MELEE),
        ]);
    });

    it("swaps to only the elder maul plus armour/amulet during the maul-smash special, regardless of equipment", () => {
        const equipment = equipAtTier(
            equipAtTier(DEFAULT_EQUIPMENT, EquipmentPath.SCIMITAR, 3),
            EquipmentPath.AMULET,
            5,
        );
        expect(MAUL_SMASH.castItemOverride).toEqual({
            itemId: ELDER_MAUL_ITEM_ID,
            hidesShield: true,
        });
        const ids = equippedVisualItemIds(
            WeaponStyle.MELEE,
            equipment,
            MAUL_SMASH.castItemOverride,
        );
        expect(ids).toEqual([
            ELDER_MAUL_ITEM_ID,
            visualGroupItemId(equipment, EquipmentPath.AMULET),
            ...armourItemIdsForStyle(WeaponStyle.MELEE),
        ]);
    });
});

describe("parseGearOverride", () => {
    it("is empty when the gear param is absent", () => {
        expect(parseGearOverride(new URLSearchParams())).toEqual([]);
    });

    it("parses one or more <path>:<tier> entries", () => {
        expect(parseGearOverride(new URLSearchParams("gear=scimitar:3,staff:2"))).toEqual([
            { path: EquipmentPath.SCIMITAR, tierIndex: 3 },
            { path: EquipmentPath.STAFF, tierIndex: 2 },
        ]);
    });

    it("throws for an unknown path", () => {
        expect(() => parseGearOverride(new URLSearchParams("gear=nunchucks:1"))).toThrow();
    });

    it("throws for a non-integer or negative tier", () => {
        expect(() => parseGearOverride(new URLSearchParams("gear=scimitar:x"))).toThrow();
        expect(() => parseGearOverride(new URLSearchParams("gear=scimitar:-1"))).toThrow();
    });

    it("throws for a tier past the path's max", () => {
        const tooHigh = maxTierIndex(EquipmentPath.SCIMITAR) + 1;
        expect(() => parseGearOverride(new URLSearchParams(`gear=scimitar:${tooHigh}`))).toThrow();
    });
});

describe("groundItemDisplayCount", () => {
    it("stacks ammo but shows every other path as a single item", () => {
        expect(groundItemDisplayCount(EquipmentPath.ARROWS)).toBeGreaterThan(1);
        const otherPaths = ALL_EQUIPMENT_PATHS.filter((path) => path !== EquipmentPath.ARROWS);
        for (const path of otherPaths) {
            expect(groundItemDisplayCount(path)).toBe(1);
        }
    });
});

describe("allDroppableItemDrops", () => {
    it("lists every tier above 0 exactly once, paired with its path's display count", () => {
        const drops = allDroppableItemDrops();
        for (const path of ALL_EQUIPMENT_PATHS) {
            const maxTier = maxTierIndex(path);
            for (let tier = 1; tier <= maxTier; tier++) {
                const itemId = itemIdForTier(path, tier);
                expect(drops).toContainEqual({
                    itemId,
                    displayCount: groundItemDisplayCount(path),
                });
            }
        }
    });

    it("never lists a path's tier-0 (starting, never-dropped) item", () => {
        const drops = allDroppableItemDrops();
        for (const path of ALL_EQUIPMENT_PATHS) {
            expect(drops.some((drop) => drop.itemId === itemIdForTier(path, 0))).toBe(false);
        }
    });
});
