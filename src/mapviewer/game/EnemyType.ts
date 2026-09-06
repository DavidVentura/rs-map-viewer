export enum EnemyTypeId {
    GOBLIN = "goblin",
    TZ_KIH = "tz_kih",
    TZ_KEK = "tz_kek",
}

export type EnemyType = {
    readonly id: EnemyTypeId;
    readonly npcTypeId: number;
    readonly idleSeqId: number;
    readonly walkSeqId: number;
    readonly deathSeqId: number;
    readonly attackSeqId: number;
    readonly hitRadius: number;
    readonly maxHealth: number;
    readonly walkSpeed: number;
};

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

const GOBLIN: EnemyType = {
    id: EnemyTypeId.GOBLIN,
    npcTypeId: 3029,
    idleSeqId: 6181,
    walkSeqId: 6180,
    deathSeqId: 6182,
    attackSeqId: 6183,
    hitRadius: 64,
    maxHealth: 20,
    walkSpeed: 460 * 1.6,
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
    walkSpeed: 380 * 1.6,
};

export const ENEMY_TYPES: Readonly<Record<EnemyTypeId, EnemyType>> = {
    [EnemyTypeId.GOBLIN]: GOBLIN,
    [EnemyTypeId.TZ_KIH]: TZ_KIH,
    [EnemyTypeId.TZ_KEK]: TZ_KEK,
};

export function getEnemyType(id: EnemyTypeId): EnemyType {
    return ENEMY_TYPES[id];
}
