export enum Faction {
    PLAYER = 0,
    ENEMY = 1,
}

export interface Combatant {
    x: number;
    y: number;
    readonly level: number;
    readonly faction: Faction;
    readonly hitRadius: number;
    health: number;
    readonly maxHealth: number;
}

export interface ManaPool {
    mana: number;
    readonly maxMana: number;
}
