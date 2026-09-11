import { NpcSpawn } from "../../data/npc/NpcSpawn";
import { NpcAnimation } from "./NpcAnimation";

export type NpcSpawnGroup = {
    animation: NpcAnimation;
    spawns: NpcSpawn[];
};
