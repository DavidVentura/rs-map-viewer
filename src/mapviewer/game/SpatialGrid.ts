export interface SpatialPoint {
    readonly x: number;
    readonly y: number;
}

export class SpatialGrid<T extends SpatialPoint> {
    private readonly cells = new Map<string, T[]>();

    constructor(private readonly cellSize: number) {}

    static build<T extends SpatialPoint>(cellSize: number, items: readonly T[]): SpatialGrid<T> {
        const grid = new SpatialGrid<T>(cellSize);
        for (const item of items) {
            grid.insert(item);
        }
        return grid;
    }

    insert(item: T): void {
        const key = this.cellKeyFor(item.x, item.y);
        const bucket = this.cells.get(key);
        if (bucket) {
            bucket.push(item);
            return;
        }
        this.cells.set(key, [item]);
    }

    neighboursWithin(x: number, y: number, radius: number): T[] {
        const radiusSquared = radius * radius;
        const minCellX = Math.floor((x - radius) / this.cellSize);
        const maxCellX = Math.floor((x + radius) / this.cellSize);
        const minCellY = Math.floor((y - radius) / this.cellSize);
        const maxCellY = Math.floor((y + radius) / this.cellSize);

        const results: T[] = [];
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
            for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
                const bucket = this.cells.get(`${cellX},${cellY}`);
                if (!bucket) {
                    continue;
                }
                for (const item of bucket) {
                    const dx = item.x - x;
                    const dy = item.y - y;
                    if (dx * dx + dy * dy <= radiusSquared) {
                        results.push(item);
                    }
                }
            }
        }
        return results;
    }

    private cellKeyFor(x: number, y: number): string {
        return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    }
}
