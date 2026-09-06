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
