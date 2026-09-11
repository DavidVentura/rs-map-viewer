import { EnemyTypeId } from "../../game/EnemyType";
import { StanceSeqIdsByStance } from "../../game/Player";
import { ProjectileKind } from "../../game/Projectile";
import { VisualEffectKind } from "../../game/VisualEffect";
import { SkinAnimation, SkinAnimationSet, SkinFrame } from "../skin/SkinAnimation";
import { SkinnedMesh } from "../skin/SkinnedMeshBuilder";

export interface PlayerActorData {
    readonly stanceSeqIds: StanceSeqIdsByStance;
    readonly body: SkinAnimationSet;
    readonly itemsByItemId: ReadonlyMap<number, SkinnedMesh>;
}

export function getPlayerBodyAnimation(data: PlayerActorData, seqId: number): SkinAnimation {
    return { mesh: data.body.mesh, frames: requiredFrames(data.body, seqId) };
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
    return { mesh, frames: requiredFrames(data.body, seqId) };
}

export type EnemyTypeAnimationSet = SkinAnimationSet;

export function getEnemyAnimation(data: EnemyTypeAnimationSet, seqId: number): SkinAnimation {
    return { mesh: data.mesh, frames: requiredFrames(data, seqId) };
}

function requiredFrames(data: SkinAnimationSet, seqId: number): readonly SkinFrame[] {
    const frames = data.animationsBySeqId.get(seqId);
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

export interface GroundItemActorData {
    readonly animationsByItemId: ReadonlyMap<number, SkinAnimation>;
}

export function getGroundItemAnimation(
    data: GroundItemActorData,
    itemId: number,
): SkinAnimation | undefined {
    return data.animationsByItemId.get(itemId);
}

export interface ActorRenderData {
    readonly player: PlayerActorData;
    readonly enemyTypes: Partial<Record<EnemyTypeId, EnemyTypeAnimationSet>>;
    readonly projectiles: ProjectileActorData;
    readonly groundItems: GroundItemActorData;
    readonly previewGfx?: PreviewGfxAnimationSet;
}
