import { DropTier } from "./EnemyType";
import {
    ALL_EQUIPMENT_PATHS,
    EquipmentChange,
    EquipmentPath,
    EquipmentState,
    isAtMaxTier,
} from "./Equipment";
import { RandomSource } from "./abilityRules";

// A single real OSRS item lying on the ground: one equipment path at one tier, rendered with its
// own model (see itemIdForTier) and picked up like any other drop.
export type GroundItem = {
    readonly id: number;
    readonly path: EquipmentPath;
    readonly tierIndex: number;
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

// Diablo-style drop odds by enemy dropTier (see EnemyType.DropTier).
const DROP_CHANCE: Readonly<Record<DropTier, number>> = {
    [DropTier.NONE]: 0,
    [DropTier.CHAFF]: 0.05,
    [DropTier.ELITE]: 0.6,
    [DropTier.BOSS]: 1,
};

// Picks an equipment path to drop on this kill, or undefined if the roll missed or nothing is
// eligible. A path is eligible when the player hasn't maxed it and no ground item is already
// pending for it, so there's at most one pending drop per path and never a drop past max tier.
// Takes exactly two draws from `random` when dropTier has a nonzero chance (the roll, then the
// path pick), so callers using a fixed/injected RandomSource can reason about which draw is which.
export function rollDropPath(
    dropTier: DropTier,
    equipment: EquipmentState,
    pendingPaths: ReadonlySet<EquipmentPath>,
    random: RandomSource,
): EquipmentPath | undefined {
    if (random() >= DROP_CHANCE[dropTier]) {
        return undefined;
    }
    const eligible = ALL_EQUIPMENT_PATHS.filter(
        (path) => !isAtMaxTier(equipment, path) && !pendingPaths.has(path),
    );
    if (eligible.length === 0) {
        return undefined;
    }
    return eligible[Math.floor(random() * eligible.length)];
}

export type GrantDropPlan = {
    // The changes that go on the floor, in grant order.
    readonly drops: readonly EquipmentChange[];
    // Floor items a better drop of the same path takes the place of.
    readonly replacedItemIds: readonly number[];
};

// The same rule as rollDropPath for an authored grant (e.g. a phase chest): at most one floor item
// per path and nothing the player already wears at that tier or better. A change that beats an
// item already waiting on the floor for its path takes that item's place.
export function planGrantDrops(
    changes: readonly EquipmentChange[],
    equipment: EquipmentState,
    groundItems: readonly GroundItem[],
): GrantDropPlan {
    const drops: EquipmentChange[] = [];
    const replacedItemIds: number[] = [];
    for (const change of changes) {
        if (change.tierIndex <= equipment[change.path]) {
            continue;
        }
        const waiting = groundItems.find((item) => item.path === change.path);
        if (waiting && waiting.tierIndex >= change.tierIndex) {
            continue;
        }
        if (waiting) {
            replacedItemIds.push(waiting.id);
        }
        drops.push(change);
    }
    return { drops, replacedItemIds };
}

export function pendingGroundItemPaths(
    groundItems: readonly GroundItem[],
): ReadonlySet<EquipmentPath> {
    return new Set(groundItems.map((item) => item.path));
}

export function distanceToGroundItem(item: GroundItem, x: number, y: number): number {
    return Math.hypot(item.x - x, item.y - y);
}
