import { TileFlagLookup, computeRoofHiddenTiles, tileKey } from "./roofHiding";

const INSIDE = 0x4;
const OUTSIDE = 0;

class FakeFlags {
    private flags = new Map<string, number>();
    private loaded = new Set<string>();

    set(level: number, tileX: number, tileY: number, flags: number): void {
        this.flags.set(`${level},${tileX},${tileY}`, flags);
        this.loaded.add(`${level},${tileX},${tileY}`);
    }

    setRoom(level: number, minX: number, maxX: number, minY: number, maxY: number): void {
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                this.set(level, x, y, INSIDE);
            }
        }
    }

    lookup: TileFlagLookup = (level, tileX, tileY) => {
        const key = `${level},${tileX},${tileY}`;
        if (!this.loaded.has(key)) {
            return undefined;
        }
        return this.flags.get(key) ?? OUTSIDE;
    };
}

describe("computeRoofHiddenTiles", () => {
    it("returns empty when the player's tile is not inside", () => {
        const flags = new FakeFlags();
        flags.set(0, 5, 5, OUTSIDE);

        const result = computeRoofHiddenTiles(flags.lookup, 0, 5, 5);

        expect(result.size).toBe(0);
    });

    it("floods only contiguous inside tiles and stops at non-inside tiles", () => {
        const flags = new FakeFlags();
        flags.setRoom(0, 0, 2, 0, 2);
        // Isolated inside tile, not reachable from the room.
        flags.set(0, 10, 10, INSIDE);

        const result = computeRoofHiddenTiles(flags.lookup, 0, 1, 1);

        expect(result.has(tileKey(1, 1))).toBe(true);
        expect(result.has(tileKey(10, 10))).toBe(false);
    });

    it("dilates the fill by one tile ring around the walls", () => {
        const flags = new FakeFlags();
        flags.setRoom(0, 0, 2, 0, 2);

        const result = computeRoofHiddenTiles(flags.lookup, 0, 1, 1);

        // Directly adjacent to the room (the wall/overhang ring).
        expect(result.has(tileKey(-1, 1))).toBe(true);
        expect(result.has(tileKey(3, 1))).toBe(true);
        expect(result.has(tileKey(1, -1))).toBe(true);
        expect(result.has(tileKey(1, 3))).toBe(true);
        // Two tiles away from the room: outside the dilation ring.
        expect(result.has(tileKey(-2, 1))).toBe(false);
        expect(result.has(tileKey(4, 1))).toBe(false);
    });

    it("caps the flood fill at a sane tile count", () => {
        const flags = new FakeFlags();
        flags.setRoom(0, -200, 200, -200, 200);

        const result = computeRoofHiddenTiles(flags.lookup, 0, 0, 0);

        // Far fewer than the full 401x401 room, but the cap plus its dilation ring
        // still produced a real result.
        expect(result.size).toBeGreaterThan(0);
        expect(result.size).toBeLessThan(401 * 401);
        expect(result.size).toBeLessThan(4096 + 1000);
    });

    it("treats an unloaded square as a boundary that stops the flood fill", () => {
        const flags = new FakeFlags();
        // Room A, and a separate room B only reachable by crossing tile (3,0),
        // which is never loaded.
        flags.setRoom(0, 0, 2, 0, 0);
        flags.setRoom(0, 4, 6, 0, 0);

        const result = computeRoofHiddenTiles(flags.lookup, 0, 1, 0);

        expect(result.has(tileKey(2, 0))).toBe(true);
        // Dilation still reaches the unloaded gap tile directly next to room A...
        expect(result.has(tileKey(3, 0))).toBe(true);
        // ...but the fill never crossed it, so room B is untouched.
        expect(result.has(tileKey(4, 0))).toBe(false);
        expect(result.has(tileKey(5, 0))).toBe(false);
        expect(result.has(tileKey(6, 0))).toBe(false);
    });
});
