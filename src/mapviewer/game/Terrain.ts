export interface Terrain {
    canOccupy(level: number, x: number, y: number): boolean;
    getWallFlag(level: number, tileX: number, tileY: number): number;
    getHeight(level: number, x: number, y: number): number;
}
