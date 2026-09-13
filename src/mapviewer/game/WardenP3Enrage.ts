import { TILE_SIZE } from "./Terrain";
import { VisualEffectKind } from "./VisualEffect";
import {
    WARDEN_P3_BACK_TILE_Y,
    WARDEN_P3_FRONT_CENTRE_TILE,
    WardenP3ArenaFloor,
    WardenP3ArenaTile,
    drawDistinctWardenP3Tiles,
    wardenP3SolidFloorTiles,
} from "./WardenP3Arena";
import { RandomSource } from "./abilityRules";
import { FlightPoint } from "./projectileMath";

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
    // A dark shadow grows on the tile, the Grotesque Guardians' debris shadow Ba-Ba's rocks use,
    // then the red bolt (WARDENS_LIGHTNING) strikes it.
    warning: VisualEffectKind.FALLING_SHADOW,
    strike: VisualEffectKind.WARDENS_LIGHTNING,
};

// Where a pulled tile flies to, high in the sky past the Warden's back (the flight's own landing
// height sets how high).
export type WardenP3PulledTileSky = {
    // Tiles past the Warden's back edge.
    readonly tilesBehindWarden: number;
    // A tile's sideways offset from the floor's centre column, scaled, so the tiles spread across
    // the sky from the side of the floor they left.
    readonly fan: number;
};

export const WARDEN_P3_PULLED_TILE_SKY: WardenP3PulledTileSky = {
    tilesBehindWarden: 10,
    fan: 1.4,
};

export function wardenP3PulledTileSkyPoint(
    tile: WardenP3ArenaTile,
    sky: WardenP3PulledTileSky,
): FlightPoint {
    const centreX = WARDEN_P3_FRONT_CENTRE_TILE.x;
    return {
        x: (centreX + (tile.x - centreX) * sky.fan + 0.5) * TILE_SIZE,
        y: (WARDEN_P3_BACK_TILE_Y - sky.tilesBehindWarden + 0.5) * TILE_SIZE,
    };
}

// Bolts land on distinct solid floor tiles anywhere, the player's own among them only by chance, so
// the volley thins out with the floor the Warden pulls away.
export function wardenP3LightningTargets(
    floor: WardenP3ArenaFloor,
    boltCount: number,
    random: RandomSource,
): readonly WardenP3ArenaTile[] {
    return drawDistinctWardenP3Tiles(wardenP3SolidFloorTiles(floor), boltCount, random);
}
