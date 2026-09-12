import { CacheRoots, canonicalCacheRoots } from "../../rs/cache/pack/CacheRoots";
import { Scene } from "../../rs/scene/Scene";
import { NpcSpawn, getMapNpcSpawns } from "../data/npc/NpcSpawn";
import { ObjSpawn, getMapObjSpawns } from "../data/obj/ObjSpawn";
import { AnimPreviewParams } from "../game/AnimPreview";
import { Encounter } from "../game/Encounter";
import {
    ActorAssets,
    PreviewAssets,
    ProjectileBake,
    SpotAnimBake,
    actorAssets,
} from "./ActorAssets";

// Every plane, the most the map loader can be asked to show.
const MAX_LEVEL = Scene.MAX_LEVELS - 1;

type RootIds = {
    readonly npcTypeIds: readonly number[];
    readonly objTypeIds: readonly number[];
    readonly seqIds: readonly number[];
    readonly spotAnimIds: readonly number[];
};

const NO_ROOTS: RootIds = { npcTypeIds: [], objTypeIds: [], seqIds: [], spotAnimIds: [] };

function mergeRoots(parts: readonly RootIds[]): RootIds {
    return {
        npcTypeIds: parts.flatMap((part) => part.npcTypeIds),
        objTypeIds: parts.flatMap((part) => part.objTypeIds),
        seqIds: parts.flatMap((part) => part.seqIds),
        spotAnimIds: parts.flatMap((part) => part.spotAnimIds),
    };
}

function spotAnimRoots(bake: SpotAnimBake): RootIds {
    return {
        ...NO_ROOTS,
        spotAnimIds: [bake.spotAnimId],
        seqIds: bake.seq.kind === "ANIMATED" ? [bake.seq.seqId] : [],
    };
}

function projectileRoots(bake: ProjectileBake): RootIds {
    switch (bake.kind) {
        case "SPOT_ANIM":
            return spotAnimRoots(bake);
        case "ARROW_OBJ":
            return { ...NO_ROOTS, objTypeIds: [bake.objId] };
    }
}

function previewRoots(preview: PreviewAssets | undefined): RootIds {
    switch (preview?.kind) {
        case undefined:
            return NO_ROOTS;
        case "NPC_SEQS":
            return { ...NO_ROOTS, npcTypeIds: [preview.npcTypeId], seqIds: preview.seqIds };
        case "SPOT_ANIMS":
            return { ...NO_ROOTS, spotAnimIds: preview.spotAnimIds };
    }
}

function actorRoots(assets: ActorAssets): RootIds {
    const { player } = assets;
    return mergeRoots([
        {
            npcTypeIds: [player.baseNpcTypeId],
            objTypeIds: player.attachmentItemIds,
            seqIds: player.seqIds,
            spotAnimIds: [],
        },
        ...assets.enemyTypes.map((enemyType) => ({
            ...NO_ROOTS,
            npcTypeIds: [enemyType.npcTypeId],
            seqIds: enemyType.seqIds,
        })),
        previewRoots(assets.preview),
        ...Object.values<ProjectileBake>(assets.projectiles).map(projectileRoots),
        ...Object.values<SpotAnimBake>(assets.effects).map(spotAnimRoots),
        { ...NO_ROOTS, objTypeIds: assets.groundItemIds },
    ]);
}

// The cache ids an encounter reads by game-declared id: its map squares, the obj spawns (and, for
// encounters with ambient npcs, the npc spawns) inside them, and everything its actor buffer is
// baked from. Whatever the cache itself references from these (models, frames, textures, locs) is
// left for the pack resolver to follow.
export function cacheRoots(
    encounter: Encounter,
    preview: AnimPreviewParams | undefined,
    npcSpawns: NpcSpawn[],
    objSpawns: ObjSpawn[],
): CacheRoots {
    const objSpawnIds = encounter.mapSquares.flatMap(({ mapX, mapY }) =>
        getMapObjSpawns(objSpawns, MAX_LEVEL, mapX, mapY).map((spawn) => spawn.id),
    );
    const npcSpawnIds = encounter.ambientNpcs
        ? encounter.mapSquares.flatMap(({ mapX, mapY }) =>
              getMapNpcSpawns(npcSpawns, MAX_LEVEL, mapX, mapY).map((spawn) => spawn.id),
          )
        : [];
    return canonicalCacheRoots({
        mapSquares: encounter.mapSquares,
        ...mergeRoots([
            actorRoots(actorAssets(encounter, preview)),
            { ...NO_ROOTS, npcTypeIds: npcSpawnIds, objTypeIds: objSpawnIds },
        ]),
    });
}
