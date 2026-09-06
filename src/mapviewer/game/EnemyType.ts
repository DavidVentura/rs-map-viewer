export enum EnemyTypeId {
    GOBLIN = "goblin",
    TZ_KIH = "tz_kih",
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

const GOBLIN: EnemyType = {
    id: EnemyTypeId.GOBLIN,
    npcTypeId: 3029,
    idleSeqId: 6181,
    walkSeqId: 6180,
    deathSeqId: 6182,
    attackSeqId: 6183,
    hitRadius: 64,
    maxHealth: 20,
    walkSpeed: 576 * 1.6,
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
    walkSpeed: 576 * 1.6,
};

export const ENEMY_TYPES: Readonly<Record<EnemyTypeId, EnemyType>> = {
    [EnemyTypeId.GOBLIN]: GOBLIN,
    [EnemyTypeId.TZ_KIH]: TZ_KIH,
};

export function getEnemyType(id: EnemyTypeId): EnemyType {
    return ENEMY_TYPES[id];
}
