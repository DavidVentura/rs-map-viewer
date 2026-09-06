import { clamp } from "../../util/MathUtil";
import { Combatant, Faction } from "./Combatant";

export const TILE_SIZE = 128;

export type PendingGroundStrike = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
    readonly radius: number;
    readonly startSeconds: number;
    readonly strikeAtSeconds: number;
    readonly damageMin: number;
    readonly damageMax: number;
    readonly sourceFaction: Faction;
    readonly caster: Combatant;
};

export function combatantsHitByGroundStrike<T extends Combatant>(
    strike: Pick<PendingGroundStrike, "x" | "y" | "level" | "radius" | "sourceFaction">,
    combatants: readonly T[],
): T[] {
    return combatants.filter(
        (combatant) =>
            combatant.faction !== strike.sourceFaction &&
            combatant.level === strike.level &&
            combatant.health > 0 &&
            Math.hypot(combatant.x - strike.x, combatant.y - strike.y) <=
                strike.radius + combatant.hitRadius,
    );
}

export function groundStrikeProgress(
    strike: Pick<PendingGroundStrike, "startSeconds" | "strikeAtSeconds">,
    timeSeconds: number,
): number {
    const totalSeconds = strike.strikeAtSeconds - strike.startSeconds;
    if (totalSeconds <= 0) {
        return 1;
    }
    return clamp((timeSeconds - strike.startSeconds) / totalSeconds, 0, 1);
}
