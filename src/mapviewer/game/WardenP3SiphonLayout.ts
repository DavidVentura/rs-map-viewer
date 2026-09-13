import type { WardenP3Intermission, WardenP3Tile } from "./WardenP3Director";

export type WardenP3SiphonSpawn = WardenP3Tile & {
    readonly rotation: number;
};

// Each intermission throws its own pattern of siphons.
export type WardenP3SiphonLayout = {
    readonly spawnsByIntermission: Readonly<
        Record<WardenP3Intermission, readonly WardenP3SiphonSpawn[]>
    >;
    readonly deadlineSeconds: number;
};

export function validateWardenP3SiphonLayout(layout: WardenP3SiphonLayout): void {
    if (!Number.isFinite(layout.deadlineSeconds) || layout.deadlineSeconds <= 0) {
        throw new RangeError("Wardens siphon deadlineSeconds must be finite and positive");
    }
    for (const spawns of Object.values(layout.spawnsByIntermission)) {
        if (spawns.length === 0) {
            throw new RangeError("A Wardens siphon intermission requires at least one siphon");
        }
        const tiles = new Set(spawns.map((spawn) => `${spawn.x},${spawn.y},${spawn.level}`));
        if (tiles.size !== spawns.length) {
            throw new RangeError("A Wardens siphon intermission cannot stack siphons on one tile");
        }
        for (const spawn of spawns) {
            if (
                !Number.isInteger(spawn.x) ||
                !Number.isInteger(spawn.y) ||
                !Number.isInteger(spawn.level) ||
                !Number.isFinite(spawn.rotation)
            ) {
                throw new RangeError(
                    "Wardens siphon spawns must have finite tile positions and rotation",
                );
            }
        }
    }
}
