import {
    INITIAL_STANCE_MECHANICS,
    applyStanceMechanicUpgrade,
    consumeRangedDoubleShot,
    rangedHitsRequired,
    recordStationaryRangedHit,
    resetRangedHits,
} from "./StanceMechanics";
import { UpgradeId } from "./upgrades";

describe("ranged focus", () => {
    it("consumes a double shot after five confirmed stationary hits", () => {
        const charged = [0, 1, 2, 3, 4].reduce(
            (state) => recordStationaryRangedHit(state),
            INITIAL_STANCE_MECHANICS,
        );
        expect(consumeRangedDoubleShot(charged)).toEqual({
            state: INITIAL_STANCE_MECHANICS,
            firesDouble: true,
        });
    });

    it("reduces the requirement with ranks and never below two", () => {
        const ranked = [0, 1, 2, 3, 4].reduce(
            (state) => applyStanceMechanicUpgrade(state, UpgradeId.QUICK_HANDS),
            INITIAL_STANCE_MECHANICS,
        );
        expect(rangedHitsRequired(ranked)).toBe(2);
    });

    it("resets confirmed hits when movement breaks the sequence", () => {
        expect(resetRangedHits(recordStationaryRangedHit(INITIAL_STANCE_MECHANICS))).toEqual(
            INITIAL_STANCE_MECHANICS,
        );
    });
});
