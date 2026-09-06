import { AbilityDefinition } from "./Ability";
import {
    ENEMY_MELEE,
    KET_ZEK_GROUND_STRIKE,
    TOK_XIL_GROUND_STRIKE,
    YT_MEJKOT_HEAL_PULSE,
    YT_MEJKOT_MELEE,
} from "./abilities";

export enum EnemyTypeId {
    GOBLIN = "goblin",
    TZ_KIH = "tz_kih",
    TZ_KEK = "tz_kek",
    TOK_XIL = "tok_xil",
    YT_MEJKOT = "yt_mejkot",
    KET_ZEK = "ket_zek",
}

export enum EnemyBehaviour {
    // Chases the player directly and attacks once in melee reach, e.g. a basic melee attack.
    RUSHER = "rusher",
    // Keeps a preferred distance band from the player: backs away when closer than the band,
    // approaches when farther, and only attacks while inside it.
    KITER = "kiter",
    // Same distance-band behaviour as KITER, but slower and with a longer telegraphed cast.
    CASTER = "caster",
    // A RUSHER that also periodically pulses a heal to nearby allies.
    TANK = "tank",
}

export type EngagementBand = {
    // Distance below which a KITER/CASTER retreats instead of attacking.
    readonly minRange: number;
};

type EnemyTypeCommon = {
    readonly id: EnemyTypeId;
    readonly npcTypeId: number;
    readonly idleSeqId: number;
    readonly walkSeqId: number;
    readonly deathSeqId: number;
    readonly attackSeqId: number;
    // Overrides attackSeqId for the wind-up animation, for casters whose cast reads as visually
    // distinct from their basic attack pose.
    readonly castSeqId?: number;
    readonly hitRadius: number;
    readonly maxHealth: number;
    readonly walkSpeed: number;
    readonly abilities: readonly AbilityDefinition[];
};

export type EnemyType =
    | (EnemyTypeCommon & { readonly behaviour: EnemyBehaviour.RUSHER | EnemyBehaviour.TANK })
    | (EnemyTypeCommon & {
          readonly behaviour: EnemyBehaviour.KITER | EnemyBehaviour.CASTER;
          readonly engagement: EngagementBand;
      });

export type EnemyStatsOverride = {
    readonly healthMultiplier?: number;
    readonly speedMultiplier?: number;
};

export type EnemyStats = {
    readonly maxHealth: number;
    readonly walkSpeed: number;
};

export function resolveEnemyStats(type: EnemyType, override?: EnemyStatsOverride): EnemyStats {
    return {
        maxHealth: Math.round(type.maxHealth * (override?.healthMultiplier ?? 1)),
        walkSpeed: type.walkSpeed * (override?.speedMultiplier ?? 1),
    };
}

export function isBandedEnemyType(
    type: EnemyType,
): type is Extract<EnemyType, { engagement: EngagementBand }> {
    return type.behaviour === EnemyBehaviour.KITER || type.behaviour === EnemyBehaviour.CASTER;
}

const GOBLIN: EnemyType = {
    id: EnemyTypeId.GOBLIN,
    npcTypeId: 3029,
    idleSeqId: 6181,
    walkSeqId: 6180,
    deathSeqId: 6182,
    attackSeqId: 6183,
    hitRadius: 64,
    maxHealth: 20,
    walkSpeed: 320 * 1.6,
    behaviour: EnemyBehaviour.RUSHER,
    abilities: [ENEMY_MELEE],
};

const TZ_KIH: EnemyType = {
    id: EnemyTypeId.TZ_KIH,
    npcTypeId: 2189,
    idleSeqId: 2618,
    walkSeqId: 2619,
    deathSeqId: 2620,
    attackSeqId: 2621,
    hitRadius: 64,
    maxHealth: 8,
    walkSpeed: 480 * 1.6,
    behaviour: EnemyBehaviour.RUSHER,
    abilities: [ENEMY_MELEE],
};

// Tz-Kek (npc 2191/2192): a bulkier TzHaar that needs several hits or a special to bring down,
// used as the "tanky" mix-in for the Fight Caves wave table. idleSeqId/walkSeqId come straight off
// the npc type; deathSeqId/attackSeqId were picked from the same contiguous animation block by
// elimination (verified against the cache with a throwaway script, since checked in).
const TZ_KEK: EnemyType = {
    id: EnemyTypeId.TZ_KEK,
    npcTypeId: 2191,
    idleSeqId: 2624,
    walkSeqId: 2623,
    deathSeqId: 2625,
    attackSeqId: 2626,
    hitRadius: 96,
    maxHealth: 60,
    walkSpeed: 288 * 1.6,
    behaviour: EnemyBehaviour.RUSHER,
    abilities: [ENEMY_MELEE],
};

// Tok-Xil (npc 3121/3122, the Fight Caves ranger): idleSeqId/walkSeqId/size come straight off the
// npc type, verified against the cache with a throwaway script. deathSeqId/attackSeqId were picked
// from the same contiguous animation block by elimination (2633/2635; 2634 is Yt-MejKot's own
// walkSeqId, so it can't be Tok-Xil's), same method as Tz-Kek above but lower confidence since the
// block isn't as clean here. hitRadius follows the existing size-to-radius fit (32 + 32 * size).
const TOK_XIL: EnemyType = {
    id: EnemyTypeId.TOK_XIL,
    npcTypeId: 3121,
    idleSeqId: 2631,
    walkSeqId: 2632,
    deathSeqId: 2630,
    attackSeqId: 2633,
    hitRadius: 128,
    maxHealth: 150,
    walkSpeed: 576 * 1.6 * 0.6,
    behaviour: EnemyBehaviour.KITER,
    engagement: { minRange: 8 * 128 },
    abilities: [TOK_XIL_GROUND_STRIKE],
};

// Yt-MejKot (npc 3123/3124, the Fight Caves healer): idleSeqId/walkSeqId/size verified against the
// cache with a throwaway script. deathSeqId/attackSeqId picked by the same elimination method,
// from the block immediately after its idle seq (2637/2638); medium confidence.
const YT_MEJKOT: EnemyType = {
    id: EnemyTypeId.YT_MEJKOT,
    npcTypeId: 3123,
    idleSeqId: 2636,
    walkSeqId: 2634,
    deathSeqId: 2637,
    attackSeqId: 2638,
    hitRadius: 160,
    maxHealth: 360,
    walkSpeed: 576 * 1.6 * 0.45,
    behaviour: EnemyBehaviour.TANK,
    abilities: [YT_MEJKOT_HEAL_PULSE, YT_MEJKOT_MELEE],
};

// Ket-Zek (npc 3125/3126, the Fight Caves mage): idleSeqId/walkSeqId/size verified against the
// cache with a throwaway script. deathSeqId/attackSeqId picked by the same elimination method,
// from the block immediately after its walk seq (2644/2645); medium confidence. castSeqId reuses
// the same slot as attackSeqId since there's no separately identified cast animation.
const KET_ZEK: EnemyType = {
    id: EnemyTypeId.KET_ZEK,
    npcTypeId: 3125,
    idleSeqId: 2642,
    walkSeqId: 2643,
    deathSeqId: 2646,
    attackSeqId: 2644,
    hitRadius: 192,
    maxHealth: 280,
    walkSpeed: 576 * 1.6 * 0.4,
    behaviour: EnemyBehaviour.CASTER,
    engagement: { minRange: 6 * 128 },
    abilities: [KET_ZEK_GROUND_STRIKE],
};

export const ENEMY_TYPES: Readonly<Record<EnemyTypeId, EnemyType>> = {
    [EnemyTypeId.GOBLIN]: GOBLIN,
    [EnemyTypeId.TZ_KIH]: TZ_KIH,
    [EnemyTypeId.TZ_KEK]: TZ_KEK,
    [EnemyTypeId.TOK_XIL]: TOK_XIL,
    [EnemyTypeId.YT_MEJKOT]: YT_MEJKOT,
    [EnemyTypeId.KET_ZEK]: KET_ZEK,
};

export function getEnemyType(id: EnemyTypeId): EnemyType {
    return ENEMY_TYPES[id];
}
