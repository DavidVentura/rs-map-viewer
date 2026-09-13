// OSRS spreads the hitsplats on one target over four slots: the first at the anchor, the second
// right above it, then up to the left and up to the right.
export enum HitsplatSlot {
    BOTTOM = 0,
    TOP = 1,
    LEFT = 2,
    RIGHT = 3,
}

const HITSPLAT_SLOT_ORDER: readonly HitsplatSlot[] = [
    HitsplatSlot.BOTTOM,
    HitsplatSlot.TOP,
    HitsplatSlot.LEFT,
    HitsplatSlot.RIGHT,
];

export type OccupiedHitsplatSlot = {
    readonly slot: HitsplatSlot;
    readonly ageSeconds: number;
};

// The first free slot on the target, or once all four are showing, the slot of its oldest splat,
// which the new one replaces.
export function pickHitsplatSlot(onTarget: readonly OccupiedHitsplatSlot[]): HitsplatSlot {
    const free = HITSPLAT_SLOT_ORDER.find(
        (slot) => !onTarget.some((occupied) => occupied.slot === slot),
    );
    if (free !== undefined) {
        return free;
    }
    return onTarget.reduce((oldest, occupied) =>
        occupied.ageSeconds > oldest.ageSeconds ? occupied : oldest,
    ).slot;
}
