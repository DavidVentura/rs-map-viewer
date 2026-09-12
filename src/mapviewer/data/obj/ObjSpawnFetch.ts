import { ObjSpawn } from "./ObjSpawn";
import objSpawnsUrl from "./obj-spawns.json?url";

export async function fetchObjSpawns(): Promise<ObjSpawn[]> {
    const response = await fetch(objSpawnsUrl);
    return await response.json();
}
