import { WeaponStyle } from "./Ability";
import { AbilityModifiers, DEFAULT_ABILITY_MODIFIERS } from "./upgrades";

// One upgrade path per weapon slot, plus a shared neck slot. Adding a slot later is data only:
// a new EquipmentPath entry in EQUIPMENT_PATHS with its own itemIds ladder and an existing
// EquipmentEffectKind (or a new one, which needs one case added to equipmentAbilityModifiers /
// equipmentDamageTakenMultiplier below).
export enum EquipmentPath {
    BOW = "bow",
    ARROWS = "arrows",
    SCIMITAR = "scimitar",
    DEFENDER = "defender",
    STAFF = "staff",
    OFFHAND = "offhand",
    AMULET = "amulet",
}

export enum EquipmentSlot {
    WEAPON = "weapon",
    AMMO = "ammo",
    OFFHAND = "offhand",
    NECK = "neck",
}

export enum EquipmentEffectKind {
    // Multiplies the caster's active style damage. One per style's main weapon path.
    WEAPON_DAMAGE = "weapon_damage",
    // Flat damage add-on, ranged only (arrows).
    AMMO_FLAT_DAMAGE = "ammo_flat_damage",
    // Melee offhand: faster attacks (cooldownMultiplier) plus a small damage-taken reduction.
    DEFENDER = "defender",
    // Magic offhand: cheaper spells (manaCostMultiplier) plus a small flat damage bonus.
    OFFHAND_CASTER = "offhand_caster",
    // Shared neck slot: flat damage and max health, on every style.
    AMULET = "amulet",
}

export type EquipmentPathDef = {
    readonly path: EquipmentPath;
    readonly slot: EquipmentSlot;
    // undefined = worn regardless of active style (currently only AMULET).
    readonly style?: WeaponStyle;
    readonly effectKind: EquipmentEffectKind;
    // Tier ladder, lowest (starting gear) first. Every ladder in this project has 6 tiers so the
    // "no drops past max tier" and per-tier effect arrays below share one length, but nothing
    // requires that going forward.
    readonly itemIds: readonly number[];
};

// bow: shortbow -> oak -> willow -> maple -> yew -> magic shortbow.
// arrows: bronze -> iron -> steel -> mithril -> adamant -> rune.
// scimitar: bronze -> iron -> mithril -> adamant -> rune -> dragon.
// defender: bronze -> iron -> steel -> mithril -> adamant -> dragon (black/rune skipped to keep
// a 6-tier ladder like every other path; dragon kept as the flashier top tier over rune).
// staff: staff -> staff of air -> staff of fire -> fire battlestaff -> mystic fire staff -> kodai
// wand.
// offhand (magic accessory book/tome): Book of Balance -> Book of War -> Book of Law -> Book of
// Darkness -> Mage's book -> Tome of Fire (empty). Not a real OSRS progression, just increasingly
// exotic tomes verified to exist and render in this cache.
// amulet: amulet of accuracy -> amulet of power -> amulet of glory -> amulet of fury -> amulet of
// torture -> amulet of rancour. All ids verified against the cache with a throwaway script
// (scripts/cache/verify-equipment-items-throwaway.ts, not checked in).
export const EQUIPMENT_PATHS: Readonly<Record<EquipmentPath, EquipmentPathDef>> = {
    [EquipmentPath.BOW]: {
        path: EquipmentPath.BOW,
        slot: EquipmentSlot.WEAPON,
        style: WeaponStyle.RANGED,
        effectKind: EquipmentEffectKind.WEAPON_DAMAGE,
        itemIds: [841, 843, 849, 853, 857, 861],
    },
    [EquipmentPath.ARROWS]: {
        path: EquipmentPath.ARROWS,
        slot: EquipmentSlot.AMMO,
        style: WeaponStyle.RANGED,
        effectKind: EquipmentEffectKind.AMMO_FLAT_DAMAGE,
        itemIds: [882, 884, 886, 888, 890, 892],
    },
    [EquipmentPath.SCIMITAR]: {
        path: EquipmentPath.SCIMITAR,
        slot: EquipmentSlot.WEAPON,
        style: WeaponStyle.MELEE,
        effectKind: EquipmentEffectKind.WEAPON_DAMAGE,
        itemIds: [1321, 1323, 1329, 1331, 1333, 4587],
    },
    [EquipmentPath.DEFENDER]: {
        path: EquipmentPath.DEFENDER,
        slot: EquipmentSlot.OFFHAND,
        style: WeaponStyle.MELEE,
        effectKind: EquipmentEffectKind.DEFENDER,
        itemIds: [8844, 8845, 8846, 8848, 8849, 12954],
    },
    [EquipmentPath.STAFF]: {
        path: EquipmentPath.STAFF,
        slot: EquipmentSlot.WEAPON,
        style: WeaponStyle.MAGIC,
        effectKind: EquipmentEffectKind.WEAPON_DAMAGE,
        itemIds: [1379, 1381, 1387, 1393, 1401, 21006],
    },
    [EquipmentPath.OFFHAND]: {
        path: EquipmentPath.OFFHAND,
        slot: EquipmentSlot.OFFHAND,
        style: WeaponStyle.MAGIC,
        effectKind: EquipmentEffectKind.OFFHAND_CASTER,
        itemIds: [3844, 12608, 12610, 12612, 6889, 20716],
    },
    [EquipmentPath.AMULET]: {
        path: EquipmentPath.AMULET,
        slot: EquipmentSlot.NECK,
        effectKind: EquipmentEffectKind.AMULET,
        itemIds: [1478, 1731, 1704, 6585, 19553, 29801],
    },
};

export const ALL_EQUIPMENT_PATHS: readonly EquipmentPath[] = Object.values(EquipmentPath);

// Short human-readable path names for the ground item floor label (see hud/hudDraw.drawGroundItemLabel).
export const EQUIPMENT_PATH_LABELS: Readonly<Record<EquipmentPath, string>> = {
    [EquipmentPath.BOW]: "Bow",
    [EquipmentPath.ARROWS]: "Arrows",
    [EquipmentPath.SCIMITAR]: "Scimitar",
    [EquipmentPath.DEFENDER]: "Defender",
    [EquipmentPath.STAFF]: "Staff",
    [EquipmentPath.OFFHAND]: "Offhand",
    [EquipmentPath.AMULET]: "Amulet",
};

export type EquipmentState = Readonly<Record<EquipmentPath, number>>;

export const DEFAULT_EQUIPMENT: EquipmentState = Object.fromEntries(
    ALL_EQUIPMENT_PATHS.map((path) => [path, 0]),
) as EquipmentState;

export function maxTierIndex(path: EquipmentPath): number {
    return EQUIPMENT_PATHS[path].itemIds.length - 1;
}

export function isAtMaxTier(equipment: EquipmentState, path: EquipmentPath): boolean {
    return equipment[path] >= maxTierIndex(path);
}

export function itemIdForTier(path: EquipmentPath, tierIndex: number): number {
    return EQUIPMENT_PATHS[path].itemIds[tierIndex];
}

// Bumps a path to a specific tier (never past its max, never backwards), returning a new state.
export function equipAtTier(
    equipment: EquipmentState,
    path: EquipmentPath,
    tierIndex: number,
): EquipmentState {
    const clamped = Math.min(Math.max(tierIndex, equipment[path]), maxTierIndex(path));
    return { ...equipment, [path]: clamped };
}

export function weaponPathForStyle(style: WeaponStyle): EquipmentPath {
    switch (style) {
        case WeaponStyle.RANGED:
            return EquipmentPath.BOW;
        case WeaponStyle.MELEE:
            return EquipmentPath.SCIMITAR;
        case WeaponStyle.MAGIC:
            return EquipmentPath.STAFF;
    }
}

// The style-specific secondary path worn alongside that style's weapon, or undefined for ranged
// (its secondary path, arrows, has no offhand model).
function secondaryOffhandPathForStyle(style: WeaponStyle): EquipmentPath | undefined {
    switch (style) {
        case WeaponStyle.MELEE:
            return EquipmentPath.DEFENDER;
        case WeaponStyle.MAGIC:
            return EquipmentPath.OFFHAND;
        case WeaponStyle.RANGED:
            return undefined;
    }
}

const WEAPON_DAMAGE_MULTIPLIER: readonly number[] = [1.0, 1.15, 1.3, 1.5, 1.75, 2.0];
const AMMO_FLAT_DAMAGE_BONUS: readonly number[] = [0, 2, 4, 7, 10, 14];
const DEFENDER_COOLDOWN_MULTIPLIER: readonly number[] = [1, 0.97, 0.94, 0.91, 0.88, 0.85];
const DEFENDER_DAMAGE_TAKEN_MULTIPLIER: readonly number[] = [1, 0.98, 0.96, 0.94, 0.92, 0.9];
const OFFHAND_MANA_COST_MULTIPLIER: readonly number[] = [1, 0.95, 0.9, 0.85, 0.8, 0.75];
const OFFHAND_FLAT_DAMAGE_BONUS: readonly number[] = [0, 1, 2, 4, 6, 8];
const AMULET_FLAT_DAMAGE_BONUS: readonly number[] = [0, 1, 3, 5, 8, 12];
const AMULET_MAX_HEALTH_BONUS: readonly number[] = [0, 5, 10, 20, 35, 50];

// Pure derivation of equipment's contribution to the effective ability numbers, in the same shape
// as an upgrade's AbilityModifiers so it composes with the upgrade-accumulated modifiers via
// composeModifiers (see upgrades.ts) and is applied through the one existing applyModifiers
// transform. Never a second copy of that transform.
export function equipmentAbilityModifiers(
    equipment: EquipmentState,
    style: WeaponStyle,
): AbilityModifiers {
    const weaponPath = weaponPathForStyle(style);
    const damageMultiplier = WEAPON_DAMAGE_MULTIPLIER[equipment[weaponPath]];

    let flatDamageBonus = AMULET_FLAT_DAMAGE_BONUS[equipment[EquipmentPath.AMULET]];
    let cooldownMultiplier = 1;
    let manaCostMultiplier = 1;

    if (style === WeaponStyle.RANGED) {
        flatDamageBonus += AMMO_FLAT_DAMAGE_BONUS[equipment[EquipmentPath.ARROWS]];
    } else if (style === WeaponStyle.MELEE) {
        cooldownMultiplier = DEFENDER_COOLDOWN_MULTIPLIER[equipment[EquipmentPath.DEFENDER]];
    } else if (style === WeaponStyle.MAGIC) {
        flatDamageBonus += OFFHAND_FLAT_DAMAGE_BONUS[equipment[EquipmentPath.OFFHAND]];
        manaCostMultiplier = OFFHAND_MANA_COST_MULTIPLIER[equipment[EquipmentPath.OFFHAND]];
    }

    return {
        ...DEFAULT_ABILITY_MODIFIERS,
        damageMultiplier,
        cooldownMultiplier,
        manaCostMultiplier,
        flatDamageBonus,
    };
}

export function equipmentMaxHealthBonus(equipment: EquipmentState): number {
    return AMULET_MAX_HEALTH_BONUS[equipment[EquipmentPath.AMULET]];
}

// Only the melee defender mitigates incoming damage in this design (see the coordinator's refined
// brief: ranged has no defensive path, magic's offhand trades mana cost for a damage bonus
// instead), and it does so regardless of the player's active style, like a permanently worn shield.
export function equipmentDamageTakenMultiplier(equipment: EquipmentState): number {
    return DEFENDER_DAMAGE_TAKEN_MULTIPLIER[equipment[EquipmentPath.DEFENDER]];
}

// --- Appearance baking -----------------------------------------------------------------------
//
// With item recolor/retexture applied (PlayerModelLoader), each of the six tiers of a weapon
// ladder renders as its own distinct color even where the underlying mesh is shared, so a
// player's weapon must be baked once per raw tier index rather than collapsed to a shared group.
//
// The secondary paths (defender/offhand/amulet) still collapse to exactly 2 groups: tier 0's
// starting look, and the top tier's look. Verified with scripts/cache/verify-final-ladders-
// throwaway.ts, only the top tier of each of those three ladders carries a genuinely different
// model; every tier in between renders identically to tier 0 (an iron/steel/mithril/adamant
// defender all look like the bronze one, only the numeric bonus differs, until the dragon
// defender at tier 5). Baking those at every tier would be pure waste, so a style's full stance
// set is baked once per combination of its own weapon tier and its secondary paths' groups.
export function secondaryVisualGroup(equipment: EquipmentState, path: EquipmentPath): 0 | 1 {
    return isAtMaxTier(equipment, path) ? 1 : 0;
}

// The weapon paths (bow/scimitar/staff) bake one visual variant per raw tier index.
export function weaponVisualGroup(equipment: EquipmentState, style: WeaponStyle): number {
    const path = weaponPathForStyle(style);
    return equipment[path];
}

export type StanceVisualKey = string;

// The key a player's current equipment resolves to for stance lookup; also used at bake time (see
// ActorRenderDataLoader) to enumerate every key worth baking.
export function stanceVisualKey(style: WeaponStyle, equipment: EquipmentState): StanceVisualKey {
    const weaponGroup = weaponVisualGroup(equipment, style);
    const amuletGroup = secondaryVisualGroup(equipment, EquipmentPath.AMULET);
    const secondaryPath = secondaryOffhandPathForStyle(style);
    const secondaryGroup = secondaryPath ? secondaryVisualGroup(equipment, secondaryPath) : 0;
    return `${style}:${weaponGroup}:${secondaryGroup}:${amuletGroup}`;
}

// Every (weaponTier, secondaryGroup, amuletGroup) combination worth baking for a style, as the
// representative equipment state to bake it with (weapon group -> that raw tier's item, secondary/
// amulet group 0 -> tier 0 item, group 1 -> the path's max tier item).
export function stanceVisualVariants(
    style: WeaponStyle,
): readonly { readonly key: StanceVisualKey; readonly equipment: EquipmentState }[] {
    const weaponPath = weaponPathForStyle(style);
    const weaponGroups = EQUIPMENT_PATHS[weaponPath].itemIds.map((_, tier) => tier);
    const secondaryPath = secondaryOffhandPathForStyle(style);
    const secondaryGroups = secondaryPath ? [0, 1] : [0];
    const amuletGroups = [0, 1];

    const variants: { key: StanceVisualKey; equipment: EquipmentState }[] = [];
    for (const weaponGroup of weaponGroups) {
        for (const secondaryGroup of secondaryGroups) {
            for (const amuletGroup of amuletGroups) {
                const equipment: EquipmentState = {
                    ...DEFAULT_EQUIPMENT,
                    [weaponPath]: weaponGroup,
                    ...(secondaryPath
                        ? {
                              [secondaryPath]:
                                  secondaryGroup === 1 ? maxTierIndex(secondaryPath) : 0,
                          }
                        : {}),
                    [EquipmentPath.AMULET]:
                        amuletGroup === 1 ? maxTierIndex(EquipmentPath.AMULET) : 0,
                };
                variants.push({ key: stanceVisualKey(style, equipment), equipment });
            }
        }
    }
    return variants;
}

// Item ids equipped in the appearance for baking a given style's stance, folding in whichever
// secondary path that style wears alongside its weapon (defender for melee, offhand book for
// magic, none for ranged) and the shared amulet.
export function stanceAppearanceItemIds(style: WeaponStyle, equipment: EquipmentState): number[] {
    const weaponPath = weaponPathForStyle(style);
    const itemIds = [itemIdForTier(weaponPath, equipment[weaponPath])];
    const secondaryPath = secondaryOffhandPathForStyle(style);
    if (secondaryPath) {
        itemIds.push(itemIdForTier(secondaryPath, equipment[secondaryPath]));
    }
    itemIds.push(itemIdForTier(EquipmentPath.AMULET, equipment[EquipmentPath.AMULET]));
    return itemIds;
}

// Every item id that can ever appear as a ground drop (every tier above tier 0, since tier 0 is
// always already worn and equipAtTier never drops below the player's current tier).
export function allDroppableItemIds(): readonly number[] {
    const ids: number[] = [];
    for (const path of ALL_EQUIPMENT_PATHS) {
        const { itemIds } = EQUIPMENT_PATHS[path];
        for (let tier = 1; tier < itemIds.length; tier++) {
            ids.push(itemIds[tier]);
        }
    }
    return ids;
}
