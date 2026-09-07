import { DropTier } from "./EnemyType";
import { ALL_EQUIPMENT_PATHS, EquipmentPath, EquipmentState, isAtMaxTier } from "./Equipment";
import { RandomSource } from "./abilityRules";

export type GroundItem = {
    readonly id: number;
    readonly path: EquipmentPath;
    readonly tierIndex: number;
    readonly x: number;
    readonly y: number;
    readonly level: number;
    readonly expiresAtSeconds: number;
};

export const GROUND_ITEM_LIFETIME_SECONDS = 60;

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

export function pendingGroundItemPaths(
    groundItems: readonly GroundItem[],
): ReadonlySet<EquipmentPath> {
    return new Set(groundItems.map((item) => item.path));
}

export function isGroundItemExpired(item: GroundItem, timeSeconds: number): boolean {
    return timeSeconds >= item.expiresAtSeconds;
}

export function distanceToGroundItem(item: GroundItem, x: number, y: number): number {
    return Math.hypot(item.x - x, item.y - y);
}
