import { ProjectileKind } from "../../game/Projectile";
import { VisualEffectKind } from "../../game/VisualEffect";
import { AnimationFrames } from "../AnimationFrames";

export type ProjectileMesh = {
    anim: AnimationFrames;
    rotationOffset: number;
};

export type ProjectileRenderData = {
    projectileMeshes: Record<ProjectileKind, ProjectileMesh>;
    effectAnimations: Record<VisualEffectKind, AnimationFrames>;
};
