import { mat4 } from "gl-matrix";

import { Faction } from "../game/Combatant";

export type ScreenSize = {
    width: number;
    height: number;
};

export type PlayerHudInfo = {
    health: number;
    maxHealth: number;
    mana: number;
    maxMana: number;
};

export type TargetHudInfo = {
    name: string;
    combatLevel: number;
    health: number;
    maxHealth: number;
};

export enum SplatKind {
    DAMAGE = 0,
    HEAL = 1,
}

export type SplatEvent = {
    kind: SplatKind;
    amount: number;
    factionHit: Faction;
    worldX: number;
    worldY: number;
    groundHeight: number;
};

export enum AbilitySlotBlockReason {
    NONE = 0,
    MANA = 1,
    COOLDOWN = 2,
    ACTIVE = 3,
}

export type AbilityCharges = {
    current: number;
    max: number;
};

export type AbilitySlotHudInfo = {
    name: string;
    keyLabel: string;
    cooldownFraction: number;
    charges?: AbilityCharges;
    blocked: AbilitySlotBlockReason;
    isActiveStance: boolean;
};

export type HudFrame = {
    viewProjMatrix: mat4;
    screenSize: ScreenSize;
    player?: PlayerHudInfo;
    target?: TargetHudInfo;
    abilities: AbilitySlotHudInfo[];
    stanceName?: string;
    splatEvents: SplatEvent[];
};
