import {
    WardenP3ArenaFloor,
    WardenP3ArenaTile,
    drawDistinctWardenP3Tiles,
    wardenP3SolidFloorTiles,
} from "./WardenP3Arena";
import type { WardenP3Intermission, WardenP3Tile } from "./WardenP3Director";
import { RandomSource } from "./abilityRules";

// Each intermission lets loose its own number of skulls.
export type WardenP3SkullSwarm = {
    readonly countsByIntermission: Readonly<Record<WardenP3Intermission, number>>;
    // No skull lands within this many tiles of the player, so the swarm has to close in first.
    readonly playerClearanceTiles: number;
};

export function validateWardenP3SkullSwarm(swarm: WardenP3SkullSwarm): void {
    for (const count of Object.values(swarm.countsByIntermission)) {
        if (!Number.isInteger(count) || count < 1) {
            throw new RangeError(
                "A Wardens skull swarm must hold a positive whole number of skulls",
            );
        }
    }
    if (!Number.isInteger(swarm.playerClearanceTiles) || swarm.playerClearanceTiles < 0) {
        throw new RangeError(
            "The skull swarm's player clearance must be a non-negative whole number",
        );
    }
}

export function wardenP3SkullSwarmTiles(
    floor: WardenP3ArenaFloor,
    player: WardenP3Tile,
    swarm: WardenP3SkullSwarm,
    intermission: WardenP3Intermission,
    random: RandomSource,
): readonly WardenP3ArenaTile[] {
    const pool = wardenP3SolidFloorTiles(floor).filter(
        (tile) =>
            Math.max(Math.abs(tile.x - player.x), Math.abs(tile.y - player.y)) >
            swarm.playerClearanceTiles,
    );
    const count = swarm.countsByIntermission[intermission];
    if (pool.length < count) {
        throw new Error(
            `The arena floor has ${pool.length} tiles clear of the player, too few for ${count} skulls`,
        );
    }
    return drawDistinctWardenP3Tiles(pool, count, random);
}
