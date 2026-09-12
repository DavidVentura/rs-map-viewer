import { SeqTiming } from "./Animation";
import { EnemyTypeId, ResolvedEnemyType } from "./EnemyType";
import { InteractionId } from "./Interaction";
import { PlayerAnimations } from "./Player";
import { ProjectileKind } from "./Projectile";
import { VisualEffectKind } from "./VisualEffect";

// Every sequence an encounter can play, resolved from its SeqCatalog when it loads (see
// assets/encounterAnimations.ts). GameWorld only ever reads timings from here. enemyType and
// interactionSeq only hand out what was resolved at load and throw for anything else.
export type EncounterAnimations = {
    readonly player: PlayerAnimations;
    readonly enemyType: (id: EnemyTypeId) => ResolvedEnemyType;
    readonly interactionSeq: (id: InteractionId) => SeqTiming;
    readonly effects: Readonly<Record<VisualEffectKind, SeqTiming>>;
    // Undefined for a projectile whose model has no travel sequence.
    readonly projectileTravel: Readonly<Record<ProjectileKind, SeqTiming | undefined>>;
};
