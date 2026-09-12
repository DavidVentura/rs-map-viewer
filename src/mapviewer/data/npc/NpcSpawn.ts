export interface NpcSpawn {
    id: number;
    name?: string;
    x: number;
    y: number;
    level: number;
}

export function getMapNpcSpawns(
    spawns: NpcSpawn[],
    maxLevel: number,
    mapX: number,
    mapY: number,
): NpcSpawn[] {
    return spawns.filter((obj) => {
        const npcMapX = (obj.x / 64) | 0;
        const npcMapY = (obj.y / 64) | 0;
        return mapX === npcMapX && mapY === npcMapY && obj.level <= maxLevel;
    });
}
