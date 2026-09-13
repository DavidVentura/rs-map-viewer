import {
    WARDEN_P3_FLOOR_TILES,
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    pullWardenP3ArenaTiles,
    wardenP3ArenaRow,
    wardenP3ArenaTile,
    wardenP3PullableTiles,
    wardenP3RowTileY,
    wardenP3RowTiles,
} from "./WardenP3Arena";
import {
    WARDEN_P3_VOID_PIECES,
    WardenP3VoidPlacement,
    WardenP3WalledSides,
    wardenP3CollapsedFloor,
    wardenP3VoidPieceKey,
    wardenP3VoidPiecesForSides,
    wardenP3WalledSides,
} from "./WardenP3CollapsedFloor";

function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function clearRows(count: number): WardenP3ArenaFloor {
    let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
    for (let row = 0; row < count; row++) {
        floor = pullWardenP3ArenaTiles(
            floor,
            wardenP3PullableTiles(floor).length,
            Math.random,
        ).floor;
    }
    return floor;
}

// The first draw of a pull picks the pool entry the random value lands in.
function pullTileAt(floor: WardenP3ArenaFloor, x: number): WardenP3ArenaFloor {
    const pool = wardenP3PullableTiles(floor);
    const index = pool.findIndex((tile) => tile.x === x);
    if (index === -1) {
        throw new Error(`Tile ${x} is not pullable`);
    }
    return pullWardenP3ArenaTiles(floor, 1, () => (index + 0.5) / pool.length).floor;
}

function rowY(distanceFromWarden: number): number {
    return wardenP3RowTileY(wardenP3ArenaRow(distanceFromWarden));
}

function sidesAt(floor: WardenP3ArenaFloor, x: number, y: number): WardenP3WalledSides {
    return wardenP3WalledSides(floor, wardenP3ArenaTile(x, y));
}

function placementAt(
    placements: readonly WardenP3VoidPlacement[],
    x: number,
    y: number,
): WardenP3VoidPlacement {
    const placement = placements.find(({ tile }) => tile.x === x && tile.y === y);
    if (!placement) {
        throw new Error(`No collapsed floor piece at ${x},${y}`);
    }
    return placement;
}

function expectPieceFor(
    placements: readonly WardenP3VoidPlacement[],
    x: number,
    y: number,
    sides: WardenP3WalledSides,
): void {
    expect(wardenP3VoidPiecesForSides(sides)).toContainEqual(placementAt(placements, x, y).piece);
}

describe("Wardens P3 collapsed floor", () => {
    it("rests plain rock under every tile of an intact floor", () => {
        const placements = wardenP3CollapsedFloor(WARDEN_P3_INITIAL_ARENA_FLOOR);

        expect(placements.map(({ tile }) => tile)).toEqual(WARDEN_P3_FLOOR_TILES);
        for (const { tile } of placements) {
            expectPieceFor(placements, tile.x, tile.y, "----");
        }
    });

    it("rims a pulled far row against the far edge and the row still standing", () => {
        const floor = clearRows(1);
        const placements = wardenP3CollapsedFloor(floor);
        const farY = rowY(9);

        expect(sidesAt(floor, 3926, farY)).toBe("N-SW");
        expect(sidesAt(floor, 3936, farY)).toBe("N-S-");
        expect(sidesAt(floor, 3946, farY)).toBe("NES-");
        for (const tile of wardenP3RowTiles(wardenP3ArenaRow(9))) {
            expectPieceFor(placements, tile.x, tile.y, sidesAt(floor, tile.x, tile.y));
        }
        for (const tile of wardenP3RowTiles(wardenP3ArenaRow(8))) {
            expectPieceFor(placements, tile.x, tile.y, "----");
        }
    });

    it("opens a pulled row onto the pulled rows beyond it", () => {
        const floor = clearRows(2);

        expect(sidesAt(floor, 3926, rowY(9))).toBe("N--W");
        expect(sidesAt(floor, 3936, rowY(9))).toBe("N---");
        expect(sidesAt(floor, 3946, rowY(9))).toBe("NE--");
        expect(sidesAt(floor, 3926, rowY(8))).toBe("--SW");
        expect(sidesAt(floor, 3936, rowY(8))).toBe("--S-");
        expect(sidesAt(floor, 3946, rowY(8))).toBe("-ES-");
    });

    it("walls pulled tiles against the floor's stepped sides", () => {
        const floor = clearRows(4);

        expect(sidesAt(floor, 3927, rowY(6))).toBe("--SW");
        expect(sidesAt(floor, 3928, rowY(6))).toBe("--S-");
        expect(sidesAt(floor, 3945, rowY(6))).toBe("-ES-");
        expect(sidesAt(floor, 3926, rowY(7))).toBe("--SW");
        expect(sidesAt(floor, 3927, rowY(7))).toBe("----");
        expect(sidesAt(floor, 3926, rowY(8))).toBe("---W");
        expect(sidesAt(floor, 3946, rowY(8))).toBe("-E--");
    });

    it("walls a lone pulled tile on every side still standing", () => {
        const farRowFloor = pullTileAt(WARDEN_P3_INITIAL_ARENA_FLOOR, 3936);
        expect(sidesAt(farRowFloor, 3936, rowY(9))).toBe("NESW");

        const lone = pullTileAt(clearRows(1), 3936);
        expect(sidesAt(lone, 3936, rowY(8))).toBe("-ESW");
        expect(sidesAt(lone, 3936, rowY(9))).toBe("N---");

        const pair = pullTileAt(lone, 3937);
        expect(sidesAt(pair, 3936, rowY(8))).toBe("--SW");
        expect(sidesAt(pair, 3937, rowY(8))).toBe("-ES-");
        expectPieceFor(wardenP3CollapsedFloor(pair), 3937, rowY(8), "-ES-");
    });

    it("keeps a tile's piece while nothing beside it changes", () => {
        const before = clearRows(1);
        const after = pullTileAt(before, 3930);

        for (const { tile, piece } of wardenP3CollapsedFloor(after)) {
            if (Math.abs(tile.x - 3930) <= 1) {
                continue;
            }
            expect(piece).toEqual(
                placementAt(wardenP3CollapsedFloor(before), tile.x, tile.y).piece,
            );
        }
    });

    it("only ever draws pieces from the baked set while the whole floor is pulled", () => {
        const baked = new Set(WARDEN_P3_VOID_PIECES.map(wardenP3VoidPieceKey));
        const random = seededRandom(7);
        let floor = WARDEN_P3_INITIAL_ARENA_FLOOR;
        while (wardenP3PullableTiles(floor).length > 0) {
            floor = pullWardenP3ArenaTiles(floor, 1, random).floor;
            for (const { piece } of wardenP3CollapsedFloor(floor)) {
                expect(baked.has(wardenP3VoidPieceKey(piece))).toBe(true);
            }
        }
    });

    it("rejects sides no pulled tile can have", () => {
        expect(() => wardenP3VoidPiecesForSides("-E-W")).toThrow();
        expect(() => wardenP3VoidPiecesForSides("NE-W")).toThrow();
    });
});
