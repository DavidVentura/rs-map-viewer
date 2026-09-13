import { mat4 } from "gl-matrix";

import { WeaponStyle } from "../game/Ability";
import { HitsplatSprites } from "../assets/HudAssets";
import { Combatant } from "../game/Combatant";
import { ClickCrossKind, CrossSprites } from "./ClickCross";
import { MenuEntry, OpenMenuState, Point } from "./contextMenu";

export type ScreenSize = {
    width: number;
    height: number;
};

export type PlayerHudInfo = {
    health: number;
    maxHealth: number;
    mana: number;
    maxMana: number;
    level: number;
    experience: number;
    levelStartExperience: number;
    nextLevelExperience: number;
};

export enum SplatKind {
    DAMAGE = 0,
    HEAL = 1,
}

// Where a combatant's splats sit this frame: halfway up its model, as OSRS sets its hitsplats.
export type SplatAnchor = {
    readonly worldX: number;
    readonly worldY: number;
    readonly height: number;
};

// A splat rides on its target (see HudFrame.splatAnchors) and goes with it when it despawns; the
// hitsplats on one target spread over its own slots (see Hitsplats.ts).
export type DamageSplatEvent = {
    kind: SplatKind.DAMAGE;
    amount: number;
    target: Combatant;
};

export type HealSplatEvent = {
    kind: SplatKind.HEAL;
    amount: number;
    target: Combatant;
};

export type SplatEvent = DamageSplatEvent | HealSplatEvent;

// What floats over an enemy's head: its health bar, with its protection prayer icon above that.
export type OverheadHudInfo = {
    readonly worldX: number;
    readonly worldY: number;
    readonly modelTopHeight: number;
    readonly health: number;
    readonly maxHealth: number;
    readonly prayerIcon: CanvasImageSource | undefined;
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

export enum PhaseStatus {
    READY = 0,
    ACTIVE = 1,
    REWARDS = 2,
    COMPLETE = 3,
}

export type PhaseHudInfo = {
    readonly index: number;
    readonly total: number;
    readonly label: string;
    readonly status: PhaseStatus;
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

// A transient "Equipped: <name>" banner shown for a couple of seconds after a pickup; fixed to the
// screen rather than projected from a world position, so it's tracked separately from SplatEvent.
export type PickupFlashEvent = {
    readonly text: string;
};

// The default (nearest) option under the cursor while the right-click menu is closed - see
// contextMenu.tooltipTextRuns for how it turns into "Pull Lever / 2 more options" text.
export type ContextMenuTooltipHudInfo = {
    readonly anchor: Point;
    readonly entries: readonly MenuEntry[];
};

// The click cross's resolved display state for this frame (see hud/ClickCross.ts) - undefined once
// its animation has finished.
export type ClickCrossHudInfo = {
    readonly kind: ClickCrossKind;
    readonly screenX: number;
    readonly screenY: number;
    readonly frameIndex: number;
};

export type HudFrame = {
    viewProjMatrix: mat4;
    screenSize: ScreenSize;
    player?: PlayerHudInfo;
    abilities: AbilitySlotHudInfo[];
    activeStyle?: WeaponStyle;
    godMode: boolean;
    splatEvents: SplatEvent[];
    splatAnchors: ReadonlyMap<Combatant, SplatAnchor>;
    overheads: OverheadHudInfo[];
    phase?: PhaseHudInfo;
    previewSeqId?: number;
    contextMenu?: OpenMenuState;
    contextMenuTooltip?: ContextMenuTooltipHudInfo;
    upgradeOffer?: UpgradeOfferHudInfo;
    pickupFlashEvents: PickupFlashEvent[];
    crossSprites: CrossSprites;
    hitsplatSprites: HitsplatSprites;
    clickCross?: ClickCrossHudInfo;
};
