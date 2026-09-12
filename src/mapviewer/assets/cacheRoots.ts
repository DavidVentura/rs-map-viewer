import { CacheRoots, canonicalCacheRoots } from "../../rs/cache/pack/CacheRoots";
import { PackRequest, canonicalPackRequest } from "../../rs/cache/pack/PackRequest";
import { AnimPreviewParams } from "../game/AnimPreview";
import { Encounter, buildPreviewEncounter } from "../game/Encounter";
import { WorldObjectKind } from "../game/Interaction";
import {
    ActorAssets,
    PreviewAssets,
    ProjectileBake,
    SpotAnimBake,
    WORLD_OBJECT_BAKES,
    actorAssets,
} from "./ActorAssets";
import { HUD_SPRITE_GROUP_IDS } from "./HudAssets";

type RootIds = {
    readonly npcTypeIds: readonly number[];
    readonly objTypeIds: readonly number[];
    readonly locTypeIds: readonly number[];
    readonly seqIds: readonly number[];
    readonly spotAnimIds: readonly number[];
    readonly spriteIds: readonly number[];
};

const NO_ROOTS: RootIds = {
    npcTypeIds: [],
    objTypeIds: [],
    locTypeIds: [],
    seqIds: [],
    spotAnimIds: [],
    spriteIds: [],
};

function mergeRoots(parts: readonly RootIds[]): RootIds {
    return {
        npcTypeIds: parts.flatMap((part) => part.npcTypeIds),
        objTypeIds: parts.flatMap((part) => part.objTypeIds),
        locTypeIds: parts.flatMap((part) => part.locTypeIds),
        seqIds: parts.flatMap((part) => part.seqIds),
        spotAnimIds: parts.flatMap((part) => part.spotAnimIds),
        spriteIds: parts.flatMap((part) => part.spriteIds),
    };
}

// Every sprite id the HUD reads by id (see assets/HudAssets.ts), needed regardless of encounter.
function hudRoots(): RootIds {
    return { ...NO_ROOTS, spriteIds: HUD_SPRITE_GROUP_IDS };
}

function worldObjectRoots(kind: WorldObjectKind): RootIds {
    const bake = WORLD_OBJECT_BAKES[kind];
    return { ...NO_ROOTS, locTypeIds: [bake.restLocId, bake.activatedLocId] };
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
            ...NO_ROOTS,
            npcTypeIds: [player.baseNpcTypeId],
            objTypeIds: player.attachmentItemIds,
            seqIds: player.seqIds,
        },
        ...assets.enemyTypes.map((enemyType) => ({
            ...NO_ROOTS,
            npcTypeIds: [enemyType.npcTypeId],
            seqIds: enemyType.seqIds,
        })),
        previewRoots(assets.preview),
        ...Object.values<ProjectileBake>(assets.projectiles).map(projectileRoots),
        ...Object.values<SpotAnimBake>(assets.effects).map(spotAnimRoots),
        { ...NO_ROOTS, objTypeIds: assets.groundItemDrops.map((drop) => drop.itemId) },
        ...assets.worldObjectKinds.map(worldObjectRoots),
    ]);
}

// Every sequence the game may play for these assets: exactly the seq roots its pack is built from.
export function declaredSeqIds(assets: ActorAssets): readonly number[] {
    return [...new Set(actorRoots(assets).seqIds)];
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
        ...mergeRoots([actorRoots(actorAssets(encounter, preview)), hudRoots()]),
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
