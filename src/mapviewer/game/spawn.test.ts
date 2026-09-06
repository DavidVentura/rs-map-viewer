import { Terrain } from "./Terrain";
import { resolveSpawn } from "./spawn";

class FakeTerrain implements Terrain {
    constructor(private readonly occupiablePoints: Set<string>) {}

    isLoaded(): boolean {
        return true;
    }

    canOccupy(level: number, x: number, y: number): boolean {
        return this.occupiablePoints.has(`${x},${y}`);
    }

    getWallFlag(): number {
        throw new Error("not used by spawn resolution");
    }

    getHeight(): number {
        throw new Error("not used by spawn resolution");
    }
}

describe("resolveSpawn", () => {
    it("returns the requested tile when it is already occupiable", () => {
        const terrain = new FakeTerrain(new Set(["100,200"]));
        const result = resolveSpawn(terrain, 0, 100, 200);
        expect(result).toEqual({ x: 100, y: 200 });
    });

    it("searches north in 1-tile steps until it finds an occupiable tile", () => {
        const terrain = new FakeTerrain(new Set(["100,456"]));
        const result = resolveSpawn(terrain, 0, 100, 200);
        expect(result).toEqual({ x: 100, y: 456 });
    });

    it("throws when no occupiable tile is found within the search range", () => {
        const terrain = new FakeTerrain(new Set());
        expect(() => resolveSpawn(terrain, 0, 100, 200)).toThrow();
    });
});
