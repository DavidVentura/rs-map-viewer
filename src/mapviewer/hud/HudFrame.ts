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
    GROUND_IMPACT = 3,
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

export type GroundImpactSplatEvent = SplatPosition & {
    kind: SplatKind.GROUND_IMPACT;
    radius: number;
};

export type SplatEvent = DamageSplatEvent | HealSplatEvent | GroundImpactSplatEvent;

export type GroundShadowHudInfo = {
    readonly screenX: number;
    readonly screenY: number;
    readonly radiusPx: number;
    readonly progress: number;
};

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

export enum WaveStatus {
    ACTIVE = 0,
    AWAITING_UPGRADE = 1,
    CLEARED = 2,
}

export type WaveHudInfo = {
    readonly index: number;
    readonly total: number;
    readonly aliveEnemies: number;
    readonly status: WaveStatus;
    readonly modifiersSummary?: string;
};

export type UpgradeCardHudInfo = {
    readonly name: string;
    readonly description: string;
    readonly keyLabel: string;
};

export type UpgradeOfferHudInfo = {
    readonly cards: readonly UpgradeCardHudInfo[];
};

export type BossHudInfo = {
    readonly name: string;
    readonly health: number;
    readonly maxHealth: number;
    readonly phaseLabel?: string;
};

// A dropped equipment upgrade lying on the ground: always-visible Diablo-style floor label,
// projected to screen space by the renderer (see WebGLMapViewerRenderer.buildGroundItemHudInfos).
export type GroundItemHudInfo = {
    readonly groundItemId: number;
    readonly screenX: number;
    readonly screenY: number;
    readonly name: string;
    readonly pathLabel: string;
};

// A transient "Equipped: <name>" banner shown for a couple of seconds after a pickup; fixed to the
// screen rather than projected from a world position, so it's tracked separately from SplatEvent.
export type PickupFlashEvent = {
    readonly text: string;
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
    groundShadows: GroundShadowHudInfo[];
    wave?: WaveHudInfo;
    upgradeOffer?: UpgradeOfferHudInfo;
    previewSeqId?: number;
    boss?: BossHudInfo;
    groundItems: GroundItemHudInfo[];
    pickupFlashEvents: PickupFlashEvent[];
};
