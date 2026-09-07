import { WeaponStyle } from "../../game/Ability";
import { EnemyTypeId } from "../../game/EnemyType";
import { EquipmentState, StanceVisualKey, stanceVisualKey } from "../../game/Equipment";
import { StanceSeqIds, StanceSeqIdsByStance } from "../../game/Player";
import { ProjectileKind } from "../../game/Projectile";
import { VisualEffectKind } from "../../game/VisualEffect";
import { AnimationFrames } from "../AnimationFrames";

export type StanceAnimationSet = StanceSeqIds & {
    idleAnim: AnimationFrames;
    animationsBySeqId: ReadonlyMap<number, AnimationFrames>;
};

const ALL_WEAPON_STYLES: readonly WeaponStyle[] = [
    WeaponStyle.RANGED,
    WeaponStyle.MAGIC,
    WeaponStyle.MELEE,
];

export type PlayerActorData = {
    // Keyed by Equipment.stanceVisualKey(style, equipment); holds one baked stance per distinct
    // visual combination (see Equipment.stanceVisualVariants for which ones exist), not one per
    // raw tier index.
    stanceVariants: ReadonlyMap<StanceVisualKey, StanceAnimationSet>;
    // The default (tier 0 everywhere) variant's key per style. Seq ids never vary across a style's
    // variants (only the baked mesh does), so any variant would do for getStanceSeqIds.
    defaultStanceKeyByStyle: Record<WeaponStyle, StanceVisualKey>;
};

export function getStanceSeqIds(data: PlayerActorData): StanceSeqIdsByStance {
    const result = {} as StanceSeqIdsByStance;
    for (const style of ALL_WEAPON_STYLES) {
        result[style] = data.stanceVariants.get(data.defaultStanceKeyByStyle[style])!;
    }
    return result;
}

export function getPlayerAnimationFrames(
    data: PlayerActorData,
    style: WeaponStyle,
    equipment: EquipmentState,
    seqId: number,
): AnimationFrames {
    const key = stanceVisualKey(style, equipment);
    const set =
        data.stanceVariants.get(key) ??
        data.stanceVariants.get(data.defaultStanceKeyByStyle[style])!;
    return set.animationsBySeqId.get(seqId) ?? set.idleAnim;
}

export type EnemyTypeAnimationSet = {
    idleAnim: AnimationFrames;
    animationsBySeqId: ReadonlyMap<number, AnimationFrames>;
};

export function getEnemyAnimationFrames(
    data: EnemyTypeAnimationSet,
    seqId: number,
): AnimationFrames {
    return data.animationsBySeqId.get(seqId) ?? data.idleAnim;
}

export type ProjectileMesh = {
    anim: AnimationFrames;
    rotationOffset: number;
};

export type ProjectileActorData = {
    projectileMeshes: Record<ProjectileKind, ProjectileMesh>;
    effectAnimations: Record<VisualEffectKind, AnimationFrames>;
};

// A ground-lying equipment drop's static mesh, keyed by the OSRS item id (see
// Equipment.allDroppableItemIds for the full set baked at load time).
export type GroundItemActorData = {
    animationsByItemId: ReadonlyMap<number, AnimationFrames>;
};

export function getGroundItemAnimationFrames(
    data: GroundItemActorData,
    itemId: number,
): AnimationFrames | undefined {
    return data.animationsByItemId.get(itemId);
}

export type ActorRenderData = {
    player: PlayerActorData;
    enemyTypes: Partial<Record<EnemyTypeId, EnemyTypeAnimationSet>>;
    projectiles: ProjectileActorData;
    groundItems: GroundItemActorData;
};
