import { CollisionFlag } from "../../rs/pathfinder/flag/CollisionFlag";
import { Terrain } from "./Terrain";
import { resolveMovement } from "./movement";

class FakeTerrain implements Terrain {
    blockedPoints = new Set<string>();
    wallFlags = new Map<string, number>();

    block(x: number, y: number): void {
        this.blockedPoints.add(`${x},${y}`);
    }

    setWallFlag(tileX: number, tileY: number, flag: number): void {
        this.wallFlags.set(`${tileX},${tileY}`, flag);
    }

    isLoaded(): boolean {
        return true;
    }

    canOccupy(level: number, x: number, y: number): boolean {
        return !this.blockedPoints.has(`${x},${y}`);
    }

    getWallFlag(level: number, tileX: number, tileY: number): number {
        return this.wallFlags.get(`${tileX},${tileY}`) ?? 0;
    }

    getHeight(): number {
        throw new Error("not used by movement resolution");
    }
}

describe("resolveMovement", () => {
    it("moves freely on open terrain", () => {
        const terrain = new FakeTerrain();
        const result = resolveMovement(terrain, 0, 100, 100, 10, 10);
        expect(result).toEqual({ x: 110, y: 110 });
    });

    it("stops on the blocked axis when the destination point cannot be occupied", () => {
        const terrain = new FakeTerrain();
        terrain.block(110, 100);
        const result = resolveMovement(terrain, 0, 100, 100, 10, 0);
        expect(result).toEqual({ x: 100, y: 100 });
    });

    it("blocks crossing east when the source tile has a wall east flag", () => {
        const terrain = new FakeTerrain();
        terrain.setWallFlag(0, 0, CollisionFlag.WALL_EAST);
        const result = resolveMovement(terrain, 0, 127, 0, 10, 0);
        expect(result.x).toBe(127);
    });

    it("blocks crossing east when the target tile has a wall west flag", () => {
        const terrain = new FakeTerrain();
        terrain.setWallFlag(1, 0, CollisionFlag.WALL_WEST);
        const result = resolveMovement(terrain, 0, 127, 0, 10, 0);
        expect(result.x).toBe(127);
    });

    it("blocks crossing west when the source tile has a wall west flag", () => {
        const terrain = new FakeTerrain();
        terrain.setWallFlag(1, 0, CollisionFlag.WALL_WEST);
        const result = resolveMovement(terrain, 0, 137, 0, -10, 0);
        expect(result.x).toBe(137);
    });

    it("blocks crossing west when the target tile has a wall east flag", () => {
        const terrain = new FakeTerrain();
        terrain.setWallFlag(0, 0, CollisionFlag.WALL_EAST);
        const result = resolveMovement(terrain, 0, 137, 0, -10, 0);
        expect(result.x).toBe(137);
    });

    it("blocks crossing north when the source tile has a wall north flag", () => {
        const terrain = new FakeTerrain();
        terrain.setWallFlag(0, 0, CollisionFlag.WALL_NORTH);
        const result = resolveMovement(terrain, 0, 0, 127, 0, 10);
        expect(result.y).toBe(127);
    });

    it("blocks crossing south when the source tile has a wall south flag", () => {
        const terrain = new FakeTerrain();
        terrain.setWallFlag(0, 1, CollisionFlag.WALL_SOUTH);
        const result = resolveMovement(terrain, 0, 0, 137, 0, -10);
        expect(result.y).toBe(137);
    });

    it("allows movement within the same tile even with wall flags set", () => {
        const terrain = new FakeTerrain();
        terrain.setWallFlag(0, 0, CollisionFlag.WALL_EAST);
        const result = resolveMovement(terrain, 0, 10, 10, 5, 0);
        expect(result.x).toBe(15);
    });

    it("splits large diagonal deltas into multiple steps, resolving x before y each step", () => {
        const terrain = new FakeTerrain();
        const result = resolveMovement(terrain, 0, 0, 0, 32, 32);
        expect(result).toEqual({ x: 32, y: 32 });
    });

    it("resolves x before y within the same step", () => {
        const terrain = new FakeTerrain();
        // (10, 10) is blocked, but (10, 0) is not: x resolves first using the old y,
        // then y is resolved (and rejected) using the already-updated x.
        terrain.block(10, 10);
        const result = resolveMovement(terrain, 0, 0, 0, 10, 10);
        expect(result).toEqual({ x: 10, y: 0 });
    });
});
