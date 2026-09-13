import { MapSquareCoord } from "../../rs/map/MapSquareCoord";
import { Scene } from "../../rs/scene/Scene";

export type LocTile = {
    readonly x: number;
    readonly y: number;
};

// Quarter turns clockwise seen from above, as a map square places its locs.
export type LocRotation = 0 | 1 | 2 | 3;

// Ground decorations an encounter moves at runtime instead of baking them into the static map.
// A tile holds at most one ground decoration per level, so each declared tile names exactly one
// loc; the map bake throws when a declared tile has no ground decoration with one of locIds.
export type TransformableGroundDecorations = {
    readonly level: number;
    readonly locIds: readonly number[];
    readonly tiles: readonly LocTile[];
};

// Tilts are rotations about the loc's own origin; a positive northTilt raises its north (+y)
// edge and a positive eastTilt its east (+x) edge. lift is in world units, up positive.
export type LocTransform =
    | { readonly kind: "HIDDEN" }
    | {
          readonly kind: "SHOWN";
          readonly lift: number;
          readonly northTilt: number;
          readonly eastTilt: number;
      };

export const REST_LOC_TRANSFORM: LocTransform = {
    kind: "SHOWN",
    lift: 0,
    northTilt: 0,
    eastTilt: 0,
};

export function isTileInMapSquare(tile: LocTile, square: MapSquareCoord): boolean {
    return (
        Math.floor(tile.x / Scene.MAP_SQUARE_SIZE) === square.mapX &&
        Math.floor(tile.y / Scene.MAP_SQUARE_SIZE) === square.mapY
    );
}

// The part of each declaration a single map square's bake resolves.
export function groundDecorationsInMapSquare(
    declarations: readonly TransformableGroundDecorations[],
    square: MapSquareCoord,
): TransformableGroundDecorations[] {
    return declarations
        .map((declaration) => ({
            ...declaration,
            tiles: declaration.tiles.filter((tile) => isTileInMapSquare(tile, square)),
        }))
        .filter((declaration) => declaration.tiles.length > 0);
}
