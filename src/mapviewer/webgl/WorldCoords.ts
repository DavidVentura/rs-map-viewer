import { Scene } from "../../rs/scene/Scene";

export const MAP_SQUARE_UNITS = Scene.MAP_SQUARE_SIZE * 128;

export function toWorld(mapCoord: number, localCoord: number): number {
    return mapCoord * MAP_SQUARE_UNITS + localCoord;
}

export function splitWorldCoord(worldCoord: number): { mapCoord: number; localCoord: number } {
    const mapCoord = Math.floor(worldCoord / MAP_SQUARE_UNITS);
    return { mapCoord, localCoord: worldCoord - mapCoord * MAP_SQUARE_UNITS };
}
