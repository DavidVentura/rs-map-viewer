import fs from "fs";
import path from "path";

import {
    MapSpawns,
    canonicalMapSpawns,
    parseNpcSpawnList,
    parseObjSpawnList,
} from "../rs/map/MapSpawns";

// The oldschool world's spawn lists live beside this module rather than in a configured directory:
// they are versioned with the parser that reads them, unlike the downloaded caches. Every cache the
// server can pack is an oldschool one (see CacheSelectionResolver), so one pair of lists serves all.
const SPAWNS_DIR = path.join(__dirname, "spawns");
const NPC_SPAWNS_FILE = "npc-spawns-osrs.json";
const OBJ_SPAWNS_FILE = "obj-spawns.json";

function readJson(fileName: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(SPAWNS_DIR, fileName), "utf8"));
}

// Every spawn of the world; a malformed record means the list is broken, so nothing is served.
export function readWorldSpawns(): MapSpawns {
    const npcSpawns = parseNpcSpawnList(NPC_SPAWNS_FILE, readJson(NPC_SPAWNS_FILE));
    if (npcSpawns.kind === "INVALID") {
        throw new Error(npcSpawns.reason);
    }
    const objSpawns = parseObjSpawnList(OBJ_SPAWNS_FILE, readJson(OBJ_SPAWNS_FILE));
    if (objSpawns.kind === "INVALID") {
        throw new Error(objSpawns.reason);
    }
    return canonicalMapSpawns(npcSpawns.value, objSpawns.value);
}
