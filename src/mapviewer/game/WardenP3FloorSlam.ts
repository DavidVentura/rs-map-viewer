import { LocTransform, REST_LOC_TRANSFORM } from "./LocTransform";
import {
    WARDEN_P3_FRONT_CENTRE_TILE,
    WardenP3ArenaFloor,
    WardenP3ArenaTile,
    WardenP3ArenaTileOccupancy,
    wardenP3ArenaTile,
    wardenP3FloorSlamTiles,
    wardenP3TileNoise,
    wardenP3TileOccupancy,
} from "./WardenP3Arena";
import { WardenSlamTarget } from "./WardenP3SlamTarget";
import { tileKey } from "./roofHiding";

// Tuning for the travelling lift. The front advances one Chebyshev ring per step, so it reaches
// the far corner of a side slam ten rings (about a second) after the slam starts.
const SECONDS_PER_RING = 0.1;
const PULSE_SECONDS = 0.25;
// Share of the pulse spent rising; the rest settles back with one small dip below rest.
const PULSE_RISE_FRACTION = 0.3;
const PULSE_SETTLE_HALF_WAVES = 1.5;
const PEAK_LIFT = 32;
const PEAK_TILT_RADIANS = 0.14;
// Per-tile scale spread (a fraction either side of 1) so the band looks jumbled.
const LIFT_JITTER = 0.25;
const TILT_JITTER = 0.35;

export type ShockwaveTile = {
    readonly tile: WardenP3ArenaTile;
    // Chebyshev distance to the nearest origin: the front reaches the tile after this many rings.
    readonly ring: number;
    // The tile's offset from that origin, which decides which way it tips.
    readonly offsetX: number;
    readonly offsetY: number;
};

export type FloorShockwave = {
    readonly tiles: ReadonlyMap<string, ShockwaveTile>;
};

export type FloorSlam = {
    readonly shockwave: FloorShockwave;
    readonly startsAtSeconds: number;
};

function chebyshevDistance(a: WardenP3ArenaTile, b: WardenP3ArenaTile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// An expanding L from each origin (a ring per Chebyshev distance); a tile belongs to the front of
// the origin nearest to it, the first listed one on a tie.
export function floorShockwave(
    tiles: readonly WardenP3ArenaTile[],
    origins: readonly [WardenP3ArenaTile, ...WardenP3ArenaTile[]],
): FloorShockwave {
    const entries = tiles.map((tile): [string, ShockwaveTile] => {
        const origin = origins.reduce((nearest, candidate) =>
            chebyshevDistance(candidate, tile) < chebyshevDistance(nearest, tile)
                ? candidate
                : nearest,
        );
        return [
            tileKey(tile.x, tile.y),
            {
                tile,
                ring: chebyshevDistance(origin, tile),
                offsetX: tile.x - origin.x,
                offsetY: tile.y - origin.y,
            },
        ];
    });
    return { tiles: new Map(entries) };
}

export function wardenP3SlamShockwave(target: WardenSlamTarget): FloorShockwave {
    const tiles = wardenP3FloorSlamTiles(target);
    const nearestRowY = WARDEN_P3_FRONT_CENTRE_TILE.y + 1;
    const centreX = WARDEN_P3_FRONT_CENTRE_TILE.x;
    switch (target) {
        case WardenSlamTarget.LEFT:
        case WardenSlamTarget.RIGHT:
            return floorShockwave(tiles, [wardenP3ArenaTile(centreX, nearestRowY)]);
        case WardenSlamTarget.CENTRE:
            return floorShockwave(tiles, [
                wardenP3ArenaTile(centreX - 1, nearestRowY),
                wardenP3ArenaTile(centreX + 1, nearestRowY),
            ]);
    }
}

function arrivalSeconds(slam: FloorSlam, entry: ShockwaveTile): number {
    return slam.startsAtSeconds + entry.ring * SECONDS_PER_RING;
}

// Undefined for a tile the slam's shockwave does not cover.
export function floorSlamArrivalSeconds(
    slam: FloorSlam,
    tile: WardenP3ArenaTile,
): number | undefined {
    const entry = slam.shockwave.tiles.get(tileKey(tile.x, tile.y));
    if (!entry) {
        return undefined;
    }
    return arrivalSeconds(slam, entry);
}

// The tiles the front reaches within (afterSeconds, untilSeconds], so consecutive windows hit each
// tile exactly once.
export function floorSlamTilesArriving(
    slam: FloorSlam,
    afterSeconds: number,
    untilSeconds: number,
): readonly WardenP3ArenaTile[] {
    const arriving: WardenP3ArenaTile[] = [];
    for (const entry of slam.shockwave.tiles.values()) {
        const arrival = arrivalSeconds(slam, entry);
        if (arrival > afterSeconds && arrival <= untilSeconds) {
            arriving.push(entry.tile);
        }
    }
    return arriving;
}

export function floorSlamEndsAtSeconds(slam: FloorSlam): number {
    let lastRing = 0;
    for (const entry of slam.shockwave.tiles.values()) {
        lastRing = Math.max(lastRing, entry.ring);
    }
    return slam.startsAtSeconds + lastRing * SECONDS_PER_RING + PULSE_SECONDS;
}

// 0 at arrival, a quick rise to 1, then a settle with one small overshoot below rest back to 0.
function pulseProfile(progress: number): number {
    if (progress < PULSE_RISE_FRACTION) {
        return Math.sin(((progress / PULSE_RISE_FRACTION) * Math.PI) / 2);
    }
    const settle = (progress - PULSE_RISE_FRACTION) / (1 - PULSE_RISE_FRACTION);
    const decay = (1 - settle) * (1 - settle);
    return Math.cos(settle * Math.PI * PULSE_SETTLE_HALF_WAVES) * decay;
}

// The unit direction the tile's leading edge faces: along the dominant Chebyshev axis of its
// offset from the origin, diagonal on the L's corner, and none on the origin itself.
function leadingEdgeDirection(entry: ShockwaveTile): {
    readonly east: number;
    readonly north: number;
} {
    const absX = Math.abs(entry.offsetX);
    const absY = Math.abs(entry.offsetY);
    if (absX > absY) {
        return { east: Math.sign(entry.offsetX), north: 0 };
    }
    if (absY > absX) {
        return { east: 0, north: Math.sign(entry.offsetY) };
    }
    return {
        east: Math.sign(entry.offsetX) * Math.SQRT1_2,
        north: Math.sign(entry.offsetY) * Math.SQRT1_2,
    };
}

export function floorTilePose(
    slams: readonly FloorSlam[],
    tile: WardenP3ArenaTile,
    timeSeconds: number,
): LocTransform {
    const key = tileKey(tile.x, tile.y);
    let lift = 0;
    let northTilt = 0;
    let eastTilt = 0;
    let pulsing = false;
    for (const slam of slams) {
        const entry = slam.shockwave.tiles.get(key);
        if (!entry) {
            continue;
        }
        const sinceArrival = timeSeconds - arrivalSeconds(slam, entry);
        if (sinceArrival < 0 || sinceArrival > PULSE_SECONDS) {
            continue;
        }
        pulsing = true;
        const profile = pulseProfile(sinceArrival / PULSE_SECONDS);
        const tilt = profile * PEAK_TILT_RADIANS * (1 + TILT_JITTER * wardenP3TileNoise(tile, 1));
        const direction = leadingEdgeDirection(entry);
        lift += profile * PEAK_LIFT * (1 + LIFT_JITTER * wardenP3TileNoise(tile, 0));
        northTilt += tilt * direction.north;
        eastTilt += tilt * direction.east;
    }
    if (!pulsing) {
        return REST_LOC_TRANSFORM;
    }
    return { kind: "SHOWN", lift, northTilt, eastTilt };
}

export function wardenP3FloorTilePose(
    slams: readonly FloorSlam[],
    floor: WardenP3ArenaFloor,
    tile: WardenP3ArenaTile,
    timeSeconds: number,
): LocTransform {
    if (wardenP3TileOccupancy(floor, tile) === WardenP3ArenaTileOccupancy.DESTROYED_FLOOR) {
        return { kind: "HIDDEN" };
    }
    return floorTilePose(slams, tile, timeSeconds);
}
