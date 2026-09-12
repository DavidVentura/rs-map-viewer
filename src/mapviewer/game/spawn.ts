import { Terrain } from "./Terrain";

const SPAWN_SEARCH_STEP_UNITS = 128;
const SPAWN_SEARCH_MAX_OFFSET_UNITS = 16 * 128;

export function resolveSpawn(
    terrain: Terrain,
    level: number,
    x: number,
    y: number,
): { x: number; y: number } {
    for (
        let offset = 0;
        offset <= SPAWN_SEARCH_MAX_OFFSET_UNITS;
        offset += SPAWN_SEARCH_STEP_UNITS
    ) {
        const candidateY = y + offset;
        if (terrain.canOccupy(level, x, candidateY)) {
            return { x, y: candidateY };
        }
    }
    throw new Error("No valid spawn position north of the requested location");
}

const SCATTER_TILE_SIZE = 128;

// A ring of tile offsets around a center point, used to scatter several items dropped at once
// (see resolveScatterPosition) onto distinct nearby tiles instead of stacking them.
const SCATTER_RING_OFFSETS: readonly { dx: number; dy: number }[] = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 },
];

// Picks the placedCount-th tile in an expanding ring around a center point (e.g. a chest bursting
// several items at once), skipping any tile the terrain refuses. Falls back to the center itself
// if every ring tile is blocked, rather than throwing: a cosmetic scatter failing is not fatal the
// way a spawn failing is.
export function resolveScatterPosition(
    terrain: Terrain,
    level: number,
    centerX: number,
    centerY: number,
    placedCount: number,
): { x: number; y: number } {
    for (let attempt = 0; attempt < SCATTER_RING_OFFSETS.length; attempt++) {
        const step = placedCount + attempt;
        const { dx, dy } = SCATTER_RING_OFFSETS[step % SCATTER_RING_OFFSETS.length];
        const radiusScale = 1 + Math.floor(step / SCATTER_RING_OFFSETS.length);
        const x = centerX + dx * SCATTER_TILE_SIZE * radiusScale;
        const y = centerY + dy * SCATTER_TILE_SIZE * radiusScale;
        if (terrain.canOccupy(level, x, y)) {
            return { x, y };
        }
    }
    return { x: centerX, y: centerY };
}
