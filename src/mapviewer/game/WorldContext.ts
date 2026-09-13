import { CombatEvent } from "./CombatEvent";
import { Combatant } from "./Combatant";
import { HitEffect } from "./Effect";
import { EncounterActor, EnergySiphonActor } from "./EncounterActor";
import { EncounterAnimations } from "./EncounterAnimations";
import { Enemy } from "./Enemy";
import { EnemyStatsOverride, ResolvedEnemyType } from "./EnemyType";
import { GroundItem } from "./GroundItem";
import { Player } from "./Player";
import { Experience } from "./Progression";
import { ProjectileImpact, ProjectileSpec, ProjectileTarget } from "./Projectile";
import { Terrain } from "./Terrain";
import { VisualEffect, VisualEffectAnchor } from "./VisualEffect";
import { RandomSource } from "./abilityRules";
import { FlightOrigin } from "./projectileMath";

export type ScheduledVisualEffect = {
    readonly hitEffect: HitEffect;
    readonly anchor: VisualEffectAnchor;
    readonly startsAt: number;
};

// What the modules acting on the world between its own updates (encounter runtimes, the player's
// orders, cast resolution) may touch. GameWorld is the one implementation, so the projectile cap,
// the visual effect budget and the shared actor ids stay enforced in one place.
export interface WorldContext {
    readonly timeSeconds: number;
    readonly terrain: Terrain;
    readonly random: RandomSource;
    readonly animations: EncounterAnimations;
    readonly events: CombatEvent[];
    readonly player?: Player;
    readonly enemies: readonly Enemy[];
    encounterActors: EncounterActor[];
    groundItems: GroundItem[];
    readonly visualEffects: VisualEffect[];
    readonly pendingVisualEffects: ScheduledVisualEffect[];
    readonly visualEffectBudget: number;

    combatants(): Combatant[];
    findEnemy(id: number): Enemy | undefined;
    findEnergySiphon(id: number): EnergySiphonActor | undefined;
    findGroundItem(id: number): GroundItem | undefined;
    allocateActorId(): number;
    spawnEnemy(
        x: number,
        y: number,
        level: number,
        enemyType: ResolvedEnemyType,
        statsOverride?: EnemyStatsOverride,
    ): number;
    spawnEnemyAtExactPosition(
        x: number,
        y: number,
        level: number,
        enemyType: ResolvedEnemyType,
    ): number;
    launchProjectile(
        spec: ProjectileSpec,
        impact: ProjectileImpact,
        start: FlightOrigin,
        target: ProjectileTarget,
    ): void;
    pushVisualEffect(effect: VisualEffect): void;
    dropGroundItem(drop: Omit<GroundItem, "id">): void;
    grantPlayerExperience(amount: Experience): void;
    clearBattlefield(): void;
    spawnVisualEffect(hitEffect: HitEffect, anchor: VisualEffectAnchor, holdSeconds?: number): void;
}
