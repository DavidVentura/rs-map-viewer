import { MapSquareCoord } from "../MapSquareCoord";

// Ambient NPCs and animated locs are only simulated and drawn for map squares within this
// Chebyshev distance (in map squares) of the square the player stands on.
export const AMBIENT_TICK_RADIUS_SQUARES = 1;

export function worldToMapSquare(x: number, y: number): MapSquareCoord {
    return { mapX: (x >> 7) >> 6, mapY: (y >> 7) >> 6 };
}

export function isWithinTickRange(focus: MapSquareCoord, mapX: number, mapY: number): boolean {
    const distance = Math.max(Math.abs(mapX - focus.mapX), Math.abs(mapY - focus.mapY));
    return distance <= AMBIENT_TICK_RADIUS_SQUARES;
}
