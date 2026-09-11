import { EnemyTypeId } from "../../game/EnemyType";
import { StanceSeqIdsByStance } from "../../game/Player";
import { ProjectileKind } from "../../game/Projectile";
import { VisualEffectKind } from "../../game/VisualEffect";
import { ActorMesh } from "./ActorMeshBuilder";

export interface ActorFrame {
    readonly matrixOffset: number;
    readonly alphaOffset: number;
}

export interface ActorAnimation {
    readonly mesh: ActorMesh;
    readonly frames: readonly ActorFrame[];
}

export interface ActorAnimationSet {
    readonly mesh: ActorMesh;
    readonly animationsBySeqId: ReadonlyMap<number, readonly ActorFrame[]>;
}

export interface PlayerActorData {
    readonly stanceSeqIds: StanceSeqIdsByStance;
    readonly body: ActorAnimationSet;
    readonly itemsByItemId: ReadonlyMap<number, ActorMesh>;
}

export function getPlayerBodyAnimation(data: PlayerActorData, seqId: number): ActorAnimation {
    return { mesh: data.body.mesh, frames: requiredFrames(data.body, seqId) };
}

export function getPlayerItemAnimation(
    data: PlayerActorData,
    itemId: number,
    seqId: number,
): ActorAnimation {
    const mesh = data.itemsByItemId.get(itemId);
    if (!mesh) {
        throw new Error(`No player attachment mesh for item ${itemId}`);
    }
    return { mesh, frames: requiredFrames(data.body, seqId) };
}

export type EnemyTypeAnimationSet = ActorAnimationSet;

export function getEnemyAnimation(data: EnemyTypeAnimationSet, seqId: number): ActorAnimation {
    return { mesh: data.mesh, frames: requiredFrames(data, seqId) };
}

function requiredFrames(data: ActorAnimationSet, seqId: number): readonly ActorFrame[] {
    const frames = data.animationsBySeqId.get(seqId);
    if (!frames) {
        throw new Error(`Actor sequence ${seqId} was not loaded`);
    }
    return frames;
}

export interface ProjectileActorData {
    readonly projectileMeshes: Record<ProjectileKind, ActorAnimation>;
    readonly effectAnimations: Record<VisualEffectKind, ActorAnimation>;
}

export interface PreviewGfxBake {
    readonly modelId?: number;
    readonly seqId?: number;
    readonly anim?: ActorAnimation;
}

export interface PreviewGfxAnimationSet {
    readonly bakesByGfxId: ReadonlyMap<number, PreviewGfxBake>;
}

export interface GroundItemActorData {
    readonly animationsByItemId: ReadonlyMap<number, ActorAnimation>;
}

export function getGroundItemAnimation(
    data: GroundItemActorData,
    itemId: number,
): ActorAnimation | undefined {
    return data.animationsByItemId.get(itemId);
}

export interface ActorRenderData {
    readonly player: PlayerActorData;
    readonly enemyTypes: Partial<Record<EnemyTypeId, EnemyTypeAnimationSet>>;
    readonly projectiles: ProjectileActorData;
    readonly groundItems: GroundItemActorData;
    readonly previewGfx?: PreviewGfxAnimationSet;
}
