import { CollisionFlag } from "../../rs/pathfinder/flag/CollisionFlag";
import { Scene } from "../../rs/scene/Scene";
import { MapManager } from "../MapManager";
import { Terrain } from "../game/Terrain";
import { WebGLMapSquare } from "./WebGLMapSquare";
import { splitWorldCoord } from "./WorldCoords";

const OCCUPY_RADIUS = 32;

const BLOCKING_FLAGS =
    CollisionFlag.OBJECT |
    CollisionFlag.FLOOR_DECORATION |
    CollisionFlag.FLOOR |
    CollisionFlag.BLOCK_PLAYERS;

export class WebGLTerrain implements Terrain {
    constructor(private readonly mapManager: MapManager<WebGLMapSquare>) {}

    canOccupy(level: number, x: number, y: number): boolean {
        const { mapCoord: mapX, localCoord: localX } = splitWorldCoord(x);
        const { mapCoord: mapY, localCoord: localY } = splitWorldCoord(y);
        const mapSquare = this.getMapSquare(mapX, mapY);

        const minTileX = Math.floor((localX - OCCUPY_RADIUS) / 128);
        const maxTileX = Math.floor((localX + OCCUPY_RADIUS) / 128);
        const minTileY = Math.floor((localY - OCCUPY_RADIUS) / 128);
        const maxTileY = Math.floor((localY + OCCUPY_RADIUS) / 128);
        if (
            minTileX < 0 ||
            minTileY < 0 ||
            maxTileX >= Scene.MAP_SQUARE_SIZE ||
            maxTileY >= Scene.MAP_SQUARE_SIZE
        ) {
            return false;
        }

        const collisionMap = mapSquare.collisionMaps[level];
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
                if (
                    collisionMap.hasFlag(
                        tileX + mapSquare.borderSize,
                        tileY + mapSquare.borderSize,
                        BLOCKING_FLAGS,
                    )
                ) {
                    return false;
                }
            }
        }
        return true;
    }

    getWallFlag(level: number, tileX: number, tileY: number): number {
        const mapX = Math.floor(tileX / Scene.MAP_SQUARE_SIZE);
        const mapY = Math.floor(tileY / Scene.MAP_SQUARE_SIZE);
        const mapSquare = this.getMapSquare(mapX, mapY);
        return mapSquare.collisionMaps[level].getFlag(
            tileX - mapX * Scene.MAP_SQUARE_SIZE + mapSquare.borderSize,
            tileY - mapY * Scene.MAP_SQUARE_SIZE + mapSquare.borderSize,
        );
    }

    getHeight(level: number, x: number, y: number): number {
        const { mapCoord: mapX, localCoord: localX } = splitWorldCoord(x);
        const { mapCoord: mapY, localCoord: localY } = splitWorldCoord(y);
        const mapSquare = this.getMapSquare(mapX, mapY);
        return mapSquare.getHeightAt(localX, localY, level);
    }

    private getMapSquare(mapX: number, mapY: number): WebGLMapSquare {
        const mapSquare = this.mapManager.getMapSquare(mapX, mapY);
        if (!mapSquare) {
            throw new Error(`Map square ${mapX},${mapY} is not loaded`);
        }
        return mapSquare;
    }
}
