import { VisualEffectKind } from "./VisualEffect";
import {
    WardenP3ArenaFloor,
    WardenP3ArenaTile,
    drawDistinctWardenP3Tiles,
    wardenP3SolidFloorTiles,
} from "./WardenP3Arena";
import { RandomSource } from "./abilityRules";

export type WardenP3LightningVolley = {
    readonly boltCount: number;
    // How long each bolt's warning sits on its tile before the bolt strikes there.
    readonly warningSeconds: number;
    readonly damage: number;
    readonly warning: VisualEffectKind;
    readonly strike: VisualEffectKind;
};

export const WARDEN_P3_LIGHTNING: WardenP3LightningVolley = {
    boltCount: 6,
    warningSeconds: 1.2,
    damage: 20,
    warning: VisualEffectKind.WARDENS_LIGHTNING_WARNING,
    strike: VisualEffectKind.WARDENS_LIGHTNING,
};

// Bolts land on distinct solid floor tiles anywhere, the player's own among them only by chance, so
// the volley thins out with the floor the Warden pulls away.
export function wardenP3LightningTargets(
    floor: WardenP3ArenaFloor,
    boltCount: number,
    random: RandomSource,
): readonly WardenP3ArenaTile[] {
    return drawDistinctWardenP3Tiles(wardenP3SolidFloorTiles(floor), boltCount, random);
}
