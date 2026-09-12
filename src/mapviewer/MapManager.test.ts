import { getMapSquareId } from "../rs/map/MapFileIndex";
import { MapSquareCoord } from "../rs/map/MapSquareCoord";
import { Camera } from "./Camera";
import { MapManager, MapSquare, ResidencyPolicyKind } from "./MapManager";

const WORLD: readonly MapSquareCoord[] = [
    { mapX: 36, mapY: 78 },
    { mapX: 37, mapY: 78 },
    { mapX: 37, mapY: 79 },
];

class FakeSquare implements MapSquare {
    deleted = false;

    constructor(
        readonly mapX: number,
        readonly mapY: number,
    ) {}

    canRender(): boolean {
        return true;
    }

    delete(): void {
        this.deleted = true;
    }
}

function ids(squares: readonly MapSquareCoord[]): Set<number> {
    return new Set(squares.map(({ mapX, mapY }) => getMapSquareId(mapX, mapY)));
}

function createManager(kind: ResidencyPolicyKind, maxQueuedTasks = 8) {
    const requested: MapSquareCoord[] = [];
    const manager = new MapManager<FakeSquare>(
        maxQueuedTasks,
        (mapX, mapY) => requested.push({ mapX, mapY }),
        kind,
        WORLD,
    );
    return { manager, requested };
}

function camera(): Camera {
    const camera = new Camera(37 * 64 + 32, -26, 79 * 64 + 32, -245, 1862);
    camera.update(1280, 800);
    return camera;
}

describe("MapManager", () => {
    it("loads every world square on the first update of the whole world policy", () => {
        const { manager, requested } = createManager(ResidencyPolicyKind.WHOLE_WORLD);

        manager.update(camera(), 0, { kind: ResidencyPolicyKind.WHOLE_WORLD });

        expect(ids(requested)).toEqual(ids(WORLD));
        expect(requested).toHaveLength(WORLD.length);
    });

    it("requests the world squares a full queue turned away on later updates", () => {
        const { manager, requested } = createManager(ResidencyPolicyKind.WHOLE_WORLD, 0);

        manager.update(camera(), 0, { kind: ResidencyPolicyKind.WHOLE_WORLD });
        expect(requested).toHaveLength(1);

        for (const { mapX, mapY } of [...requested]) {
            manager.addMap(mapX, mapY, new FakeSquare(mapX, mapY));
        }
        manager.update(camera(), 1, { kind: ResidencyPolicyKind.WHOLE_WORLD });
        expect(requested).toHaveLength(2);
    });

    it.each([ResidencyPolicyKind.WHOLE_WORLD, ResidencyPolicyKind.CAMERA_FLY_OVER])(
        "never loads a square outside the world under the %s policy",
        (kind) => {
            const { manager, requested } = createManager(kind);

            manager.loadMap(38, 79);
            manager.loadMap(37, 80);

            expect(requested).toEqual([]);
        },
    );

    it("keeps flying over to the world's squares", () => {
        const { manager, requested } = createManager(ResidencyPolicyKind.CAMERA_FLY_OVER);

        manager.update(camera(), 0, {
            kind: ResidencyPolicyKind.CAMERA_FLY_OVER,
            renderDistance: 512,
            unloadDistance: 2,
        });

        expect(requested.length).toBeGreaterThan(0);
        for (const square of requested) {
            expect(ids(WORLD).has(getMapSquareId(square.mapX, square.mapY))).toBe(true);
        }
    });

    it("reloads the whole world after its maps are cleared", () => {
        const { manager, requested } = createManager(ResidencyPolicyKind.WHOLE_WORLD);
        manager.update(camera(), 0, { kind: ResidencyPolicyKind.WHOLE_WORLD });
        const squares = WORLD.map(({ mapX, mapY }) => new FakeSquare(mapX, mapY));
        squares.forEach((square) => manager.addMap(square.mapX, square.mapY, square));

        manager.clearMaps();
        manager.update(camera(), 1, { kind: ResidencyPolicyKind.WHOLE_WORLD });

        expect(squares.every((square) => square.deleted)).toBe(true);
        expect(requested).toHaveLength(WORLD.length * 2);
    });

    it("refuses a loaded square from outside the world", () => {
        const { manager } = createManager(ResidencyPolicyKind.WHOLE_WORLD);

        expect(() => manager.addMap(50, 50, new FakeSquare(50, 50))).toThrow(/outside the world/);
    });
});
