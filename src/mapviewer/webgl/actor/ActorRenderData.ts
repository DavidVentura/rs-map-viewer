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
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames;
    deathAnim: AnimationFrames;
    attackAnim: AnimationFrames;
    idleSeqId: number;
    walkSeqId: number;
    deathSeqId: number;
    attackSeqId: number;
};

export function getEnemyAnimationFrames(
    data: EnemyTypeAnimationSet,
    seqId: number,
): AnimationFrames {
    return resolveAnimationFrames(
        seqId,
        [
            { seqId: data.walkSeqId, anim: data.walkAnim },
            { seqId: data.deathSeqId, anim: data.deathAnim },
            { seqId: data.attackSeqId, anim: data.attackAnim },
        ],
        data.idleAnim,
    );
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
