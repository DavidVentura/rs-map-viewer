import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";
import { Combatant } from "./Combatant";

export enum VisualEffectKind {
    MAGIC_HIT = 0,
    ICE_BARRAGE_HIT = 1,
    JAD_FIRE_HIT = 2,
    TZHAAR_HEAL = 3,
    DUST_WAVE = 4,
    MAUL_IMPACT_SPARK = 5,
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
        seqId: number,
        private readonly holdUntilSeconds?: number,
    ) {
        this.animation = new AnimationState(seqId);
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

    update(
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        timeSeconds: number,
    ): boolean {
        const completed = this.animation.advance(
            deltaTimeSeconds,
            seqTypeLoader,
            seqFrameLoader,
            AnimationPlayback.ONCE,
        );
        if (this.holdUntilSeconds === undefined) {
            return !completed;
        }
        return timeSeconds < this.holdUntilSeconds;
    }
}
