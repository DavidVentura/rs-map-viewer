const INSIDE_FLAG = 0x4;

const MAX_FOOTPRINT_TILES = 4096;

export type TileFlagLookup = (level: number, tileX: number, tileY: number) => number | undefined;

export function tileKey(tileX: number, tileY: number): string {
    return `${tileX},${tileY}`;
}

export function decodeTileKey(key: string): [number, number] {
    const [x, y] = key.split(",");
    return [Number(x), Number(y)];
}

function isInside(getTileFlags: TileFlagLookup, level: number, tileX: number, tileY: number) {
    const flags = getTileFlags(level, tileX, tileY);
    return flags !== undefined && (flags & INSIDE_FLAG) !== 0;
}

function floodFillInside(
    getTileFlags: TileFlagLookup,
    level: number,
    startX: number,
    startY: number,
): Set<string> {
    const filled = new Set<string>([tileKey(startX, startY)]);
    const queueX = [startX];
    const queueY = [startY];

    for (let i = 0; i < queueX.length && filled.size < MAX_FOOTPRINT_TILES; i++) {
        const x = queueX[i];
        const y = queueY[i];

        const neighbours: [number, number][] = [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
        ];

        for (const [nx, ny] of neighbours) {
            const key = tileKey(nx, ny);
            if (filled.has(key) || !isInside(getTileFlags, level, nx, ny)) {
                continue;
            }
            filled.add(key);
            queueX.push(nx);
            queueY.push(ny);
            if (filled.size >= MAX_FOOTPRINT_TILES) {
                break;
            }
        }
    }

    return filled;
}

function dilate(tiles: ReadonlySet<string>): Set<string> {
    const dilated = new Set<string>(tiles);

    for (const key of tiles) {
        const [tileX, tileY] = decodeTileKey(key);
        dilated.add(tileKey(tileX + 1, tileY));
        dilated.add(tileKey(tileX - 1, tileY));
        dilated.add(tileKey(tileX, tileY + 1));
        dilated.add(tileKey(tileX, tileY - 1));
    }

    return dilated;
}

export function computeRoofHiddenTiles(
    getTileFlags: TileFlagLookup,
    playerLevel: number,
    playerTileX: number,
    playerTileY: number,
): ReadonlySet<string> {
    if (!isInside(getTileFlags, playerLevel, playerTileX, playerTileY)) {
        return new Set();
    }

    const filled = floodFillInside(getTileFlags, playerLevel, playerTileX, playerTileY);
    return dilate(filled);
}
