import { NpcSpawn } from "../../../rs/map/MapSpawns";
import { NpcAnimation } from "./NpcAnimation";

export type NpcSpawnGroup = {
    animation: NpcAnimation;
    spawns: NpcSpawn[];
};
