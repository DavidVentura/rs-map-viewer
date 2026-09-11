import { WeaponStyle } from "../../game/Ability";
import { EnemyTypeId } from "../../game/EnemyType";
import { StanceSeqIds, StanceSeqIdsByStance } from "../../game/Player";
import { ProjectileKind } from "../../game/Projectile";
import { VisualEffectKind } from "../../game/VisualEffect";
import { AnimationFrames } from "../AnimationFrames";

export type StanceAnimationSet = StanceSeqIds & {
    idleAnim: AnimationFrames;
    animationsBySeqId: ReadonlyMap<number, AnimationFrames>;
};

// One item's own worn-model animation set, posed by the same skeleton frames as the body (see
// ActorRenderDataLoader.createItemAnimationSet). Drawn as its own actor instance next to the body.
export type ItemAnimationSet = {
    idleSeqId: number;
    idleAnim: AnimationFrames;
    animationsBySeqId: ReadonlyMap<number, AnimationFrames>;
};

const ALL_WEAPON_STYLES: readonly WeaponStyle[] = [
    WeaponStyle.RANGED,
    WeaponStyle.MAGIC,
    WeaponStyle.MELEE,
];

export type PlayerActorData = {
    // The body model never changes with equipment, so it is baked once per style.
    bodyByStyle: Record<WeaponStyle, StanceAnimationSet>;
    // Every equipped item worth baking as an attachment (see Equipment.equippedVisualItemIds for
    // which item ids are worn at a given moment), keyed by item id rather than by style/tier so a
    // representative item shared across tiers (or across styles, like the amulet) is baked once.
    itemsByItemId: ReadonlyMap<number, ItemAnimationSet>;
};

export function getStanceSeqIds(data: PlayerActorData): StanceSeqIdsByStance {
    const result = {} as StanceSeqIdsByStance;
    for (const style of ALL_WEAPON_STYLES) {
        result[style] = data.bodyByStyle[style];
    }
    return result;
}

export function getPlayerBodyAnimationFrames(
    data: PlayerActorData,
    style: WeaponStyle,
    seqId: number,
): AnimationFrames {
    const set = data.bodyByStyle[style];
    return set.animationsBySeqId.get(seqId) ?? set.idleAnim;
}

export function getPlayerItemAnimationFrames(
    data: PlayerActorData,
    itemId: number,
    seqId: number,
): AnimationFrames {
    const set = data.itemsByItemId.get(itemId);
    if (!set) {
        throw new Error(`No baked player attachment animation set for item ${itemId}`);
    }
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

export type ProjectileActorData = {
    projectileMeshes: Record<ProjectileKind, AnimationFrames>;
    effectAnimations: Record<VisualEffectKind, AnimationFrames>;
};

// One spot anim id's bake for the gfx preview (see ActorRenderDataLoader.createPreviewGfxAnimationSet):
// anim is undefined for an id with no model at all, so the viewer's Info line can say "no model"
// instead of the id being silently dropped from bakesByGfxId.
export type PreviewGfxBake = {
    readonly modelId?: number;
    readonly seqId?: number;
    readonly anim?: AnimationFrames;
};

export type PreviewGfxAnimationSet = {
    readonly bakesByGfxId: ReadonlyMap<number, PreviewGfxBake>;
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
    previewGfx?: PreviewGfxAnimationSet;
};
