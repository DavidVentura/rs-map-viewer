import { DropTier } from "./EnemyType";
import { DEFAULT_EQUIPMENT, EquipmentPath, equipAtTier, maxTierIndex } from "./Equipment";
import {
    GroundItem,
    isGroundItemExpired,
    pendingGroundItemPaths,
    rollDropPath,
} from "./GroundItem";

function fixedRandom(...values: number[]): () => number {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
}

describe("rollDropPath", () => {
    it("never drops for DropTier.NONE regardless of the roll", () => {
        const random = fixedRandom(0);
        expect(rollDropPath(DropTier.NONE, DEFAULT_EQUIPMENT, new Set(), random)).toBeUndefined();
    });

    it("always drops for DropTier.BOSS when a path is eligible", () => {
        const random = fixedRandom(0.999999, 0);
        const path = rollDropPath(DropTier.BOSS, DEFAULT_EQUIPMENT, new Set(), random);
        expect(path).toBeDefined();
    });

    it("misses the roll when the random draw is above the drop chance", () => {
        const random = fixedRandom(0.5);
        expect(rollDropPath(DropTier.CHAFF, DEFAULT_EQUIPMENT, new Set(), random)).toBeUndefined();
    });

    it("hits the roll when the random draw is below the drop chance", () => {
        const random = fixedRandom(0.01, 0);
        expect(rollDropPath(DropTier.CHAFF, DEFAULT_EQUIPMENT, new Set(), random)).toBeDefined();
    });

    it("never picks a path that is already at max tier", () => {
        let equipment = DEFAULT_EQUIPMENT;
        for (const path of Object.values(EquipmentPath)) {
            if (path !== EquipmentPath.BOW) {
                equipment = equipAtTier(equipment, path, maxTierIndex(path));
            }
        }
        const random = fixedRandom(0, 0);
        const path = rollDropPath(DropTier.BOSS, equipment, new Set(), random);
        expect(path).toBe(EquipmentPath.BOW);
    });

    it("never picks a path with a pending ground item", () => {
        const pending = new Set(
            Object.values(EquipmentPath).filter((path) => path !== EquipmentPath.STAFF),
        );
        const random = fixedRandom(0, 0);
        const path = rollDropPath(DropTier.BOSS, DEFAULT_EQUIPMENT, pending, random);
        expect(path).toBe(EquipmentPath.STAFF);
    });

    it("returns undefined once every path is either maxed or pending", () => {
        let equipment = DEFAULT_EQUIPMENT;
        for (const path of Object.values(EquipmentPath)) {
            equipment = equipAtTier(equipment, path, maxTierIndex(path));
        }
        const random = fixedRandom(0, 0);
        expect(rollDropPath(DropTier.BOSS, equipment, new Set(), random)).toBeUndefined();
    });
});

describe("pendingGroundItemPaths", () => {
    it("collects the set of paths currently on the ground", () => {
        const items: GroundItem[] = [
            {
                id: 1,
                path: EquipmentPath.BOW,
                tierIndex: 1,
                x: 0,
                y: 0,
                level: 0,
                expiresAtSeconds: 60,
            },
            {
                id: 2,
                path: EquipmentPath.STAFF,
                tierIndex: 1,
                x: 0,
                y: 0,
                level: 0,
                expiresAtSeconds: 60,
            },
        ];
        const pending = pendingGroundItemPaths(items);
        expect(pending.has(EquipmentPath.BOW)).toBe(true);
        expect(pending.has(EquipmentPath.STAFF)).toBe(true);
        expect(pending.has(EquipmentPath.SCIMITAR)).toBe(false);
    });
});

describe("isGroundItemExpired", () => {
    const item: GroundItem = {
        id: 1,
        path: EquipmentPath.BOW,
        tierIndex: 1,
        x: 0,
        y: 0,
        level: 0,
        expiresAtSeconds: 60,
    };

    it("is not expired before its expiry time", () => {
        expect(isGroundItemExpired(item, 59.9)).toBe(false);
    });

    it("is expired at or after its expiry time", () => {
        expect(isGroundItemExpired(item, 60)).toBe(true);
        expect(isGroundItemExpired(item, 61)).toBe(true);
    });
});
