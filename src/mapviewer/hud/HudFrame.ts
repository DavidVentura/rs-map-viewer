import { mat4 } from "gl-matrix";

import { WeaponStyle } from "../game/Ability";
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
    FROZEN = 2,
}

export type SplatPosition = {
    worldX: number;
    worldY: number;
    groundHeight: number;
};

export type DamageSplatEvent = SplatPosition & {
    kind: SplatKind.DAMAGE;
    amount: number;
    factionHit: Faction;
};

export type HealSplatEvent = SplatPosition & {
    kind: SplatKind.HEAL;
    amount: number;
};

export type FrozenSplatEvent = SplatPosition & {
    kind: SplatKind.FROZEN;
};

export type SplatEvent = DamageSplatEvent | HealSplatEvent | FrozenSplatEvent;

export enum AbilitySlotBlockReason {
    NONE = 0,
    MANA = 1,
    COOLDOWN = 2,
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
};

export type StyleSwitchHudInfo = {
    readonly target: WeaponStyle;
    readonly progress: number;
};

export type WaveHudInfo = {
    readonly index: number;
    readonly total: number;
    readonly aliveEnemies: number;
    readonly cleared: boolean;
};

export type HudFrame = {
    viewProjMatrix: mat4;
    screenSize: ScreenSize;
    player?: PlayerHudInfo;
    target?: TargetHudInfo;
    abilities: AbilitySlotHudInfo[];
    activeStyle?: WeaponStyle;
    styleSwitch?: StyleSwitchHudInfo;
    splatEvents: SplatEvent[];
    wave?: WaveHudInfo;
};
