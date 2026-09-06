import { SpatialGrid, SpatialPoint } from "./SpatialGrid";

type Point = SpatialPoint & { id: number };

describe("SpatialGrid", () => {
    it("finds an inserted item within the query radius", () => {
        const grid = new SpatialGrid<Point>(256);
        grid.insert({ id: 1, x: 100, y: 100 });

        const result = grid.neighboursWithin(100, 100, 50);

        expect(result).toEqual([{ id: 1, x: 100, y: 100 }]);
    });

    it("excludes items beyond the query radius", () => {
        const grid = new SpatialGrid<Point>(256);
        grid.insert({ id: 1, x: 0, y: 0 });
        grid.insert({ id: 2, x: 1000, y: 0 });

        const result = grid.neighboursWithin(0, 0, 100);

        expect(result.map((point) => point.id)).toEqual([1]);
    });

    it("finds neighbours that fall in a different cell than the query point", () => {
        const grid = new SpatialGrid<Point>(256);
        grid.insert({ id: 1, x: 250, y: 0 });
        grid.insert({ id: 2, x: 260, y: 0 });

        const result = grid.neighboursWithin(250, 0, 20);

        expect(result.map((point) => point.id).sort()).toEqual([1, 2]);
    });

    it("excludes an item in a neighbouring cell that is outside the query radius", () => {
        const grid = new SpatialGrid<Point>(256);
        grid.insert({ id: 1, x: 255, y: 0 });
        grid.insert({ id: 2, x: 400, y: 0 });

        const result = grid.neighboursWithin(255, 0, 10);

        expect(result.map((point) => point.id)).toEqual([1]);
    });

    it("scans every cell overlapped by a radius spanning several cells", () => {
        const grid = new SpatialGrid<Point>(64);
        grid.insert({ id: 1, x: -100, y: -100 });
        grid.insert({ id: 2, x: 100, y: 100 });
        grid.insert({ id: 3, x: 5000, y: 5000 });

        const result = grid.neighboursWithin(0, 0, 200);

        expect(result.map((point) => point.id).sort()).toEqual([1, 2]);
    });

    it("builds a populated grid in one call via build()", () => {
        const items: Point[] = [
            { id: 1, x: 0, y: 0 },
            { id: 2, x: 10, y: 10 },
        ];
        const grid = SpatialGrid.build(256, items);

        const result = grid.neighboursWithin(0, 0, 20);

        expect(result.map((point) => point.id).sort()).toEqual([1, 2]);
    });
});
