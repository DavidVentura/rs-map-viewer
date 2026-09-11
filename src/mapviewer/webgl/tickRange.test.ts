import { AMBIENT_TICK_RADIUS_SQUARES, isWithinTickRange, worldToMapSquare } from "./tickRange";

describe("worldToMapSquare", () => {
    it("maps world units to the containing map square", () => {
        expect(worldToMapSquare(0, 0)).toEqual({ mapX: 0, mapY: 0 });
        expect(worldToMapSquare(64 * 128 - 1, 64 * 128)).toEqual({ mapX: 0, mapY: 1 });
        expect(worldToMapSquare(50 * 64 * 128 + 37 * 128 + 64, 50 * 64 * 128)).toEqual({
            mapX: 50,
            mapY: 50,
        });
    });
});

describe("isWithinTickRange", () => {
    const focus = { mapX: 50, mapY: 50 };

    it("includes the focus square itself", () => {
        expect(isWithinTickRange(focus, 50, 50)).toBe(true);
    });

    it("includes every square within the radius, diagonals included", () => {
        const r = AMBIENT_TICK_RADIUS_SQUARES;
        expect(isWithinTickRange(focus, 50 + r, 50)).toBe(true);
        expect(isWithinTickRange(focus, 50, 50 - r)).toBe(true);
        expect(isWithinTickRange(focus, 50 - r, 50 + r)).toBe(true);
    });

    it("excludes squares just beyond the radius", () => {
        const r = AMBIENT_TICK_RADIUS_SQUARES;
        expect(isWithinTickRange(focus, 50 + r + 1, 50)).toBe(false);
        expect(isWithinTickRange(focus, 50, 50 - r - 1)).toBe(false);
        expect(isWithinTickRange(focus, 50 + r + 1, 50 + r + 1)).toBe(false);
    });
});
