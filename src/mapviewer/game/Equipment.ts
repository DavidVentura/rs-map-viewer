import { WeaponStyle } from "./Ability";
import { MAUL_SMASH_CAST_SEQ_ID } from "./abilities";
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

// --- Appearance (player attachments) ----------------------------------------------------------
//
// The player's body model never changes with equipment (no armour slots in this project, only
// weapon/offhand/neck), so it is baked once per style, unposed by any item. Each equipped item is
// baked separately as its own worn-model attachment and drawn as its own actor instance next to
// the body (see ActorRenderDataLoader.createPlayerActorData / WebGLMapViewerRenderer.
// buildActorInstanceData) rather than merged into one huge per-combination mesh.
//
// With item recolor/retexture applied (PlayerModelLoader), each of the six tiers of a weapon
// ladder renders as its own distinct color even where the underlying mesh is shared, so a weapon
// must be baked once per raw tier index rather than collapsed to a shared group.
//
// The secondary paths (defender/offhand/amulet) still collapse to exactly 2 groups: tier 0's
// starting look, and the top tier's look. Verified with scripts/cache/verify-final-ladders-
// throwaway.ts, only the top tier of each of those three ladders carries a genuinely different
// model; every tier in between renders identically to tier 0 (an iron/steel/mithril/adamant
// defender all look like the bronze one, only the numeric bonus differs, until the dragon
// defender at tier 5). Baking those at every tier would be pure waste, so only 2 representative
// item ids are baked per secondary path.
export function secondaryVisualGroup(equipment: EquipmentState, path: EquipmentPath): 0 | 1 {
    return isAtMaxTier(equipment, path) ? 1 : 0;
}

// The item id currently worn on a style's weapon slot (one distinct bake per raw tier index).
export function weaponItemId(style: WeaponStyle, equipment: EquipmentState): number {
    const path = weaponPathForStyle(style);
    return itemIdForTier(path, equipment[path]);
}

// The item id currently worn for a secondary/amulet-style path, collapsed to whichever of the 2
// baked representative ids (tier 0's or the max tier's) that equipment state visually resolves to.
export function visualGroupItemId(equipment: EquipmentState, path: EquipmentPath): number {
    return itemIdForTier(
        path,
        secondaryVisualGroup(equipment, path) === 1 ? maxTierIndex(path) : 0,
    );
}

// Every raw tier's item id for a style's weapon path - the full set worth baking as an attachment.
export function weaponVisualItemIds(style: WeaponStyle): readonly number[] {
    return EQUIPMENT_PATHS[weaponPathForStyle(style)].itemIds;
}

// The (at most 2) visually distinct representative item ids for a secondary/amulet-style path.
export function visualGroupItemIds(path: EquipmentPath): readonly number[] {
    const tier0 = itemIdForTier(path, 0);
    const maxTier = itemIdForTier(path, maxTierIndex(path));
    return tier0 === maxTier ? [tier0] : [tier0, maxTier];
}

// The melee maul-smash special swaps the equipped weapon for a fixed, more dramatic-looking item
// for that one cast animation regardless of the player's actual scimitar tier, and drops the
// secondary/amulet attachments entirely for it.
export const ELDER_MAUL_ITEM_ID = 21003;
const WEAPON_OVERRIDE_SEQ_ID = MAUL_SMASH_CAST_SEQ_ID;

// Every item id worn as a player attachment for the given style/equipment while seqId is playing:
// the equipped weapon, that style's secondary offhand if it has one, and the shared amulet - or
// just the maul-smash override item alone when that special applies. The single source of truth
// for which attachment instances WebGLMapViewerRenderer.buildActorInstanceData pushes each frame,
// and (via the seq sets each item needs) for what ActorRenderDataLoader bakes up front.
export function equippedVisualItemIds(
    style: WeaponStyle,
    equipment: EquipmentState,
    seqId: number,
): readonly number[] {
    if (seqId === WEAPON_OVERRIDE_SEQ_ID) {
        return [ELDER_MAUL_ITEM_ID];
    }
    const secondaryPath = secondaryOffhandPathForStyle(style);
    return [
        weaponItemId(style, equipment),
        ...(secondaryPath ? [visualGroupItemId(equipment, secondaryPath)] : []),
        visualGroupItemId(equipment, EquipmentPath.AMULET),
    ];
}

// A style's secondary offhand path (defender for melee, offhand book for magic), or undefined for
// ranged (its secondary path, arrows, has no offhand model). Exposed for the bake-time item/seq
// enumeration in ActorRenderDataLoader; equippedVisualItemIds is the runtime-facing equivalent.
export function secondaryPathForStyle(style: WeaponStyle): EquipmentPath | undefined {
    return secondaryOffhandPathForStyle(style);
}

// Every seq id at which a weapon/secondary attachment is actually shown (excludes the maul-smash
// special, which swaps the weapon slot for ELDER_MAUL_ITEM_ID and hides the secondary entirely).
export function attachmentVisibleSeqIds(styleSeqIds: readonly number[]): readonly number[] {
    return styleSeqIds.filter((seqId) => seqId !== WEAPON_OVERRIDE_SEQ_ID);
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
