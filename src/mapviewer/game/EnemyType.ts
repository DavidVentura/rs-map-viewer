import { AbilityDefinition } from "./Ability";
import {
    ENEMY_MELEE,
    JAD_MAGE_BLAST,
    JAD_MELEE_BITE,
    JAD_MELEE_BITE_CAST_SEQ_ID,
    JAD_RANGED_STOMP,
    KET_ZEK_FIRE_BLAST,
    TOK_XIL_RANGED_SHOT,
    YT_HURKOT_HEAL_PULSE,
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
    TZTOK_JAD = "tztok_jad",
    YT_HURKOT = "yt_hurkot",
    // Built at runtime by the animation viewer (see AnimPreview.ts), never present in ENEMY_TYPES.
    PREVIEW = "preview",
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
    // Holds close to the player (approaching only past the leash range, never retreating) and
    // cycles a fixed attack pattern in order rather than picking the first ready ability.
    BOSS = "boss",
}

export type EngagementBand = {
    // Distance below which a KITER/CASTER retreats instead of attacking.
    readonly minRange: number;
};

// A boss stops approaching once within leashRangeTiles of the player (see computeKeepDistanceMovement
// with minRange 0), so it never retreats, unlike a KITER/CASTER's engagement band.
export type BossEngagement = {
    readonly leashRangeTiles: number;
};

// Triggers once, the first time the boss's health fraction drops to or below healthFraction.
export type BossPhaseAdds = {
    readonly enemyTypeId: EnemyTypeId;
    readonly count: number;
    readonly offsetTiles: number;
};

export type BossPhase = {
    readonly healthFraction: number;
    readonly label: string;
    readonly spawnAdds: BossPhaseAdds;
};

// How likely this enemy type is to drop an equipment upgrade on death (see GameWorld's death
// hook and GroundItem.rollDrop): chaff almost never drops, elites drop often, a boss always drops.
export enum DropTier {
    NONE = "none",
    CHAFF = "chaff",
    ELITE = "elite",
    BOSS = "boss",
}

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
    readonly phases?: readonly BossPhase[];
    readonly dropTier: DropTier;
};

export type EnemyType =
    | (EnemyTypeCommon & { readonly behaviour: EnemyBehaviour.RUSHER | EnemyBehaviour.TANK })
    | (EnemyTypeCommon & {
          readonly behaviour: EnemyBehaviour.KITER | EnemyBehaviour.CASTER;
          readonly engagement: EngagementBand;
      })
    | (EnemyTypeCommon & {
          readonly behaviour: EnemyBehaviour.BOSS;
          readonly engagement: BossEngagement;
          readonly pattern: readonly AbilityDefinition[];
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

export function isBossEnemyType(
    type: EnemyType,
): type is Extract<EnemyType, { behaviour: EnemyBehaviour.BOSS }> {
    return type.behaviour === EnemyBehaviour.BOSS;
}

// Returns the index of the first not-yet-triggered phase whose threshold the current health
// fraction has crossed, or undefined if none has. Only ever returns one index per call so a boss
// with several phases triggers them one at a time across successive ticks, even if a single hit
// drops health past more than one threshold at once.
export function resolveTriggeredBossPhase(
    phases: readonly BossPhase[] | undefined,
    health: number,
    maxHealth: number,
    alreadyTriggered: ReadonlySet<number>,
): number | undefined {
    if (!phases || maxHealth <= 0) {
        return undefined;
    }
    const healthFraction = health / maxHealth;
    for (let index = 0; index < phases.length; index++) {
        if (alreadyTriggered.has(index)) {
            continue;
        }
        if (healthFraction <= phases[index].healthFraction) {
            return index;
        }
    }
    return undefined;
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
    dropTier: DropTier.CHAFF,
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
    dropTier: DropTier.CHAFF,
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
    deathSeqId: 2627,
    attackSeqId: 2625,
    hitRadius: 96,
    maxHealth: 60,
    walkSpeed: 288 * 1.6,
    behaviour: EnemyBehaviour.RUSHER,
    abilities: [ENEMY_MELEE],
    dropTier: DropTier.ELITE,
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
    castSeqId: 2633,
    attackSeqId: 2628,
    hitRadius: 128,
    maxHealth: 150,
    walkSpeed: 576 * 1.6 * 0.6,
    behaviour: EnemyBehaviour.KITER,
    engagement: { minRange: 8 * 128 },
    abilities: [TOK_XIL_RANGED_SHOT],
    dropTier: DropTier.ELITE,
};

// Yt-MejKot (npc 3123/3124, the Fight Caves healer): idleSeqId/walkSeqId/size verified against the
// cache with a throwaway script. deathSeqId/attackSeqId picked by the same elimination method,
// from the block immediately after its idle seq (2637/2638); medium confidence.
const YT_MEJKOT: EnemyType = {
    id: EnemyTypeId.YT_MEJKOT,
    npcTypeId: 3123,
    idleSeqId: 2636,
    walkSeqId: 2634,
    deathSeqId: 2638,
    attackSeqId: 2637,
    hitRadius: 160,
    maxHealth: 360,
    walkSpeed: 576 * 1.6 * 0.45,
    behaviour: EnemyBehaviour.TANK,
    abilities: [YT_MEJKOT_HEAL_PULSE, YT_MEJKOT_MELEE],
    dropTier: DropTier.ELITE,
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
    castSeqId: 2647,
    attackSeqId: 2644,
    hitRadius: 192,
    maxHealth: 280,
    walkSpeed: 576 * 1.6 * 0.4,
    behaviour: EnemyBehaviour.CASTER,
    engagement: { minRange: 6 * 128 },
    abilities: [KET_ZEK_FIRE_BLAST],
    dropTier: DropTier.ELITE,
};

// Yt-HurKot (npc 3128, TzTok-Jad's healer adds): idleSeqId/walkSeqId/size verified against the
// cache with a throwaway script, and turn out identical to Yt-MejKot's (2636/2634) - this is the
// same rig reused for the weaker healer that accompanies Jad. deathSeqId/attackSeqId/heal cast seq
// are assumed shared with Yt-MejKot on the strength of that exact idle/walk match rather than
// independently re-verified. hitRadius follows the existing size-to-radius fit (32 + 32 * size).
const YT_HURKOT: EnemyType = {
    id: EnemyTypeId.YT_HURKOT,
    npcTypeId: 3128,
    idleSeqId: 2636,
    walkSeqId: 2634,
    deathSeqId: 2638,
    attackSeqId: 2637,
    hitRadius: 64,
    maxHealth: 80,
    walkSpeed: 576 * 1.6 * 0.45,
    behaviour: EnemyBehaviour.TANK,
    abilities: [YT_HURKOT_HEAL_PULSE, YT_MEJKOT_MELEE],
    dropTier: DropTier.NONE,
};

// TzTok-Jad (npc 3127): idleSeqId/walkSeqId/size verified directly against the cache with a
// throwaway script (idle 2650, walk 2651, size 5, so hitRadius follows the usual 32 + 32 * size
// fit). deathSeqId/attack seqIds were picked from the same block by the forcedPriority fingerprint:
// 2654 (forcedPriority 10, priority -1, ~3.5s total duration - long and held, unlike anything else
// in the block) is the death. 2652/2655/2656 all share a forcedPriority 10 / priority 2 signature
// distinct from their forcedPriority-5 neighbours, so they're taken to be Jad's three attacks;
// assigned to melee/range/mage in order of increasing frame count (12/14/31 frames), on the
// assumption that the mage cast (a mouth-glow build-up) is the most elaborate of the three. Medium
// confidence only - not visually confirmed through the animation viewer.
const TZTOK_JAD_PATTERN: readonly AbilityDefinition[] = [
    JAD_MELEE_BITE,
    JAD_RANGED_STOMP,
    JAD_MAGE_BLAST,
];

const TZTOK_JAD: EnemyType = {
    id: EnemyTypeId.TZTOK_JAD,
    npcTypeId: 3127,
    idleSeqId: 2650,
    walkSeqId: 2651,
    deathSeqId: 2654,
    attackSeqId: JAD_MELEE_BITE_CAST_SEQ_ID,
    hitRadius: 192,
    maxHealth: 1200,
    walkSpeed: 576 * 1.6 * 0.3,
    behaviour: EnemyBehaviour.BOSS,
    engagement: { leashRangeTiles: 6 },
    pattern: TZTOK_JAD_PATTERN,
    abilities: TZTOK_JAD_PATTERN,
    dropTier: DropTier.BOSS,
    phases: [
        {
            healthFraction: 0.5,
            label: "Healers",
            spawnAdds: { enemyTypeId: EnemyTypeId.YT_HURKOT, count: 2, offsetTiles: 2 },
        },
    ],
};

export const ENEMY_TYPES: Readonly<Partial<Record<EnemyTypeId, EnemyType>>> = {
    [EnemyTypeId.GOBLIN]: GOBLIN,
    [EnemyTypeId.TZ_KIH]: TZ_KIH,
    [EnemyTypeId.TZ_KEK]: TZ_KEK,
    [EnemyTypeId.TOK_XIL]: TOK_XIL,
    [EnemyTypeId.YT_MEJKOT]: YT_MEJKOT,
    [EnemyTypeId.KET_ZEK]: KET_ZEK,
    [EnemyTypeId.TZTOK_JAD]: TZTOK_JAD,
    [EnemyTypeId.YT_HURKOT]: YT_HURKOT,
};

export function getEnemyType(id: EnemyTypeId): EnemyType {
    const type = ENEMY_TYPES[id];
    if (!type) {
        throw new Error(`No static enemy type registered for ${id}`);
    }
    return type;
}
