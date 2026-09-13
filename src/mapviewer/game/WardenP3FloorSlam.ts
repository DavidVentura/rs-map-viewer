import { LocTransform, REST_LOC_TRANSFORM } from "./LocTransform";
import { TILE_SIZE } from "./Terrain";
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

// Tuning for the travelling wobble. The front advances one Chebyshev ring per step, so it reaches
// the far corner of a side slam ten rings (about a second) after the slam starts.
const SECONDS_PER_RING = 0.1;
// Every tile's wobble is over this long after the front reaches it.
const PULSE_SECONDS = 0.4;
// The latest a tile starts wobbling after the front reaches it, so neighbours don't move in step.
const MAX_START_DELAY_SECONDS = 0.06;
// Spread of each tile's wobble length, as a fraction below the longest that fits the pulse.
const DURATION_JITTER = 0.3;
// Share of a tile's wobble spent tipping up; the rest swings back past flat once and settles.
const RISE_FRACTION = 0.3;
// Share of the settle spent swinging from the peak down past flat; the rest comes back to rest.
const SWING_FRACTION = 0.55;
const PEAK_TIP_RADIANS = 0.3;
// How far past flat a tile swings back, as a share of its own peak.
const OVERSHOOT = 0.3;
// Per-tile spread (a fraction either side of 1) so the band looks jumbled.
const TIP_JITTER = 0.4;
const OVERSHOOT_JITTER = 0.5;
// Odds of the edge a tile hinges on, taken against the way the front travels through it. Mostly the
// edge facing the origin, so most tiles kick their leading edge up as if shoved by the front; each
// side edge has SIDE_HINGE_ODDS and the leading edge the rest.
const TRAILING_HINGE_ODDS = 0.55;
const SIDE_HINGE_ODDS = 0.175;

// One salt per independent per-tile choice, so no two of them move together.
enum TileNoiseSalt {
    TRAVEL_AXIS = 10,
    HINGE_EDGE,
    START_DELAY,
    DURATION,
    TIP,
    OVERSHOOT,
}

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

enum TileEdge {
    NORTH = "NORTH",
    EAST = "EAST",
    SOUTH = "SOUTH",
    WEST = "WEST",
}

const TILE_EDGES: readonly TileEdge[] = [
    TileEdge.NORTH,
    TileEdge.EAST,
    TileEdge.SOUTH,
    TileEdge.WEST,
];

const OPPOSITE_EDGE: Readonly<Record<TileEdge, TileEdge>> = {
    [TileEdge.NORTH]: TileEdge.SOUTH,
    [TileEdge.EAST]: TileEdge.WEST,
    [TileEdge.SOUTH]: TileEdge.NORTH,
    [TileEdge.WEST]: TileEdge.EAST,
};

const CLOCKWISE_EDGE: Readonly<Record<TileEdge, TileEdge>> = {
    [TileEdge.NORTH]: TileEdge.EAST,
    [TileEdge.EAST]: TileEdge.SOUTH,
    [TileEdge.SOUTH]: TileEdge.WEST,
    [TileEdge.WEST]: TileEdge.NORTH,
};

// The unit vector from a tile's centre across the edge.
const EDGE_DIRECTION: Readonly<
    Record<TileEdge, { readonly east: number; readonly north: number }>
> = {
    [TileEdge.NORTH]: { east: 0, north: 1 },
    [TileEdge.EAST]: { east: 1, north: 0 },
    [TileEdge.SOUTH]: { east: 0, north: -1 },
    [TileEdge.WEST]: { east: -1, north: 0 },
};

// Deterministic per-tile noise in [0, 1).
function tileUnitNoise(tile: WardenP3ArenaTile, salt: TileNoiseSalt): number {
    return (wardenP3TileNoise(tile, salt) + 1) / 2;
}

// The edge the front leaves the tile through: across the dominant Chebyshev axis of its offset
// from the origin. The L's corner leaves through either of its two outer edges and the origin
// itself through any edge, chosen by the tile's noise.
function leadingEdge(entry: ShockwaveTile): TileEdge {
    const pick = tileUnitNoise(entry.tile, TileNoiseSalt.TRAVEL_AXIS);
    const absX = Math.abs(entry.offsetX);
    const absY = Math.abs(entry.offsetY);
    if (absX === 0 && absY === 0) {
        return TILE_EDGES[Math.floor(pick * TILE_EDGES.length)];
    }
    const alongX = entry.offsetX > 0 ? TileEdge.EAST : TileEdge.WEST;
    const alongY = entry.offsetY > 0 ? TileEdge.NORTH : TileEdge.SOUTH;
    if (absX > absY) {
        return alongX;
    }
    if (absY > absX) {
        return alongY;
    }
    return pick < 0.5 ? alongX : alongY;
}

function hingeEdge(entry: ShockwaveTile): TileEdge {
    const leading = leadingEdge(entry);
    const pick = tileUnitNoise(entry.tile, TileNoiseSalt.HINGE_EDGE);
    if (pick < TRAILING_HINGE_ODDS) {
        return OPPOSITE_EDGE[leading];
    }
    if (pick < TRAILING_HINGE_ODDS + SIDE_HINGE_ODDS) {
        return CLOCKWISE_EDGE[leading];
    }
    if (pick < TRAILING_HINGE_ODDS + 2 * SIDE_HINGE_ODDS) {
        return OPPOSITE_EDGE[CLOCKWISE_EDGE[leading]];
    }
    return leading;
}

// 0 at the start, a quick tip up to 1, a swing back down to -overshoot and a return to 0. The turns
// have zero slope so the tile eases through them; only the kick at the start is sudden.
function wobbleProfile(progress: number, overshoot: number): number {
    if (progress < RISE_FRACTION) {
        return Math.sin(((progress / RISE_FRACTION) * Math.PI) / 2);
    }
    const settle = (progress - RISE_FRACTION) / (1 - RISE_FRACTION);
    if (settle < SWING_FRACTION) {
        const swing = settle / SWING_FRACTION;
        return -overshoot + ((1 + overshoot) * (1 + Math.cos(swing * Math.PI))) / 2;
    }
    const back = (settle - SWING_FRACTION) / (1 - SWING_FRACTION);
    return (-overshoot * (1 + Math.cos(back * Math.PI))) / 2;
}

// How far the tile is tipped about its hinge sinceArrival seconds after the front reached it,
// positive with its free edge up. Each tile starts, lasts and swings by its own noise, always
// inside the pulse.
function tipRadians(tile: WardenP3ArenaTile, sinceArrival: number): number {
    const delay = MAX_START_DELAY_SECONDS * tileUnitNoise(tile, TileNoiseSalt.START_DELAY);
    const duration =
        (PULSE_SECONDS - MAX_START_DELAY_SECONDS) *
        (1 - DURATION_JITTER * tileUnitNoise(tile, TileNoiseSalt.DURATION));
    const progress = (sinceArrival - delay) / duration;
    if (progress <= 0 || progress >= 1) {
        return 0;
    }
    const peak = PEAK_TIP_RADIANS * (1 + TIP_JITTER * wardenP3TileNoise(tile, TileNoiseSalt.TIP));
    const overshoot =
        OVERSHOOT * (1 + OVERSHOOT_JITTER * wardenP3TileNoise(tile, TileNoiseSalt.OVERSHOOT));
    return peak * wobbleProfile(progress, overshoot);
}

// Each tile tips about one of its edges like a hinged slab: tilting it about its centre towards
// the free edge and lifting it by half a tile times the sine of the angle keeps the hinge edge at
// rest height.
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
        const tip = tipRadians(tile, sinceArrival);
        const freeEdge = EDGE_DIRECTION[OPPOSITE_EDGE[hingeEdge(entry)]];
        lift += (TILE_SIZE / 2) * Math.sin(tip);
        northTilt += tip * freeEdge.north;
        eastTilt += tip * freeEdge.east;
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
