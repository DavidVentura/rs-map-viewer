import { CacheRoots, canonicalCacheRoots } from "../../rs/cache/pack/CacheRoots";
import { PackRequest, canonicalPackRequest } from "../../rs/cache/pack/PackRequest";
import { AnimPreviewParams } from "../game/AnimPreview";
import { Encounter, buildPreviewEncounter } from "../game/Encounter";
import {
    ActorAssets,
    PreviewAssets,
    ProjectileBake,
    SpotAnimBake,
    actorAssets,
} from "./ActorAssets";

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

// The cache ids an encounter reads by game-declared id: its map squares and everything its actor
// buffer is baked from. Whatever the cache itself references from these (models, frames, textures,
// locs) is left for the pack resolver to follow, and the spawns inside the squares for the pack
// server to add (see packRequest).
export function cacheRoots(
    encounter: Encounter,
    preview: AnimPreviewParams | undefined,
): CacheRoots {
    return canonicalCacheRoots({
        mapSquares: encounter.mapSquares,
        ...actorRoots(actorAssets(encounter, preview)),
    });
}

// The pack an encounter loads: its roots, with the obj spawns of every square and, for encounters
// with ambient npcs, the npc spawns. The animation viewer maps the base encounter's squares without
// ambient npcs (see MapViewer.encounter), so its pack leaves them out.
export function packRequest(
    encounter: Encounter,
    preview: AnimPreviewParams | undefined,
): PackRequest {
    const mapped = preview ? buildPreviewEncounter(encounter) : encounter;
    return canonicalPackRequest({
        roots: cacheRoots(encounter, preview),
        npcSpawnSquares: mapped.ambientNpcs ? mapped.mapSquares : [],
        objSpawnSquares: mapped.mapSquares,
    });
}
