import { CasterEffectPlacement } from "./Ability";
import { AnimationPlayback, AnimationState, SeqTiming } from "./Animation";
import { Combatant } from "./Combatant";
import { rotationToDirection } from "./projectileMath";

export enum VisualEffectKind {
    MAGIC_HIT = 0,
    ICE_BARRAGE_HIT = 1,
    JAD_FIRE_HIT = 2,
    TZHAAR_HEAL = 3,
    DUST_WAVE = 4,
    MAUL_IMPACT_SPARK = 5,
    FALLING_SHADOW = 6,
    CRYSTAL_HALBERD_SPECIAL = 7,
    WARPED_SCEPTRE_IMPACT = 8,
    SWAMP_TRIDENT_IMPACT = 9,
    TUMEKENS_SHADOW_IMPACT = 10,
    ARROW_LAUNCH = 12,
    CRYSTAL_ARROW_LAUNCH = 13,
    SWAMP_TRIDENT_CAST = 14,
    TUMEKENS_SHADOW_CAST = 15,
    FIRE_BOLT_CAST = 16,
    WARDENS_LIGHTNING = 17,
    WARDENS_LIGHTNING_WARNING = 18,
    ZEBAK_PHANTOM_MAGIC_IMPACT = 20,
    ZEBAK_PHANTOM_RANGED_IMPACT = 21,
    BABA_ROCK_FALL = 22,
}

export const ICE_BARRAGE_HIT_SEQ_ID = 1965;
export const TZHAAR_HEAL_SEQ_ID = 2640;
// Zebak's roar dust wave (SpotAnimType id 2184), a ground-level puff that reads as any heavy
// impact's dust; OSRS plays the elder maul's own special graphic (2804) on the player, not the
// ground, so the smash borrows this one instead.
export const DUST_WAVE_SEQ_ID = 9647;
// Elder maul special ground impact (SpotAnimType 2805): the spark alternative to the dust wave
// for the smash's per-tile impact.
export const MAUL_IMPACT_SPARK_SEQ_ID = 11126;
// Grotesque Guardians' falling debris shadow (SpotAnimType id 1446): a growing ground disc that
// telegraphs a delayed fall. Its own 1.8s duration is the closest of the 1446/1447/2776 candidates
// to Jad's 1.6s rock fall (see JAD_RANGED_ROCK_SPEC's landing.telegraph).
export const FALLING_SHADOW_SEQ_ID = 7816;

// The crystal halberd special's own weapon-trail graphic (SpotAnimType 1232,
// DRAGON_HALBERD_SPECIAL_SOUTH_WHITE, sequence 1204), played on the caster rather than at a
// target/landing point (see AbilityEffect.casterEffect). OSRS bakes one variant per facing
// (SOUTH/NORTH/EAST/WEST, ids 1232-1235) since it never rotates spotanims; verified with
// render-gfx that the four are exact vertex-for-vertex rotations of one another about the model's
// own origin (rotate90/rotate180/rotate270 of the SOUTH mesh reproduce WEST/NORTH/EAST exactly), so
// this project's renderer keeps only the SOUTH bake and rotates it to the caster's own facing
// instead (see VisualEffect.rotation), captured once when the cast begins rather than tracked live.
export const CRYSTAL_HALBERD_SPECIAL_SEQ_ID = 1204;
// Warped sceptre impact (SpotAnimType 2568, VFX_WARPED_SCEPTRE_PROJECTILE_IMPACT).
export const WARPED_SCEPTRE_IMPACT_SEQ_ID = 9943;
// Trident of the swamp impact (SpotAnimType 1042, TOXIC_TOTS_IMPACT).
export const SWAMP_TRIDENT_IMPACT_SEQ_ID = 5461;
// Tumeken's shadow impact (SpotAnimType 2127, TUMEKENS_SHADOW_IMPACT).
export const TUMEKENS_SHADOW_IMPACT_SEQ_ID = 664;

// The generic bow release (SpotAnimType 19, BRONZE_ARROW_LAUNCH): the puff at the bow every arrow
// tier fires with in OSRS, reused here since the game always flies the bronze arrow model
// regardless of the equipped tier (see ActorAssets.ARROW_OBJ_ID).
export const ARROW_LAUNCH_SEQ_ID = 366;
// Trident of the swamp's own cast graphic (SpotAnimType 665, TOXIC_TOTS_CASTING), played on the
// caster rather than the projectile's travel/impact graphics.
export const SWAMP_TRIDENT_CAST_SEQ_ID = 5460;
// Tumeken's shadow's own cast graphic (SpotAnimType 2125, TUMEKENS_SHADOW_CASTING).
export const TUMEKENS_SHADOW_CAST_SEQ_ID = 9543;
// The tier-0 staff's fire bolt cast graphic (SpotAnimType 126, FIREBOLT_CASTING) - not to be
// confused with FIRE_BOLT_TRAVEL_SEQ_ID/FIRE_BOLT_HIT_SEQ_ID (Projectile.ts), the bolt itself.
export const FIRE_BOLT_CAST_SEQ_ID = 658;
export const WARDENS_LIGHTNING_SEQ_ID = 8680;
// The bursts Zebak's jug and rock break into on landing (SpotAnimType 2186 ZEBAK_MAGE_SPLIT and 2185
// ZEBAK_RANGED_SPLIT).
export const ZEBAK_PHANTOM_MAGIC_IMPACT_SEQ_ID = 9638;
export const ZEBAK_PHANTOM_RANGED_IMPACT_SEQ_ID = 9641;
// Ba-Ba's falling rock (SpotAnimType 2252, TOA_BABA_ROCK_FALL_FASTEST): dust trickles down, the rock
// falls and shatters on the floor, all within the graphic's own frames.
export const BABA_ROCK_FALL_SEQ_ID = 9806;

// A weapon-trail graphic authored frame for frame against its cast animation (the same frame count,
// e.g. the halberd sweep 1204 against the halberd special 1203) plays on the cast's own frame
// timings: the two sequences' tick lengths differ, so timing each by its own ticks drifts the trail
// away from the weapon over the swing.
export function casterEffectTiming(effectSeq: SeqTiming, castSeq: SeqTiming): SeqTiming {
    if (effectSeq.frameTicks.length !== castSeq.frameTicks.length) {
        return effectSeq;
    }
    return { seqId: effectSeq.seqId, frameTicks: castSeq.frameTicks };
}

// A COMBATANT anchor reads the combatant's current position whenever the effect is drawn, so an
// impact or buff graphic stays on a moving body instead of freezing where it was spawned. A POINT
// anchor carries its own facing.
export type VisualEffectAnchor =
    | {
          readonly kind: "POINT";
          readonly x: number;
          readonly y: number;
          readonly level: number;
          readonly rotation: number;
      }
    | { readonly kind: "COMBATANT"; readonly combatant: Combatant };

// Where a caster effect plays for a caster facing its current rotation (see CasterEffectPlacement).
export function casterEffectAnchor(
    caster: Combatant,
    placement: CasterEffectPlacement,
): VisualEffectAnchor {
    switch (placement.kind) {
        case "ON_CASTER":
            return { kind: "COMBATANT", combatant: caster };
        case "AHEAD": {
            const facing = rotationToDirection(caster.rotation);
            return {
                kind: "POINT",
                x: caster.x + facing.x * placement.distance,
                y: caster.y + facing.y * placement.distance,
                level: caster.level,
                rotation: caster.rotation,
            };
        }
    }
}

export class VisualEffect {
    readonly animation: AnimationState;
    // Captured once here rather than read live off the anchor: OSRS commits an actor to one facing
    // for a weapon-trail's whole playback, but this project's own combatant.rotation keeps changing
    // as its owner moves or turns to a new aim, and a caster-anchored effect can still be playing a
    // second or more after it was cast (see CRYSTAL_HALBERD_SPECIAL,
    // ~1s at CLEAVE/SCYTHE_SWEEP's own castSpeed). Reading combatant.rotation live therefore made
    // the effect visibly swing away from the direction it was actually cast in as soon as its
    // caster moved. Position still tracks the anchor live (see x/y below) - only facing is frozen.
    readonly rotation: number;

    constructor(
        readonly kind: VisualEffectKind,
        private readonly anchor: VisualEffectAnchor,
        readonly height: number,
        seq: SeqTiming,
        private readonly holdUntilSeconds?: number,
        // A caster-anchored effect plays at its ability's own castSpeed (see
        // AbilityDefinition.castSpeed), so the graphic keeps pace with whatever speed the cast
        // animation itself plays at, instead of always running at the sequence's natural speed.
        private readonly speed: number = 1,
    ) {
        this.animation = new AnimationState(seq);
        this.rotation = anchor.kind === "COMBATANT" ? anchor.combatant.rotation : anchor.rotation;
    }

    get x(): number {
        return this.anchor.kind === "COMBATANT" ? this.anchor.combatant.x : this.anchor.x;
    }

    get y(): number {
        return this.anchor.kind === "COMBATANT" ? this.anchor.combatant.y : this.anchor.y;
    }

    get level(): number {
        return this.anchor.kind === "COMBATANT" ? this.anchor.combatant.level : this.anchor.level;
    }

    update(deltaTimeSeconds: number, timeSeconds: number): boolean {
        const completed = this.animation.advance(
            deltaTimeSeconds,
            AnimationPlayback.ONCE,
            this.speed,
        );
        if (this.holdUntilSeconds === undefined) {
            return !completed;
        }
        return timeSeconds < this.holdUntilSeconds;
    }
}
