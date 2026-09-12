import { CastItemOverride, WeaponStyle } from "./Ability";
import { AppearanceSlot, ItemWearInfo, itemWearInfo, resolveAppearance } from "./Appearance";
import {
    DRAGON_2H_SWORD_ITEM_ID,
    DRAGON_SCIMITAR_ITEM_ID,
    RUNE_SCIMITAR_ITEM_ID,
    SCYTHE_OF_VITUR_ITEM_ID,
    STAFF_ITEM_ID,
    SWAMP_TRIDENT_ITEM_ID,
    TUMEKENS_SHADOW_ITEM_ID,
    WARPED_SCEPTRE_ITEM_ID,
    WEAPON_LADDERS,
} from "./abilities";
import { AbilityModifiers, DEFAULT_ABILITY_MODIFIERS } from "./upgrades";

// Starting armour item ids, one per style, verified to exist and render in this cache with a
// throwaway script (scripts/cache/verify-armour-throwaway.ts, not checked in).
const RUNE_FULL_HELM_ITEM_ID = 1163;
const RUNE_PLATEBODY_ITEM_ID = 1127;
const RUNE_PLATELEGS_ITEM_ID = 1079;
const BLACK_DHIDE_BODY_ITEM_ID = 2503;
const BLACK_DHIDE_CHAPS_ITEM_ID = 2497;
const MYSTIC_HAT_ITEM_ID = 4089;
const MYSTIC_ROBE_TOP_ITEM_ID = 4091;
const MYSTIC_ROBE_BOTTOM_ITEM_ID = 4093;

// One upgrade path per weapon slot, a shared neck slot, and one single-tier path per permanently-
// worn armour piece (helm/body/legs). Adding a slot later is data only: a new EquipmentPath entry
// in EQUIPMENT_PATHS with its own itemIds ladder and an existing EquipmentEffectKind (or a new one,
// which needs one case added to equipmentAbilityModifiers / equipmentDamageTakenMultiplier below).
export enum EquipmentPath {
    BOW = "bow",
    ARROWS = "arrows",
    SCIMITAR = "scimitar",
    DEFENDER = "defender",
    STAFF = "staff",
    OFFHAND = "offhand",
    AMULET = "amulet",
    MELEE_HELM = "melee_helm",
    MELEE_BODY = "melee_body",
    MELEE_LEGS = "melee_legs",
    RANGED_BODY = "ranged_body",
    RANGED_LEGS = "ranged_legs",
    MAGIC_HELM = "magic_helm",
    MAGIC_BODY = "magic_body",
    MAGIC_LEGS = "magic_legs",
}

export enum EquipmentSlot {
    WEAPON = "weapon",
    AMMO = "ammo",
    OFFHAND = "offhand",
    NECK = "neck",
    HEAD = "head",
    BODY = "body",
    LEGS = "legs",
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
    // Purely visual: a style's permanently-worn armour piece. No numeric effect.
    COSMETIC = "cosmetic",
}

export type EquipmentPathDef = {
    readonly path: EquipmentPath;
    readonly slot: EquipmentSlot;
    // undefined = worn regardless of active style (currently only AMULET).
    readonly style?: WeaponStyle;
    readonly effectKind: EquipmentEffectKind;
    // Tier ladder, lowest (starting gear) first. The weapon ladders are 4 tiers (tied to
    // WEAPON_LADDERS, see below); arrows/defender/offhand/amulet stay at their original 6; the
    // armour paths are single-tier (always worn, never upgraded).
    readonly itemIds: readonly number[];
    // Each tier's wear info (same length/order as itemIds), for resolveAppearance - see
    // equippedVisualItemIds and ActorAssets' per-style body bake.
    readonly wearInfo: readonly ItemWearInfo[];
};

function weaponLadderIds(style: WeaponStyle): readonly number[] {
    return WEAPON_LADDERS[style].map((tier) => tier.itemId);
}

// Every tier of a path that always occupies the same slot and never hides anything else (true of
// every defender/offhand/amulet tier verified against the cache).
function sameSlotWearInfo(
    itemIds: readonly number[],
    slot: AppearanceSlot,
): readonly ItemWearInfo[] {
    return itemIds.map((itemId) => itemWearInfo(itemId, slot, -1, -1));
}

// bow: shortbow -> magic shortbow -> Bow of Faerdhinen -> twisted bow.
// arrows: bronze -> iron -> steel -> mithril -> adamant -> rune.
// scimitar: rune -> dragon -> dragon 2h sword -> scythe of vitur.
// defender: bronze -> iron -> steel -> mithril -> adamant -> dragon (black/rune skipped to keep
// a 6-tier ladder like every other path; dragon kept as the flashier top tier over rune).
// staff: staff -> warped sceptre -> trident of the swamp -> Tumeken's shadow.
// offhand (magic accessory book/tome): Book of Balance -> Book of War -> Book of Law -> Book of
// Darkness -> Mage's book -> Tome of Fire (empty). Not a real OSRS progression, just increasingly
// exotic tomes verified to exist and render in this cache.
// amulet: amulet of accuracy -> amulet of power -> amulet of glory -> amulet of fury -> amulet of
// torture -> amulet of rancour. All ids verified against the cache with a throwaway script
// (scripts/cache/verify-equipment-items-throwaway.ts, not checked in).
// The weapon ladders' item ids come from abilities.WEAPON_LADDERS (which pairs each tier's item
// with its own basic attack), so the ladder here and the basic-attack-by-tier array in abilities.ts
// can never drift apart in length.
//
// Every wearpos (op13)/wearpos2 (op14)/wearpos3 (op27) value below was verified against the cache
// with the same throwaway script.
export const EQUIPMENT_PATHS: Readonly<Record<EquipmentPath, EquipmentPathDef>> = {
    [EquipmentPath.BOW]: {
        path: EquipmentPath.BOW,
        slot: EquipmentSlot.WEAPON,
        style: WeaponStyle.RANGED,
        effectKind: EquipmentEffectKind.WEAPON_DAMAGE,
        itemIds: weaponLadderIds(WeaponStyle.RANGED),
        wearInfo: weaponLadderIds(WeaponStyle.RANGED).map((itemId) =>
            itemWearInfo(itemId, AppearanceSlot.WEAPON, AppearanceSlot.SHIELD, -1),
        ),
    },
    [EquipmentPath.ARROWS]: {
        path: EquipmentPath.ARROWS,
        slot: EquipmentSlot.AMMO,
        style: WeaponStyle.RANGED,
        effectKind: EquipmentEffectKind.AMMO_FLAT_DAMAGE,
        itemIds: [882, 884, 886, 888, 890, 892],
        // Ammo has no player-model attachment in this project (OSRS doesn't render arrows on the
        // body outside a quiver either), so it never appears in equippedVisualItemIds's item list.
        wearInfo: [],
    },
    [EquipmentPath.SCIMITAR]: {
        path: EquipmentPath.SCIMITAR,
        slot: EquipmentSlot.WEAPON,
        style: WeaponStyle.MELEE,
        effectKind: EquipmentEffectKind.WEAPON_DAMAGE,
        itemIds: weaponLadderIds(WeaponStyle.MELEE),
        wearInfo: [
            itemWearInfo(RUNE_SCIMITAR_ITEM_ID, AppearanceSlot.WEAPON, -1, -1),
            itemWearInfo(DRAGON_SCIMITAR_ITEM_ID, AppearanceSlot.WEAPON, -1, -1),
            // Two-handed, like every other 2h weapon in this project: hides the shield slot.
            itemWearInfo(DRAGON_2H_SWORD_ITEM_ID, AppearanceSlot.WEAPON, AppearanceSlot.SHIELD, -1),
            itemWearInfo(SCYTHE_OF_VITUR_ITEM_ID, AppearanceSlot.WEAPON, AppearanceSlot.SHIELD, -1),
        ],
    },
    [EquipmentPath.DEFENDER]: {
        path: EquipmentPath.DEFENDER,
        slot: EquipmentSlot.OFFHAND,
        style: WeaponStyle.MELEE,
        effectKind: EquipmentEffectKind.DEFENDER,
        itemIds: [8844, 8845, 8846, 8848, 8849, 12954],
        wearInfo: sameSlotWearInfo([8844, 8845, 8846, 8848, 8849, 12954], AppearanceSlot.SHIELD),
    },
    [EquipmentPath.STAFF]: {
        path: EquipmentPath.STAFF,
        slot: EquipmentSlot.WEAPON,
        style: WeaponStyle.MAGIC,
        effectKind: EquipmentEffectKind.WEAPON_DAMAGE,
        itemIds: weaponLadderIds(WeaponStyle.MAGIC),
        wearInfo: [
            itemWearInfo(STAFF_ITEM_ID, AppearanceSlot.WEAPON, -1, -1),
            itemWearInfo(WARPED_SCEPTRE_ITEM_ID, AppearanceSlot.WEAPON, -1, -1),
            itemWearInfo(SWAMP_TRIDENT_ITEM_ID, AppearanceSlot.WEAPON, -1, -1),
            itemWearInfo(TUMEKENS_SHADOW_ITEM_ID, AppearanceSlot.WEAPON, AppearanceSlot.SHIELD, -1),
        ],
    },
    [EquipmentPath.OFFHAND]: {
        path: EquipmentPath.OFFHAND,
        slot: EquipmentSlot.OFFHAND,
        style: WeaponStyle.MAGIC,
        effectKind: EquipmentEffectKind.OFFHAND_CASTER,
        itemIds: [3844, 12608, 12610, 12612, 6889, 20716],
        wearInfo: sameSlotWearInfo([3844, 12608, 12610, 12612, 6889, 20716], AppearanceSlot.SHIELD),
    },
    [EquipmentPath.AMULET]: {
        path: EquipmentPath.AMULET,
        slot: EquipmentSlot.NECK,
        effectKind: EquipmentEffectKind.AMULET,
        itemIds: [1478, 1731, 1704, 6585, 19553, 29801],
        wearInfo: sameSlotWearInfo([1478, 1731, 1704, 6585, 19553, 29801], AppearanceSlot.AMULET),
    },
    // Starting armour, permanently worn while its style is active (see armourPathsForStyle). Single
    // tier: never upgraded, never dropped (allDroppableItemDrops only lists tiers above 0).
    [EquipmentPath.MELEE_HELM]: {
        path: EquipmentPath.MELEE_HELM,
        slot: EquipmentSlot.HEAD,
        style: WeaponStyle.MELEE,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [RUNE_FULL_HELM_ITEM_ID],
        wearInfo: [
            itemWearInfo(
                RUNE_FULL_HELM_ITEM_ID,
                AppearanceSlot.HEAD,
                AppearanceSlot.HAIR,
                AppearanceSlot.JAW,
            ),
        ],
    },
    [EquipmentPath.MELEE_BODY]: {
        path: EquipmentPath.MELEE_BODY,
        slot: EquipmentSlot.BODY,
        style: WeaponStyle.MELEE,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [RUNE_PLATEBODY_ITEM_ID],
        wearInfo: [
            itemWearInfo(RUNE_PLATEBODY_ITEM_ID, AppearanceSlot.TORSO, AppearanceSlot.ARMS, -1),
        ],
    },
    [EquipmentPath.MELEE_LEGS]: {
        path: EquipmentPath.MELEE_LEGS,
        slot: EquipmentSlot.LEGS,
        style: WeaponStyle.MELEE,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [RUNE_PLATELEGS_ITEM_ID],
        wearInfo: [itemWearInfo(RUNE_PLATELEGS_ITEM_ID, AppearanceSlot.LEGS, -1, -1)],
    },
    [EquipmentPath.RANGED_BODY]: {
        path: EquipmentPath.RANGED_BODY,
        slot: EquipmentSlot.BODY,
        style: WeaponStyle.RANGED,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [BLACK_DHIDE_BODY_ITEM_ID],
        wearInfo: [itemWearInfo(BLACK_DHIDE_BODY_ITEM_ID, AppearanceSlot.TORSO, -1, -1)],
    },
    [EquipmentPath.RANGED_LEGS]: {
        path: EquipmentPath.RANGED_LEGS,
        slot: EquipmentSlot.LEGS,
        style: WeaponStyle.RANGED,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [BLACK_DHIDE_CHAPS_ITEM_ID],
        wearInfo: [itemWearInfo(BLACK_DHIDE_CHAPS_ITEM_ID, AppearanceSlot.LEGS, -1, -1)],
    },
    [EquipmentPath.MAGIC_HELM]: {
        path: EquipmentPath.MAGIC_HELM,
        slot: EquipmentSlot.HEAD,
        style: WeaponStyle.MAGIC,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [MYSTIC_HAT_ITEM_ID],
        wearInfo: [itemWearInfo(MYSTIC_HAT_ITEM_ID, AppearanceSlot.HEAD, -1, -1)],
    },
    [EquipmentPath.MAGIC_BODY]: {
        path: EquipmentPath.MAGIC_BODY,
        slot: EquipmentSlot.BODY,
        style: WeaponStyle.MAGIC,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [MYSTIC_ROBE_TOP_ITEM_ID],
        wearInfo: [
            itemWearInfo(MYSTIC_ROBE_TOP_ITEM_ID, AppearanceSlot.TORSO, AppearanceSlot.ARMS, -1),
        ],
    },
    [EquipmentPath.MAGIC_LEGS]: {
        path: EquipmentPath.MAGIC_LEGS,
        slot: EquipmentSlot.LEGS,
        style: WeaponStyle.MAGIC,
        effectKind: EquipmentEffectKind.COSMETIC,
        itemIds: [MYSTIC_ROBE_BOTTOM_ITEM_ID],
        wearInfo: [itemWearInfo(MYSTIC_ROBE_BOTTOM_ITEM_ID, AppearanceSlot.LEGS, -1, -1)],
    },
};

export const ALL_EQUIPMENT_PATHS: readonly EquipmentPath[] = Object.values(EquipmentPath);

export type EquipmentState = Readonly<Record<EquipmentPath, number>>;

export type EquipmentChange = {
    readonly path: EquipmentPath;
    readonly tierIndex: number;
};

export enum EquipmentGrantId {
    INDIVIDUAL = "individual",
    RANGED_SET = "ranged_set",
    MELEE_SET = "melee_set",
    MAGIC_SET = "magic_set",
}

export type EquipmentGrant = {
    readonly id: EquipmentGrantId;
    readonly label: string;
    readonly changes: readonly [EquipmentChange, ...EquipmentChange[]];
};

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

export function createEquipmentGrant(
    id: EquipmentGrantId,
    label: string,
    changes: readonly EquipmentChange[],
): EquipmentGrant {
    if (label.trim().length === 0 || changes.length === 0) {
        throw new RangeError("An equipment grant requires a label and at least one change");
    }
    if (new Set(changes.map(({ path }) => path)).size !== changes.length) {
        throw new RangeError("An equipment grant cannot change one path twice");
    }
    for (const change of changes) {
        if (
            !Number.isInteger(change.tierIndex) ||
            change.tierIndex < 0 ||
            change.tierIndex > maxTierIndex(change.path)
        ) {
            throw new RangeError(`Invalid ${change.path} tier: ${change.tierIndex}`);
        }
    }
    return { id, label, changes: [changes[0], ...changes.slice(1)] };
}

export function applyEquipmentGrant(
    equipment: EquipmentState,
    grant: EquipmentGrant,
): EquipmentState {
    return grant.changes.reduce(
        (state, { path, tierIndex }) => ({ ...state, [path]: Math.max(state[path], tierIndex) }),
        equipment,
    );
}

export function styleSetGrant(style: WeaponStyle, tierIndex: number): EquipmentGrant {
    switch (style) {
        case WeaponStyle.RANGED:
            return createEquipmentGrant(EquipmentGrantId.RANGED_SET, "Ranged set", [
                { path: EquipmentPath.BOW, tierIndex },
                { path: EquipmentPath.ARROWS, tierIndex },
            ]);
        case WeaponStyle.MELEE:
            return createEquipmentGrant(EquipmentGrantId.MELEE_SET, "Melee set", [
                { path: EquipmentPath.SCIMITAR, tierIndex },
                { path: EquipmentPath.DEFENDER, tierIndex },
            ]);
        case WeaponStyle.MAGIC:
            return createEquipmentGrant(EquipmentGrantId.MAGIC_SET, "Magic set", [
                { path: EquipmentPath.STAFF, tierIndex },
                { path: EquipmentPath.OFFHAND, tierIndex },
            ]);
    }
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

// Re-spread from the old 6-tier [1.0, 1.15, 1.3, 1.5, 1.75, 2.0] over the weapon ladders' new 4
// tiers, linearly interpolated between the same endpoints (1.0 at tier 0, 2.0 at the top tier).
const WEAPON_DAMAGE_MULTIPLIER: readonly number[] = [1.0, 1.33, 1.67, 2.0];

// Every weapon ladder's item-id array is built from abilities.WEAPON_LADDERS (see weaponLadderIds),
// so it can never drift from the basic-attack-by-tier array paired with it there; this only pins
// the shared per-tier damage multiplier above to that same tier count.
for (const style of [WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC]) {
    const ladderLength = WEAPON_LADDERS[style].length;
    if (ladderLength !== WEAPON_DAMAGE_MULTIPLIER.length) {
        throw new RangeError(
            `Weapon ladder for style ${style} has ${ladderLength} tiers, expected ${WEAPON_DAMAGE_MULTIPLIER.length}`,
        );
    }
}

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

// --- Appearance (player attachments and body kit) -----------------------------------------------
//
// Every equipped item is baked as its own worn-model attachment and drawn as its own actor instance
// next to the body (see ActorRenderDataLoader.createPlayerActorData / WebGLMapViewerRenderer.
// buildActorInstanceData) rather than merged into one huge per-combination mesh. The body itself is
// baked once per style (not per equipment combination): a style's permanently-worn armour never
// changes tier, so which of the body kit's parts it hides is fixed for that style (see
// armourWearInfoForStyle, consumed by ActorAssets' per-style body bake).
//
// With item recolor/retexture applied (PlayerModelLoader), each tier of a weapon ladder renders as
// its own distinct color even where the underlying mesh is shared, so a weapon must be baked once
// per raw tier index rather than collapsed to a shared group.
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

// The tier (0 or max) that a secondary/amulet-style path's equipment state visually resolves to.
function visualGroupTier(equipment: EquipmentState, path: EquipmentPath): number {
    return secondaryVisualGroup(equipment, path) === 1 ? maxTierIndex(path) : 0;
}

// The wear info of whichever of the 2 baked representative tiers (tier 0's or the max tier's) that
// equipment state visually resolves to, for a secondary/amulet-style path.
function visualGroupWearInfo(equipment: EquipmentState, path: EquipmentPath): ItemWearInfo {
    return EQUIPMENT_PATHS[path].wearInfo[visualGroupTier(equipment, path)];
}

// The item id of whichever of the 2 baked representative tiers that equipment state visually
// resolves to, for a secondary/amulet-style path.
export function visualGroupItemId(equipment: EquipmentState, path: EquipmentPath): number {
    return itemIdForTier(path, visualGroupTier(equipment, path));
}

// The item id currently worn on a style's weapon slot (one distinct bake per raw tier index).
export function weaponItemId(style: WeaponStyle, equipment: EquipmentState): number {
    const path = weaponPathForStyle(style);
    return itemIdForTier(path, equipment[path]);
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

// A style's secondary offhand path (defender for melee, offhand book for magic), or undefined for
// ranged (its secondary path, arrows, has no offhand model). Exposed for the bake-time item/seq
// enumeration in ActorAssets; equippedVisualItemIds is the runtime-facing equivalent.
export function secondaryPathForStyle(style: WeaponStyle): EquipmentPath | undefined {
    return secondaryOffhandPathForStyle(style);
}

// A style's permanently-worn armour paths (helm/body/legs), in wear order. Single-tier: always
// worn at tier 0, never upgraded or dropped.
export function armourPathsForStyle(style: WeaponStyle): readonly EquipmentPath[] {
    switch (style) {
        case WeaponStyle.MELEE:
            return [EquipmentPath.MELEE_HELM, EquipmentPath.MELEE_BODY, EquipmentPath.MELEE_LEGS];
        case WeaponStyle.RANGED:
            return [EquipmentPath.RANGED_BODY, EquipmentPath.RANGED_LEGS];
        case WeaponStyle.MAGIC:
            return [EquipmentPath.MAGIC_HELM, EquipmentPath.MAGIC_BODY, EquipmentPath.MAGIC_LEGS];
    }
}

// A style's permanently-worn armour item ids, for the bake-time item enumeration in ActorAssets.
export function armourItemIdsForStyle(style: WeaponStyle): readonly number[] {
    return armourPathsForStyle(style).map((path) => itemIdForTier(path, 0));
}

// A style's permanently-worn armour, as wear info - what ActorAssets' per-style body bake resolves
// against the body kit (see Appearance.resolveAppearance) to decide which body parts that style
// hides (a full helm's hair/jaw, a platebody's arms, ...).
export function armourWearInfoForStyle(style: WeaponStyle): readonly ItemWearInfo[] {
    return armourPathsForStyle(style).map((path) => EQUIPMENT_PATHS[path].wearInfo[0]);
}

// Every item id worn as a player attachment for the given style/equipment: the equipped weapon (or
// a cast's item override, e.g. the elder maul/crystal halberd specials), that style's secondary
// offhand if it has one, the shared amulet, and that style's permanently-worn armour - with
// anything a two-handed weapon or override hides (the shield slot) generically dropped by
// resolveAppearance, the same rule a full helm uses to hide hair/jaw on the body kit. The single
// source of truth for which attachment instances WebGLMapViewerRenderer.buildActorInstanceData
// pushes each frame.
export function equippedVisualItemIds(
    style: WeaponStyle,
    equipment: EquipmentState,
    castItemOverride: CastItemOverride | undefined,
): readonly number[] {
    const weaponPath = weaponPathForStyle(style);
    const weaponItem = castItemOverride
        ? itemWearInfo(
              castItemOverride.itemId,
              AppearanceSlot.WEAPON,
              castItemOverride.hidesShield ? AppearanceSlot.SHIELD : -1,
              -1,
          )
        : EQUIPMENT_PATHS[weaponPath].wearInfo[equipment[weaponPath]];
    const secondaryPath = secondaryOffhandPathForStyle(style);
    const items: ItemWearInfo[] = [
        weaponItem,
        ...(secondaryPath ? [visualGroupWearInfo(equipment, secondaryPath)] : []),
        visualGroupWearInfo(equipment, EquipmentPath.AMULET),
        ...armourWearInfoForStyle(style),
    ];
    return resolveAppearance([], items).itemIds;
}

const EQUIPMENT_PATH_BY_NAME = new Map<string, EquipmentPath>(
    ALL_EQUIPMENT_PATHS.map((path) => [path, path]),
);

// Dev gear preload, e.g. ?gear=scimitar:3,staff:2 - sets starting equipment tiers so the owner can
// check a weapon tier's visuals without grinding for it (see GameWorld.setGearOverride). Parsed at
// the edge in MapViewerApp, alongside parseGodMode/parseEncounterId; throws on malformed input
// (an unknown path, a non-integer tier, or a tier past that path's max) rather than silently
// ignoring a typo.
export function parseGearOverride(searchParams: URLSearchParams): readonly EquipmentChange[] {
    const raw = searchParams.get("gear");
    if (raw === null || raw.length === 0) {
        return [];
    }
    return raw.split(",").map((entry): EquipmentChange => {
        const [pathName, tierText] = entry.split(":");
        const path = pathName ? EQUIPMENT_PATH_BY_NAME.get(pathName) : undefined;
        if (!path) {
            throw new Error(
                `Invalid ?gear entry "${entry}": unknown equipment path "${pathName ?? ""}"`,
            );
        }
        const tierIndex = Number(tierText);
        if (!tierText || !Number.isInteger(tierIndex) || tierIndex < 0) {
            throw new Error(`Invalid ?gear entry "${entry}": tier must be a non-negative integer`);
        }
        const maxTier = maxTierIndex(path);
        if (tierIndex > maxTier) {
            throw new Error(`Invalid ?gear entry "${entry}": ${path} only has tiers 0-${maxTier}`);
        }
        return { path, tierIndex };
    });
}

// How many of a path's item its ground model should visually stack, purely presentational (see
// ObjModelLoader.getModel's count param, which picks a path's ObjType countObj/countCo pile model
// for a large enough count) - a drop always grants exactly one tier of the path regardless of how
// many the ground model appears to show. Only ammo piles into a big stack, as OSRS does past 100
// arrows; every other path always shows as a single item. The count is deliberately far past any
// real countCo threshold so it always resolves to a path's largest stack model, whatever the
// cache's own thresholds happen to be.
const GROUND_ITEM_AMMO_STACK_DISPLAY_COUNT = 1_000_000;

export function groundItemDisplayCount(path: EquipmentPath): number {
    return path === EquipmentPath.ARROWS ? GROUND_ITEM_AMMO_STACK_DISPLAY_COUNT : 1;
}

export type DroppableItemDisplay = {
    readonly itemId: number;
    readonly displayCount: number;
};

// Every item id that can ever appear as a ground drop (every tier above tier 0, since tier 0 is
// always already worn and equipAtTier never drops below the player's current tier), paired with
// how many of it the ground model should show (see groundItemDisplayCount).
export function allDroppableItemDrops(): readonly DroppableItemDisplay[] {
    const drops: DroppableItemDisplay[] = [];
    for (const path of ALL_EQUIPMENT_PATHS) {
        const { itemIds } = EQUIPMENT_PATHS[path];
        const displayCount = groundItemDisplayCount(path);
        for (let tier = 1; tier < itemIds.length; tier++) {
            drops.push({ itemId: itemIds[tier], displayCount });
        }
    }
    return drops;
}
