import { NpcSpawn } from "../../data/npc/NpcSpawn";
import { NpcAnimation } from "./NpcAnimation";
import { NpcSpawnGroup } from "./NpcSpawnGroup";

export type NpcData = {
    id: number;
    tileX: number;
    tileY: number;
    level: number;
    animation: NpcAnimation;
};

export function createNpcDatas(groups: NpcSpawnGroup[]): NpcData[] {
    const npcs: NpcData[] = [];

    for (const group of groups) {
        for (const spawn of group.spawns) {
            npcs.push(createNpcData(group, spawn));
        }
    }

    return npcs;
}

export function createNpcData(group: NpcSpawnGroup, spawn: NpcSpawn): NpcData {
    const tileX = spawn.x % 64;
    const tileY = spawn.y % 64;
    const level = spawn.level;
    return {
        id: spawn.id,
        tileX,
        tileY,
        level,
        animation: group.animation,
    };
}
