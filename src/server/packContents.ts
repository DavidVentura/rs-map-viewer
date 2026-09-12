import { PackContents } from "../rs/cache/pack/CachePacker";
import { canonicalCacheRoots } from "../rs/cache/pack/CacheRoots";
import { PackRequest } from "../rs/cache/pack/PackRequest";
import {
    MapSpawns,
    canonicalMapSpawns,
    getMapNpcSpawns,
    getMapObjSpawns,
} from "../rs/map/MapSpawns";
import { Scene } from "../rs/scene/Scene";

// Every plane, the most the map loader can be asked to show.
const MAX_LEVEL = Scene.MAX_LEVELS - 1;

// What a request's pack holds: the world spawns inside its spawn squares, and its roots plus the
// types of those spawns, which the map loader reads by the spawns' ids.
export function packContents(world: MapSpawns, request: PackRequest): PackContents {
    const spawns = canonicalMapSpawns(
        request.npcSpawnSquares.flatMap(({ mapX, mapY }) =>
            getMapNpcSpawns(world.npcSpawns, MAX_LEVEL, mapX, mapY),
        ),
        request.objSpawnSquares.flatMap(({ mapX, mapY }) =>
            getMapObjSpawns(world.objSpawns, MAX_LEVEL, mapX, mapY),
        ),
    );
    const { roots } = request;
    return {
        roots: canonicalCacheRoots({
            ...roots,
            npcTypeIds: [...roots.npcTypeIds, ...spawns.npcSpawns.map((spawn) => spawn.id)],
            objTypeIds: [...roots.objTypeIds, ...spawns.objSpawns.map((spawn) => spawn.id)],
        }),
        spawns,
    };
}
