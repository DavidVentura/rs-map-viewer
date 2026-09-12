import { AnimationPlayback, AnimationState, SeqTiming } from "./Animation";
import { Combatant } from "./Combatant";

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
// (SOUTH/NORTH/EAST/WEST) since it never rotates spotanims; this project's renderer can rotate any
// spotanim freely, so only the SOUTH bake is kept and rotated to the caster's own facing at draw
// time (see VisualEffect.rotation) instead.
export const CRYSTAL_HALBERD_SPECIAL_SEQ_ID = 1204;
// Warped sceptre impact (SpotAnimType 2568, VFX_WARPED_SCEPTRE_PROJECTILE_IMPACT).
export const WARPED_SCEPTRE_IMPACT_SEQ_ID = 9943;
// Trident of the swamp impact (SpotAnimType 1042, TOXIC_TOTS_IMPACT).
export const SWAMP_TRIDENT_IMPACT_SEQ_ID = 5461;
// Tumeken's shadow impact (SpotAnimType 2127, TUMEKENS_SHADOW_IMPACT).
export const TUMEKENS_SHADOW_IMPACT_SEQ_ID = 664;

// A COMBATANT anchor reads the combatant's current position whenever the effect is drawn, so an
// impact or buff graphic stays on a moving body instead of freezing where it was spawned.
export type VisualEffectAnchor =
    | { readonly kind: "POINT"; readonly x: number; readonly y: number; readonly level: number }
    | { readonly kind: "COMBATANT"; readonly combatant: Combatant };

export class VisualEffect {
    readonly animation: AnimationState;

    constructor(
        readonly kind: VisualEffectKind,
        private readonly anchor: VisualEffectAnchor,
        readonly height: number,
        seq: SeqTiming,
        private readonly holdUntilSeconds?: number,
    ) {
        this.animation = new AnimationState(seq);
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

    // A combatant-anchored effect inherits its combatant's facing (harmless for the existing
    // radially-symmetric effects; needed for a directional one like CRYSTAL_HALBERD_SPECIAL). A
    // point-anchored effect has no facing of its own, so it stays unrotated.
    get rotation(): number {
        return this.anchor.kind === "COMBATANT" ? this.anchor.combatant.rotation : 0;
    }

    update(deltaTimeSeconds: number, timeSeconds: number): boolean {
        const completed = this.animation.advance(deltaTimeSeconds, AnimationPlayback.ONCE);
        if (this.holdUntilSeconds === undefined) {
            return !completed;
        }
        return timeSeconds < this.holdUntilSeconds;
    }
}
