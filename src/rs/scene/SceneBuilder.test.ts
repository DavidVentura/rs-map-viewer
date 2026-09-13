import { CacheInfo } from "../cache/CacheInfo";
import { Scene } from "./Scene";
import { SceneBuilder } from "./SceneBuilder";

function buildTerrainData(blockedFloorLocalX: number, blockedFloorLocalY: number): Int8Array {
    const bytes: number[] = [];
    for (let level = 0; level < Scene.MAX_LEVELS; level++) {
        for (let x = 0; x < Scene.MAP_SQUARE_SIZE; x++) {
            for (let y = 0; y < Scene.MAP_SQUARE_SIZE; y++) {
                if (level === 0 && x === blockedFloorLocalX && y === blockedFloorLocalY) {
                    // render flag byte (50 => flags = 50 - 49 = 1, blocked-by-floor bit set)
                    bytes.push(50);
                }
                bytes.push(0);
            }
        }
    }
    return new Int8Array(bytes);
}

describe("SceneBuilder.decodeTerrain", () => {
    it("sets floor collision at scene coordinates, not local map square coordinates", () => {
        const cacheInfo = { game: "oldschool", revision: 200 } as CacheInfo;
        const sceneBuilder = new SceneBuilder(
            cacheInfo,
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
        );

        const offsetX = 10;
        const offsetY = 20;
        const localX = Scene.MAP_SQUARE_SIZE - 1;
        const localY = Scene.MAP_SQUARE_SIZE - 1;

        const scene = new Scene(Scene.MAX_LEVELS, 80, 90);
        const data = buildTerrainData(localX, localY);

        sceneBuilder.decodeTerrain(scene, data, offsetX, offsetY, 0, 0);

        const sceneX = localX + offsetX;
        const sceneY = localY + offsetY;

        expect(scene.collisionMaps[0].hasFlag(sceneX, sceneY, 0x200000)).toBe(true);
        expect(scene.collisionMaps[0].hasFlag(localX, localY, 0x200000)).toBe(false);
    });
});
