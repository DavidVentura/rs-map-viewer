import { WeaponStyle } from "../game/Ability";
import { PLAYER_BODY_KIT, bodyModelIdsForStyle } from "./ActorAssets";

// Hans's (npc 3105) own raw model ids, verified with a throwaway script
// (scripts/cache/verify-armour-throwaway.ts, not checked in).
const HANS_MODEL_IDS = [217, 246, 28515, 26630, 176, 28285, 185, 320];

describe("PLAYER_BODY_KIT", () => {
    it("accounts for every one of Hans's raw model ids exactly once", () => {
        const covered = PLAYER_BODY_KIT.flatMap((part) => part.modelIds);
        expect(new Set(covered)).toEqual(new Set(HANS_MODEL_IDS));
        expect(covered).toHaveLength(HANS_MODEL_IDS.length);
    });
});

describe("bodyModelIdsForStyle", () => {
    it("melee's full rune armour hides everything but hands and boots", () => {
        expect(new Set(bodyModelIdsForStyle(WeaponStyle.MELEE))).toEqual(new Set([176, 185]));
    });

    it("ranged's body+chaps leave the head, jaw, arms, hands and boots visible", () => {
        expect(new Set(bodyModelIdsForStyle(WeaponStyle.RANGED))).toEqual(
            new Set([217, 246, 26630, 176, 185]),
        );
    });

    it("magic's mystic robes hide the torso/arms and legs but not the head/jaw", () => {
        expect(new Set(bodyModelIdsForStyle(WeaponStyle.MAGIC))).toEqual(
            new Set([217, 246, 176, 185]),
        );
    });
});
