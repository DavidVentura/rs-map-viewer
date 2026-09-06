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

export type DamageSplatEvent = {
    amount: number;
    factionHit: Faction;
    worldX: number;
    worldY: number;
    groundHeight: number;
};

export type HudFrame = {
    viewProjMatrix: mat4;
    screenSize: ScreenSize;
    player?: PlayerHudInfo;
    target?: TargetHudInfo;
    damageEvents: DamageSplatEvent[];
};
