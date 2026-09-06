import { WeaponStyle } from "../../game/Ability";
import { EnemyTypeId } from "../../game/EnemyType";
import { StanceSeqIds, StanceSeqIdsByStance } from "../../game/Player";
import { ProjectileKind } from "../../game/Projectile";
import { VisualEffectKind } from "../../game/VisualEffect";
import { AnimationFrames, resolveAnimationFrames } from "../AnimationFrames";

export type StanceAnimationSet = StanceSeqIds & {
    idleAnim: AnimationFrames;
    animationsBySeqId: ReadonlyMap<number, AnimationFrames>;
};

export type PlayerActorData = {
    stances: Record<WeaponStyle, StanceAnimationSet>;
};

export function getStanceSeqIds(data: PlayerActorData): StanceSeqIdsByStance {
    return data.stances;
}

export function getPlayerAnimationFrames(
    data: PlayerActorData,
    style: WeaponStyle,
    seqId: number,
): AnimationFrames {
    const set = data.stances[style];
    return set.animationsBySeqId.get(seqId) ?? set.idleAnim;
}

export type EnemyTypeAnimationSet = {
    idleSeqId: number;
    animationsBySeqId: ReadonlyMap<number, AnimationFrames>;
};

export function getEnemyAnimationFrames(
    data: EnemyTypeAnimationSet,
    seqId: number,
): AnimationFrames {
    const anim = data.animationsBySeqId.get(seqId);
    if (anim) {
        return anim;
    }
    return data.animationsBySeqId.get(data.idleSeqId)!;
}

export type ProjectileMesh = {
    anim: AnimationFrames;
    rotationOffset: number;
};

export type ProjectileActorData = {
    projectileMeshes: Record<ProjectileKind, ProjectileMesh>;
    effectAnimations: Record<VisualEffectKind, AnimationFrames>;
};

export type ActorRenderData = {
    player: PlayerActorData;
    enemyTypes: Partial<Record<EnemyTypeId, EnemyTypeAnimationSet>>;
    projectiles: ProjectileActorData;
};
