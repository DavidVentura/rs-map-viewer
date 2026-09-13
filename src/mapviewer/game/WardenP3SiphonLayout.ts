import { WardenP3Tile } from "./WardenP3Director";

export type WardenP3SiphonSpawn = WardenP3Tile & {
    readonly rotation: number;
};

export type WardenP3SiphonLayout = {
    readonly spawns: readonly WardenP3SiphonSpawn[];
    readonly deadlineSeconds: number;
};

export function validateWardenP3SiphonLayout(layout: WardenP3SiphonLayout): void {
    if (layout.spawns.length === 0) {
        throw new RangeError("A Wardens siphon intermission requires at least one siphon");
    }
    if (!Number.isFinite(layout.deadlineSeconds) || layout.deadlineSeconds <= 0) {
        throw new RangeError("Wardens siphon deadlineSeconds must be finite and positive");
    }
    for (const spawn of layout.spawns) {
        if (
            !Number.isInteger(spawn.x) ||
            !Number.isInteger(spawn.y) ||
            !Number.isInteger(spawn.level) ||
            !Number.isFinite(spawn.rotation)
        ) {
            throw new RangeError("Wardens siphon spawns must have finite tile positions and rotation");
        }
    }
}
