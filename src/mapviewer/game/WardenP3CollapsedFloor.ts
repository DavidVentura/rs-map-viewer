import { LocRotation } from "./LocTransform";
import {
    WARDEN_P3_FLOOR_TILES,
    WardenP3ArenaFloor,
    WardenP3ArenaTile,
    WardenP3ArenaTileOccupancy,
    wardenP3ArenaTile,
    wardenP3TileNoise,
    wardenP3TileOccupancy,
} from "./WardenP3Arena";

// The collapsed-floor kit: map square 61,80's level-2 "Void" ground decorations, each a tile of
// blue-grey rock hanging below the floor. Named by the sides their broken rims face at rotation 0;
// the slopes rise to the arena's far edge.
export enum WardenP3VoidLoc {
    ROCK_FLOOR = 45738,
    RIM_WEST = 45726,
    TILE_CHUNKS_SOUTH = 45728,
    RIM_SOUTH_WEST = 45734,
    TILE_CHUNKS_SOUTH_WEST = 45736,
    RIMS_EAST_SOUTH_WEST = 45733,
    SLOPE_WEST = 45727,
    SLOPE_WEST_RIM_SOUTH = 45735,
    SLOPE_WEST_RIM_NORTH = 45737,
    SLOPE_WEST_RIM_EAST = 45730,
    SLOPE_WEST_RIMS_SOUTH_EAST = 45731,
    SLOPE_WEST_RIMS_NORTH_EAST = 45732,
}

export type WardenP3VoidPiece = {
    readonly loc: WardenP3VoidLoc;
    readonly rotation: LocRotation;
};

export type WardenP3VoidPlacement = {
    readonly tile: WardenP3ArenaTile;
    readonly piece: WardenP3VoidPiece;
};

declare const voidPieceKeyBrand: unique symbol;

export type WardenP3VoidPieceKey = number & { readonly [voidPieceKeyBrand]: true };

// The sides of a pulled tile, north, east, south then west, whose neighbour is standing floor or
// off the floor entirely: the sides a rim closes. "-" marks a side opening onto another pulled tile.
export type WardenP3WalledSides = `${"N" | "-"}${"E" | "-"}${"S" | "-"}${"W" | "-"}`;

// Every row is wider than a tile and the floor goes from the far row inward, so a pulled tile
// walled east and west is always in the edge row, whose south side is walled too.
type ReachableWalledSides = Exclude<WardenP3WalledSides, "-E-W" | "NE-W">;

export type WardenP3VoidPieceVariants = readonly [WardenP3VoidPiece, ...WardenP3VoidPiece[]];

function piece(loc: WardenP3VoidLoc, rotation: LocRotation): WardenP3VoidPiece {
    return { loc, rotation };
}

// Read off map square 61,80's level-2 Void rows, which dress pulled floor rows this way: a piece on
// every pulled tile with a rim on each walled side, and the sloped pieces only against the far
// edge. Where the map uses several pieces for the same sides, each tile picks one of them. The map
// never walls every side but the north, nor all four: the first takes the kit's one unplaced piece,
// whose rims face exactly those sides, and so does the second, since no piece has four rims and the
// far edge's rim faces away from the camera looking at the Warden.
const VOID_PIECES_BY_WALLED_SIDES: Readonly<
    Record<ReachableWalledSides, WardenP3VoidPieceVariants>
> = {
    "----": [
        piece(WardenP3VoidLoc.ROCK_FLOOR, 0),
        piece(WardenP3VoidLoc.ROCK_FLOOR, 1),
        piece(WardenP3VoidLoc.ROCK_FLOOR, 2),
        piece(WardenP3VoidLoc.ROCK_FLOOR, 3),
    ],
    "--S-": [piece(WardenP3VoidLoc.RIM_WEST, 3), piece(WardenP3VoidLoc.TILE_CHUNKS_SOUTH, 0)],
    "---W": [piece(WardenP3VoidLoc.RIM_WEST, 0)],
    "-E--": [piece(WardenP3VoidLoc.RIM_WEST, 2)],
    "--SW": [
        piece(WardenP3VoidLoc.RIM_SOUTH_WEST, 0),
        piece(WardenP3VoidLoc.TILE_CHUNKS_SOUTH_WEST, 0),
    ],
    "-ES-": [piece(WardenP3VoidLoc.TILE_CHUNKS_SOUTH_WEST, 3)],
    "-ESW": [piece(WardenP3VoidLoc.RIMS_EAST_SOUTH_WEST, 0)],
    "N---": [piece(WardenP3VoidLoc.SLOPE_WEST, 1)],
    "N--W": [piece(WardenP3VoidLoc.SLOPE_WEST_RIM_SOUTH, 1)],
    "NE--": [piece(WardenP3VoidLoc.SLOPE_WEST_RIM_NORTH, 1)],
    "N-S-": [piece(WardenP3VoidLoc.SLOPE_WEST_RIM_EAST, 1)],
    "N-SW": [piece(WardenP3VoidLoc.SLOPE_WEST_RIMS_SOUTH_EAST, 1)],
    "NES-": [piece(WardenP3VoidLoc.SLOPE_WEST_RIMS_NORTH_EAST, 1)],
    NESW: [piece(WardenP3VoidLoc.RIMS_EAST_SOUTH_WEST, 0)],
};

// Salts 0 and 1 jitter the floor slam's lift and tilt.
const PIECE_VARIANT_NOISE_SALT = 2;

export function wardenP3VoidPieceKey(voidPiece: WardenP3VoidPiece): WardenP3VoidPieceKey {
    return (voidPiece.loc * 4 + voidPiece.rotation) as WardenP3VoidPieceKey;
}

export const WARDEN_P3_VOID_PIECES: readonly WardenP3VoidPiece[] = [
    ...new Map(
        Object.values<WardenP3VoidPieceVariants>(VOID_PIECES_BY_WALLED_SIDES)
            .flat()
            .map((voidPiece) => [wardenP3VoidPieceKey(voidPiece), voidPiece]),
    ).values(),
];

export function wardenP3VoidPiecesForSides(sides: WardenP3WalledSides): WardenP3VoidPieceVariants {
    if (sides === "-E-W" || sides === "NE-W") {
        throw new Error(`A pulled Wardens P3 tile cannot be walled on sides ${sides}`);
    }
    return VOID_PIECES_BY_WALLED_SIDES[sides];
}

export function wardenP3WalledSides(
    floor: WardenP3ArenaFloor,
    tile: WardenP3ArenaTile,
): WardenP3WalledSides {
    const side = <S extends string>(eastward: number, northward: number, walled: S): S | "-" =>
        wardenP3TileOccupancy(floor, wardenP3ArenaTile(tile.x + eastward, tile.y + northward)) ===
        WardenP3ArenaTileOccupancy.DESTROYED_FLOOR
            ? "-"
            : walled;
    return `${side(0, 1, "N")}${side(1, 0, "E")}${side(0, -1, "S")}${side(-1, 0, "W")}`;
}

// A pulled tile shows rock rimmed on its walled sides. A standing tile keeps plain rock beneath it,
// hidden by the floor at rest and showing whenever a slam lifts the tile.
export function wardenP3CollapsedFloor(
    floor: WardenP3ArenaFloor,
): readonly WardenP3VoidPlacement[] {
    return WARDEN_P3_FLOOR_TILES.map((tile) => {
        const pulled =
            wardenP3TileOccupancy(floor, tile) === WardenP3ArenaTileOccupancy.DESTROYED_FLOOR;
        const variants = wardenP3VoidPiecesForSides(
            pulled ? wardenP3WalledSides(floor, tile) : "----",
        );
        const noise = wardenP3TileNoise(tile, PIECE_VARIANT_NOISE_SALT);
        return { tile, piece: variants[Math.floor(((noise + 1) / 2) * variants.length)] };
    });
}
