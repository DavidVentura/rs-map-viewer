import { UpgradeId } from "./upgrades";

export type StanceMechanicsState = {
    readonly rangedConsecutiveHits: number;
    readonly rangedFocusRank: number;
};

export const INITIAL_STANCE_MECHANICS: StanceMechanicsState = {
    rangedConsecutiveHits: 0,
    rangedFocusRank: 0,
};

export const MAGIC_MANA_REFUND_PER_ENEMY = 4;

export function rangedHitsRequired(state: StanceMechanicsState): number {
    return Math.max(2, 5 - state.rangedFocusRank);
}

export function recordStationaryRangedHit(state: StanceMechanicsState): StanceMechanicsState {
    return { ...state, rangedConsecutiveHits: state.rangedConsecutiveHits + 1 };
}

export function resetRangedHits(state: StanceMechanicsState): StanceMechanicsState {
    return state.rangedConsecutiveHits === 0 ? state : { ...state, rangedConsecutiveHits: 0 };
}

export function consumeRangedDoubleShot(state: StanceMechanicsState): {
    readonly state: StanceMechanicsState;
    readonly firesDouble: boolean;
} {
    if (state.rangedConsecutiveHits < rangedHitsRequired(state)) {
        return { state, firesDouble: false };
    }
    return { state: { ...state, rangedConsecutiveHits: 0 }, firesDouble: true };
}

export function applyStanceMechanicUpgrade(
    state: StanceMechanicsState,
    upgradeId: UpgradeId,
): StanceMechanicsState {
    if (upgradeId !== UpgradeId.QUICK_HANDS) {
        return state;
    }
    return { ...state, rangedFocusRank: Math.min(3, state.rangedFocusRank + 1) };
}
