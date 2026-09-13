import { WeaponStyle } from "../../game/Ability";
import { EnemyTypeId } from "../../game/EnemyType";
import { WorldObjectKind, WorldObjectVariant } from "../../game/Interaction";
import { ProjectileKind } from "../../game/Projectile";
import { VisualEffectKind } from "../../game/VisualEffect";
import { SkinAnimation, SkinAnimationSet, SkinFrame } from "../skin/SkinAnimation";
import { SkinnedMesh } from "../skin/SkinnedMeshBuilder";

export interface PlayerActorData {
    // One body mesh per style (its permanently-worn armour hides different body-kit parts - see
    // ActorAssets.bodyModelIdsForStyle), sharing one set of posed frames (armour never changes the
    // skeleton, only which body-kit faces are included in each style's mesh).
    readonly bodyMeshesByStyle: Readonly<Record<WeaponStyle, SkinnedMesh>>;
    readonly bodyAnimationsBySeqId: ReadonlyMap<number, readonly SkinFrame[]>;
    readonly itemsByItemId: ReadonlyMap<number, SkinnedMesh>;
}

export function getPlayerBodyAnimation(
    data: PlayerActorData,
    style: WeaponStyle,
    seqId: number,
): SkinAnimation {
    return {
        mesh: data.bodyMeshesByStyle[style],
        frames: requiredFramesFrom(data.bodyAnimationsBySeqId, seqId),
    };
}

export function getPlayerItemAnimation(
    data: PlayerActorData,
    itemId: number,
    seqId: number,
): SkinAnimation {
    const mesh = data.itemsByItemId.get(itemId);
    if (!mesh) {
        throw new Error(`No player attachment mesh for item ${itemId}`);
    }
    return { mesh, frames: requiredFramesFrom(data.bodyAnimationsBySeqId, seqId) };
}

export type EnemyTypeAnimationSet = SkinAnimationSet;

export function getEnemyAnimation(data: EnemyTypeAnimationSet, seqId: number): SkinAnimation {
    return { mesh: data.mesh, frames: requiredFrames(data, seqId) };
}

function requiredFrames(data: SkinAnimationSet, seqId: number): readonly SkinFrame[] {
    return requiredFramesFrom(data.animationsBySeqId, seqId);
}

function requiredFramesFrom(
    animationsBySeqId: ReadonlyMap<number, readonly SkinFrame[]>,
    seqId: number,
): readonly SkinFrame[] {
    const frames = animationsBySeqId.get(seqId);
    if (!frames) {
        throw new Error(`Actor sequence ${seqId} was not loaded`);
    }
    return frames;
}

export interface ProjectileActorData {
    readonly projectileMeshes: Record<ProjectileKind, SkinAnimation>;
    readonly effectAnimations: Record<VisualEffectKind, SkinAnimation>;
}

export interface PreviewGfxBake {
    readonly modelId?: number;
    readonly seqId?: number;
    readonly anim?: SkinAnimation;
}

export interface PreviewGfxAnimationSet {
    readonly bakesByGfxId: ReadonlyMap<number, PreviewGfxBake>;
}

// The npc seq preview's range seqs its rig cannot pose, each with the reason.
export interface PreviewNpcBake {
    readonly unposedSeqs: ReadonlyMap<number, string>;
}

// Ground items are baked oversized (ARPG-style loot rather than true OSRS scale), so they read
// from the top-down camera; the renderer's pick box (see GROUND_ITEM_HALF_WIDTH_UNITS/
// GROUND_ITEM_HEIGHT_UNITS in WebGLMapViewerRenderer) grows off this same factor.
export const GROUND_ITEM_SCALE = 1.4;

export interface GroundItemActorData {
    readonly animationsByItemId: ReadonlyMap<number, SkinAnimation>;
}

export function getGroundItemAnimation(
    data: GroundItemActorData,
    itemId: number,
): SkinAnimation | undefined {
    return data.animationsByItemId.get(itemId);
}

export type WorldObjectMeshes = {
    readonly rest: SkinAnimation;
    readonly activated: SkinAnimation;
};

export interface WorldObjectActorData {
    readonly meshesByKind: ReadonlyMap<WorldObjectKind, WorldObjectMeshes>;
}

export function getWorldObjectAnimation(
    data: WorldObjectActorData,
    kind: WorldObjectKind,
    variant: WorldObjectVariant,
): SkinAnimation {
    const meshes = data.meshesByKind.get(kind);
    if (!meshes) {
        throw new Error(`No world object meshes loaded for ${kind}`);
    }
    return variant === WorldObjectVariant.ACTIVATED ? meshes.activated : meshes.rest;
}

export interface ActorRenderData {
    readonly player: PlayerActorData;
    readonly enemyTypes: Partial<Record<EnemyTypeId, EnemyTypeAnimationSet>>;
    readonly projectiles: ProjectileActorData;
    readonly groundItems: GroundItemActorData;
    readonly worldObjects: WorldObjectActorData;
    readonly previewGfx?: PreviewGfxAnimationSet;
    readonly previewNpc?: PreviewNpcBake;
}
