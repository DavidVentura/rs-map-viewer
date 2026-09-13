import { clamp } from "../../util/MathUtil";
import { WeaponStyle } from "../game/Ability";
import { HitsplatSprites } from "../assets/HudAssets";
import { CrossSprites } from "./ClickCross";
import { HitsplatSlot } from "./Hitsplats";
import {
    MenuEntry,
    MenuTextRunRole,
    Point,
    Size,
    computeMenuLayout,
    computeTooltipLayout,
    menuEntryTextRuns,
} from "./contextMenu";
import {
    AbilitySlotBlockReason,
    AbilitySlotHudInfo,
    OverheadHudInfo,
    ClickCrossHudInfo,
    PhaseHudInfo,
    PhaseStatus,
    PlayerHudInfo,
    UpgradeCardHudInfo,
} from "./HudFrame";

const HEALTH_GLOBE_COLOR = { light: "#ff4a3a", dark: "#5a0606", glow: "#ff9a8a" };
const MANA_GLOBE_COLOR = { light: "#4a6cff", dark: "#0a1660", glow: "#9ab0ff" };

const PANEL_MAX_WIDTH = 880;
const PANEL_HEIGHT = 96;
const PANEL_BOTTOM_MARGIN = 0;
const GLOBE_RADIUS = 58;
const ABILITY_SLOT_SIZE = 56;
const ABILITY_SLOT_GAP = 8;
const STYLE_ICON_SIZE = 26;
const STYLE_ICON_GAP = 6;
const STYLE_ROW_MARGIN_BOTTOM = 6;
const EXPERIENCE_BAR_HEIGHT = 8;
const EXPERIENCE_BAR_GAP = 3;
const EXPERIENCE_BAR_SEGMENTS = 10;
const UPGRADE_CARD_WIDTH = 260;
const UPGRADE_CARD_HEIGHT = 300;
const UPGRADE_CARD_GAP = 24;

const STYLE_ORDER: readonly WeaponStyle[] = [
    WeaponStyle.MELEE,
    WeaponStyle.RANGED,
    WeaponStyle.MAGIC,
];

const STYLE_KEY_LABELS: Record<WeaponStyle, string> = {
    [WeaponStyle.MELEE]: "Q",
    [WeaponStyle.RANGED]: "W",
    [WeaponStyle.MAGIC]: "E",
};

export type HudLayout = {
    panelX: number;
    panelY: number;
    panelWidth: number;
    panelHeight: number;
    healthGlobe: { x: number; y: number; radius: number };
    manaGlobe: { x: number; y: number; radius: number };
    slots: { x: number; y: number; size: number }[];
    styleIcons: { x: number; y: number; size: number; style: WeaponStyle }[];
    experienceBar: { x: number; y: number; width: number; height: number };
    upgradeCards: { x: number; y: number; width: number; height: number }[];
};

export function computeHudLayout(
    width: number,
    height: number,
    slotCount: number,
    upgradeCardCount: number = 0,
): HudLayout {
    const panelWidth = Math.min(PANEL_MAX_WIDTH, width);
    const panelX = width / 2 - panelWidth / 2;
    const panelY = height - PANEL_BOTTOM_MARGIN - PANEL_HEIGHT;
    const globeY = height - PANEL_BOTTOM_MARGIN - GLOBE_RADIUS - 6;
    const slotsWidth =
        ABILITY_SLOT_SIZE * slotCount + ABILITY_SLOT_GAP * Math.max(0, slotCount - 1);
    const slotsX = width / 2 - slotsWidth / 2;
    const slotsY = panelY + PANEL_HEIGHT / 2 - ABILITY_SLOT_SIZE / 2;
    const styleIconsWidth =
        STYLE_ICON_SIZE * STYLE_ORDER.length + STYLE_ICON_GAP * (STYLE_ORDER.length - 1);
    const styleIconsX = width / 2 - styleIconsWidth / 2;
    const experienceBarX = panelX + GLOBE_RADIUS * 2 + EXPERIENCE_BAR_GAP;
    const experienceBarY = panelY - EXPERIENCE_BAR_GAP - EXPERIENCE_BAR_HEIGHT;
    const styleIconsY = experienceBarY - STYLE_ICON_SIZE - STYLE_ROW_MARGIN_BOTTOM;
    const upgradeCardsWidth =
        UPGRADE_CARD_WIDTH * upgradeCardCount +
        UPGRADE_CARD_GAP * Math.max(0, upgradeCardCount - 1);
    const upgradeCardsX = width / 2 - upgradeCardsWidth / 2;
    const upgradeCardsY = height / 2 - UPGRADE_CARD_HEIGHT / 2;
    return {
        panelX,
        panelY,
        panelWidth,
        panelHeight: PANEL_HEIGHT,
        healthGlobe: { x: panelX + GLOBE_RADIUS, y: globeY, radius: GLOBE_RADIUS },
        manaGlobe: { x: panelX + panelWidth - GLOBE_RADIUS, y: globeY, radius: GLOBE_RADIUS },
        slots: Array.from({ length: slotCount }, (_, i) => ({
            x: slotsX + i * (ABILITY_SLOT_SIZE + ABILITY_SLOT_GAP),
            y: slotsY,
            size: ABILITY_SLOT_SIZE,
        })),
        experienceBar: {
            x: experienceBarX,
            y: experienceBarY,
            width: panelWidth - (experienceBarX - panelX) * 2,
            height: EXPERIENCE_BAR_HEIGHT,
        },
        styleIcons: STYLE_ORDER.map((style, i) => ({
            x: styleIconsX + i * (STYLE_ICON_SIZE + STYLE_ICON_GAP),
            y: styleIconsY,
            size: STYLE_ICON_SIZE,
            style,
        })),
        upgradeCards: Array.from({ length: upgradeCardCount }, (_, i) => ({
            x: upgradeCardsX + i * (UPGRADE_CARD_WIDTH + UPGRADE_CARD_GAP),
            y: upgradeCardsY,
            width: UPGRADE_CARD_WIDTH,
            height: UPGRADE_CARD_HEIGHT,
        })),
    };
}

function isInsideRect(
    x: number,
    y: number,
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number,
): boolean {
    return x >= rectX && x <= rectX + rectWidth && y >= rectY && y <= rectY + rectHeight;
}

function isInsideCircle(
    x: number,
    y: number,
    circle: { x: number; y: number; radius: number },
): boolean {
    return Math.hypot(x - circle.x, y - circle.y) <= circle.radius;
}

export enum HudRegionKind {
    PANEL = 0,
    ORB = 1,
    SLOT = 2,
    STYLE = 3,
    UPGRADE_CARD = 4,
}

export type HudRegion =
    | { readonly kind: HudRegionKind.PANEL }
    | { readonly kind: HudRegionKind.ORB }
    | { readonly kind: HudRegionKind.SLOT; readonly slot: number }
    | { readonly kind: HudRegionKind.STYLE; readonly style: WeaponStyle }
    | { readonly kind: HudRegionKind.UPGRADE_CARD; readonly index: number };

export function hitTestHud(layout: HudLayout, x: number, y: number): HudRegion | undefined {
    const upgradeCardIndex = layout.upgradeCards.findIndex((card) =>
        isInsideRect(x, y, card.x, card.y, card.width, card.height),
    );
    if (upgradeCardIndex !== -1) {
        return { kind: HudRegionKind.UPGRADE_CARD, index: upgradeCardIndex };
    }
    const styleIcon = layout.styleIcons.find((icon) =>
        isInsideRect(x, y, icon.x, icon.y, icon.size, icon.size),
    );
    if (styleIcon) {
        return { kind: HudRegionKind.STYLE, style: styleIcon.style };
    }
    const slotIndex = layout.slots.findIndex((slot) =>
        isInsideRect(x, y, slot.x, slot.y, slot.size, slot.size),
    );
    if (slotIndex !== -1) {
        return { kind: HudRegionKind.SLOT, slot: slotIndex };
    }
    if (isInsideCircle(x, y, layout.healthGlobe) || isInsideCircle(x, y, layout.manaGlobe)) {
        return { kind: HudRegionKind.ORB };
    }
    if (isInsideRect(x, y, layout.panelX, layout.panelY, layout.panelWidth, layout.panelHeight)) {
        return { kind: HudRegionKind.PANEL };
    }
    return undefined;
}

function percentOf(current: number, max: number): number {
    if (max <= 0) {
        return 0;
    }
    return clamp(current / max, 0, 1);
}

function drawGlobe(
    ctx: CanvasRenderingContext2D,
    globe: { x: number; y: number; radius: number },
    percent: number,
    colors: { light: string; dark: string; glow: string },
): void {
    const { x, y, radius } = globe;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const emptyGradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    emptyGradient.addColorStop(0, "rgba(26, 24, 30, 1)");
    emptyGradient.addColorStop(1, "rgba(4, 4, 6, 1)");
    ctx.fillStyle = emptyGradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    const fillTop = y + radius - radius * 2 * percent;
    if (percent > 0) {
        const liquid = ctx.createRadialGradient(
            x - radius * 0.3,
            y + radius * 0.1,
            radius * 0.1,
            x,
            y,
            radius,
        );
        liquid.addColorStop(0, colors.light);
        liquid.addColorStop(1, colors.dark);
        ctx.fillStyle = liquid;
        ctx.fillRect(x - radius, fillTop, radius * 2, radius * 2);

        ctx.fillStyle = colors.glow;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x - radius, fillTop, radius * 2, 2);
        ctx.globalAlpha = 1;
    }

    const shine = ctx.createRadialGradient(
        x - radius * 0.35,
        y - radius * 0.45,
        0,
        x - radius * 0.35,
        y - radius * 0.45,
        radius * 0.7,
    );
    shine.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    shine.addColorStop(0.4, "rgba(255, 255, 255, 0.12)");
    shine.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    const rim = ctx.createRadialGradient(x, y, radius * 0.75, x, y, radius);
    rim.addColorStop(0, "rgba(0, 0, 0, 0)");
    rim.addColorStop(1, "rgba(0, 0, 0, 0.7)");
    ctx.fillStyle = rim;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#151210";
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(190, 160, 110, 0.55)";
    ctx.stroke();
}

function drawResourceLabel(
    ctx: CanvasRenderingContext2D,
    label: string,
    current: number,
    max: number,
    globe: { x: number; y: number; radius: number },
): void {
    ctx.save();
    ctx.font = "600 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#d8cfbc";
    const text = `${label}: ${Math.ceil(current)} / ${max}`;
    const y = globe.y - globe.radius - 6;
    ctx.strokeText(text, globe.x, y);
    ctx.fillText(text, globe.x, y);
    ctx.restore();
}

export function drawBottomPanel(ctx: CanvasRenderingContext2D, layout: HudLayout): void {
    const { panelX, panelY, panelWidth, panelHeight } = layout;
    const inset = layout.healthGlobe.radius;
    const x = panelX + inset;
    const w = panelWidth - inset * 2;

    const gradient = ctx.createLinearGradient(0, panelY, 0, panelY + panelHeight);
    gradient.addColorStop(0, "rgba(28, 24, 22, 0.96)");
    gradient.addColorStop(1, "rgba(10, 8, 8, 0.98)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, panelY, w, panelHeight);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(120, 96, 60, 0.7)";
    ctx.strokeRect(x + 1, panelY + 1, w - 2, panelHeight - 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.strokeRect(x + 4, panelY + 4, w - 8, panelHeight - 8);
}

export function drawHealthGlobe(
    ctx: CanvasRenderingContext2D,
    layout: HudLayout,
    player: PlayerHudInfo,
): void {
    drawGlobe(
        ctx,
        layout.healthGlobe,
        percentOf(player.health, player.maxHealth),
        HEALTH_GLOBE_COLOR,
    );
    drawResourceLabel(ctx, "Life", player.health, player.maxHealth, layout.healthGlobe);
}

export function drawManaGlobe(
    ctx: CanvasRenderingContext2D,
    layout: HudLayout,
    player: PlayerHudInfo,
): void {
    drawGlobe(ctx, layout.manaGlobe, percentOf(player.mana, player.maxMana), MANA_GLOBE_COLOR);
    drawResourceLabel(ctx, "Mana", player.mana, player.maxMana, layout.manaGlobe);
}

const ABILITY_NAME_MAX_LENGTH = 10;
const MANA_BLOCK_TINT = "rgba(20, 30, 90, 0.55)";
const COOLDOWN_SWEEP_COLOR = "rgba(0, 0, 0, 0.72)";
const STYLE_ACTIVE_BORDER_COLOR = "#ffd24d";
const STYLE_INACTIVE_BORDER_COLOR = "rgba(120, 96, 60, 0.6)";
const STYLE_GLYPH_COLOR = "#e8e0d0";

function abbreviateAbilityName(name: string): string {
    if (name.length <= ABILITY_NAME_MAX_LENGTH) {
        return name;
    }
    const initials = name
        .split(/\s+/)
        .map((word) => word[0])
        .join("");
    return initials.length > 0 ? initials.toUpperCase() : name.slice(0, ABILITY_NAME_MAX_LENGTH);
}

function drawRadialSweep(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; size: number },
    fraction: number,
    color: string,
): void {
    if (fraction <= 0) {
        return;
    }
    const cx = box.x + box.size / 2;
    const cy = box.y + box.size / 2;
    const radius = box.size * 0.75;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * clamp(fraction, 0, 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.size, box.size);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawAbilitySlot(
    ctx: CanvasRenderingContext2D,
    slot: { x: number; y: number; size: number },
    ability: AbilitySlotHudInfo,
): void {
    const { x, y, size } = slot;

    ctx.fillStyle = "rgba(6, 6, 8, 0.9)";
    ctx.fillRect(x, y, size, size);

    if (ability.name) {
        ctx.save();
        ctx.font = "600 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillStyle = "#e8e0d0";
        const label = abbreviateAbilityName(ability.name);
        ctx.strokeText(label, x + size / 2, y + size / 2, size - 8);
        ctx.fillText(label, x + size / 2, y + size / 2, size - 8);
        ctx.restore();
    }

    drawRadialSweep(ctx, slot, ability.cooldownFraction, COOLDOWN_SWEEP_COLOR);

    if (ability.blocked === AbilitySlotBlockReason.MANA) {
        ctx.fillStyle = MANA_BLOCK_TINT;
        ctx.fillRect(x, y, size, size);
    }

    if (ability.charges) {
        ctx.save();
        ctx.font = "700 12px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillStyle = "#ffe9a8";
        const text = `${ability.charges.current}/${ability.charges.max}`;
        ctx.strokeText(text, x + size - 4, y + size - 4);
        ctx.fillText(text, x + size - 4, y + size - 4);
        ctx.restore();
    }

    ctx.save();
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#d8cfbc";
    ctx.strokeText(ability.keyLabel, x + 4, y + 3);
    ctx.fillText(ability.keyLabel, x + 4, y + 3);
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = STYLE_INACTIVE_BORDER_COLOR;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
}

export function drawAbilityBar(
    ctx: CanvasRenderingContext2D,
    layout: HudLayout,
    abilities: readonly AbilitySlotHudInfo[],
): void {
    for (let i = 0; i < layout.slots.length; i++) {
        const ability = abilities[i];
        if (!ability) {
            continue;
        }
        drawAbilitySlot(ctx, layout.slots[i], ability);
    }
}

function drawStyleGlyph(
    ctx: CanvasRenderingContext2D,
    style: WeaponStyle,
    cx: number,
    cy: number,
    size: number,
): void {
    const r = size * 0.28;
    ctx.save();
    ctx.strokeStyle = STYLE_GLYPH_COLOR;
    ctx.fillStyle = STYLE_GLYPH_COLOR;
    ctx.lineWidth = 2;
    switch (style) {
        case WeaponStyle.MELEE:
            ctx.beginPath();
            ctx.moveTo(cx - r, cy - r);
            ctx.lineTo(cx + r, cy + r);
            ctx.moveTo(cx + r, cy - r);
            ctx.lineTo(cx - r, cy + r);
            ctx.stroke();
            break;
        case WeaponStyle.RANGED:
            ctx.beginPath();
            ctx.moveTo(cx - r, cy + r);
            ctx.lineTo(cx + r, cy - r);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx + r, cy - r);
            ctx.lineTo(cx + r - size * 0.2, cy - r);
            ctx.lineTo(cx + r, cy - r + size * 0.2);
            ctx.closePath();
            ctx.fill();
            break;
        case WeaponStyle.MAGIC:
            ctx.beginPath();
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx + r * 0.3, cy - r * 0.3);
            ctx.lineTo(cx + r, cy);
            ctx.lineTo(cx + r * 0.3, cy + r * 0.3);
            ctx.lineTo(cx, cy + r);
            ctx.lineTo(cx - r * 0.3, cy + r * 0.3);
            ctx.lineTo(cx - r, cy);
            ctx.lineTo(cx - r * 0.3, cy - r * 0.3);
            ctx.closePath();
            ctx.fill();
            break;
    }
    ctx.restore();
}

function drawStyleIcon(
    ctx: CanvasRenderingContext2D,
    icon: { x: number; y: number; size: number; style: WeaponStyle },
    active: boolean,
): void {
    const { x, y, size, style } = icon;

    ctx.fillStyle = "rgba(6, 6, 8, 0.9)";
    ctx.fillRect(x, y, size, size);

    drawStyleGlyph(ctx, style, x + size / 2, y + size / 2, size);

    ctx.save();
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#d8cfbc";
    const keyLabel = STYLE_KEY_LABELS[style];
    ctx.strokeText(keyLabel, x + 3, y + 2);
    ctx.fillText(keyLabel, x + 3, y + 2);
    ctx.restore();

    ctx.lineWidth = active ? 3 : 2;
    ctx.strokeStyle = active ? STYLE_ACTIVE_BORDER_COLOR : STYLE_INACTIVE_BORDER_COLOR;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
}

export function drawStyleRow(
    ctx: CanvasRenderingContext2D,
    layout: HudLayout,
    activeStyle: WeaponStyle,
): void {
    for (const icon of layout.styleIcons) {
        drawStyleIcon(ctx, icon, icon.style === activeStyle);
    }
}

// Diablo's experience strip: a thin gold bar right above the chrome, spanning the gap between the
// two globes, notched into tenths of the level.
export function drawExperienceBar(
    ctx: CanvasRenderingContext2D,
    layout: HudLayout,
    player: PlayerHudInfo,
): void {
    const { x, y, width, height } = layout.experienceBar;
    const denominator = player.nextLevelExperience - player.levelStartExperience;
    const progress = percentOf(player.experience - player.levelStartExperience, denominator);

    ctx.fillStyle = "rgba(8, 6, 6, 0.92)";
    ctx.fillRect(x, y, width, height);
    const fill = ctx.createLinearGradient(0, y, 0, y + height);
    fill.addColorStop(0, "#f4dc8a");
    fill.addColorStop(0.5, "#c9a24a");
    fill.addColorStop(1, "#7a5a1e");
    ctx.fillStyle = fill;
    ctx.fillRect(x + 1, y + 1, (width - 2) * progress, height - 2);

    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    for (let notch = 1; notch < EXPERIENCE_BAR_SEGMENTS; notch++) {
        ctx.fillRect(Math.round(x + (width * notch) / EXPERIENCE_BAR_SEGMENTS), y, 1, height);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(120, 96, 60, 0.8)";
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    ctx.save();
    ctx.font = "600 12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#d8cfbc";
    const label = `Level ${player.level}`;
    ctx.strokeText(label, x, y - 3);
    ctx.fillText(label, x, y - 3);
    ctx.restore();
}

const SPLAT_RISE_PIXELS = 46;
const HITSPLAT_SIZE_PX = 30;
// The client's own offsets for a 25px splat, grown with it.
const HITSPLAT_SLOT_SCALE = HITSPLAT_SIZE_PX / 25;
const HITSPLAT_SLOT_OFFSETS: Readonly<Record<HitsplatSlot, { x: number; y: number }>> = {
    [HitsplatSlot.BOTTOM]: { x: 0, y: 0 },
    [HitsplatSlot.TOP]: { x: 0, y: -20 * HITSPLAT_SLOT_SCALE },
    [HitsplatSlot.LEFT]: { x: -15 * HITSPLAT_SLOT_SCALE, y: -10 * HITSPLAT_SLOT_SCALE },
    [HitsplatSlot.RIGHT]: { x: 15 * HITSPLAT_SLOT_SCALE, y: -10 * HITSPLAT_SLOT_SCALE },
};
const HEAL_COLOR = "#4dff7a";

function drawSplatText(
    ctx: CanvasRenderingContext2D,
    screen: { x: number; y: number },
    text: string,
    color: string,
    progress: number,
): void {
    const rise = SPLAT_RISE_PIXELS * progress;

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.font = "700 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = color;
    ctx.strokeText(text, screen.x, screen.y - rise);
    ctx.fillText(text, screen.x, screen.y - rise);
    ctx.restore();
}

// OSRS's hitsplat: the number over a blue splat when the hit did nothing, a red one when it hurt.
// It holds still for its whole life rather than rising and fading like a heal.
export function drawDamageSplat(
    ctx: CanvasRenderingContext2D,
    sprites: HitsplatSprites,
    anchor: { x: number; y: number },
    slot: HitsplatSlot,
    amount: number,
): void {
    const shown = Math.round(amount);
    const offset = HITSPLAT_SLOT_OFFSETS[slot];
    const x = anchor.x + offset.x;
    const y = anchor.y + offset.y;
    ctx.drawImage(
        shown > 0 ? sprites.damage : sprites.blocked,
        x - HITSPLAT_SIZE_PX / 2,
        y - HITSPLAT_SIZE_PX / 2,
        HITSPLAT_SIZE_PX,
        HITSPLAT_SIZE_PX,
    );
    ctx.save();
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000000";
    ctx.fillText(`${shown}`, x + 1, y + 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${shown}`, x, y);
    ctx.restore();
}

export function drawHealSplat(
    ctx: CanvasRenderingContext2D,
    screen: { x: number; y: number },
    amount: number,
    progress: number,
): void {
    drawSplatText(ctx, screen, `+${Math.round(amount)}`, HEAL_COLOR, progress);
}

const WAVE_COUNTER_MARGIN_TOP = 16;
const WAVE_COUNTER_SUMMARY_MARGIN_TOP = WAVE_COUNTER_MARGIN_TOP + 24;

function phaseCounterText(phase: PhaseHudInfo): string {
    switch (phase.status) {
        case PhaseStatus.COMPLETE:
            return "Encounter cleared";
        case PhaseStatus.REWARDS:
            return `Phase ${phase.index} / ${phase.total} cleared · claim reward`;
        case PhaseStatus.READY:
            return `Phase ${phase.index} / ${phase.total} · ready to start`;
        case PhaseStatus.ACTIVE:
            return `Phase ${phase.index} / ${phase.total} · ${phase.label}`;
    }
}

function phaseCounterColor(status: PhaseStatus): string {
    switch (status) {
        case PhaseStatus.COMPLETE:
            return "#4dff7a";
        case PhaseStatus.REWARDS:
        case PhaseStatus.READY:
            return "#ffd24d";
        case PhaseStatus.ACTIVE:
            return "#e8e0d0";
    }
}

export function drawPhaseCounter(
    ctx: CanvasRenderingContext2D,
    width: number,
    phase: PhaseHudInfo,
): void {
    ctx.save();
    ctx.font = "700 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = phaseCounterColor(phase.status);
    const text = phaseCounterText(phase);
    ctx.strokeText(text, width / 2, WAVE_COUNTER_MARGIN_TOP);
    ctx.fillText(text, width / 2, WAVE_COUNTER_MARGIN_TOP);

    if (phase.modifiersSummary) {
        ctx.font = "600 13px sans-serif";
        ctx.fillStyle = "#b8ac94";
        ctx.strokeText(phase.modifiersSummary, width / 2, WAVE_COUNTER_SUMMARY_MARGIN_TOP);
        ctx.fillText(phase.modifiersSummary, width / 2, WAVE_COUNTER_SUMMARY_MARGIN_TOP);
    }
    ctx.restore();
}

const GOD_MODE_LABEL_MARGIN_TOP = WAVE_COUNTER_SUMMARY_MARGIN_TOP + 20;

export function drawGodModeLabel(ctx: CanvasRenderingContext2D, width: number): void {
    ctx.save();
    ctx.font = "700 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#4dc8ff";
    ctx.strokeText("GOD MODE", width / 2, GOD_MODE_LABEL_MARGIN_TOP);
    ctx.fillText("GOD MODE", width / 2, GOD_MODE_LABEL_MARGIN_TOP);
    ctx.restore();
}

const PREVIEW_SEQ_LABEL_MARGIN_TOP = 12;

export function drawPreviewSeqLabel(
    ctx: CanvasRenderingContext2D,
    width: number,
    seqId: number,
): void {
    ctx.save();
    ctx.font = "700 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#e8e0d0";
    const text = `Seq ${seqId}`;
    ctx.strokeText(text, width / 2, PREVIEW_SEQ_LABEL_MARGIN_TOP);
    ctx.fillText(text, width / 2, PREVIEW_SEQ_LABEL_MARGIN_TOP);
    ctx.restore();
}

const UPGRADE_OVERLAY_DIM_COLOR = "rgba(0, 0, 0, 0.6)";

function drawUpgradeCard(
    ctx: CanvasRenderingContext2D,
    card: { x: number; y: number; width: number; height: number },
    info: UpgradeCardHudInfo,
): void {
    const { x, y, width, height } = card;
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, "rgba(28, 24, 22, 0.96)");
    gradient.addColorStop(1, "rgba(10, 8, 8, 0.98)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(120, 96, 60, 0.7)";
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);

    ctx.save();
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.font = "700 20px sans-serif";
    ctx.fillStyle = "#ffd24d";
    ctx.textBaseline = "top";
    ctx.strokeText(info.name, x + width / 2, y + 28, width - 24);
    ctx.fillText(info.name, x + width / 2, y + 28, width - 24);
    ctx.font = "500 15px sans-serif";
    ctx.fillStyle = "#e8e0d0";
    ctx.strokeText(info.description, x + width / 2, y + 64, width - 24);
    ctx.fillText(info.description, x + width / 2, y + 64, width - 24);
    ctx.font = "700 16px sans-serif";
    ctx.fillStyle = "#d8cfbc";
    ctx.textBaseline = "bottom";
    ctx.strokeText(`[${info.keyLabel}]`, x + width / 2, y + height - 16);
    ctx.fillText(`[${info.keyLabel}]`, x + width / 2, y + height - 16);
    ctx.restore();
}

export function drawUpgradeOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layout: HudLayout,
    cards: readonly UpgradeCardHudInfo[],
): void {
    ctx.save();
    ctx.fillStyle = UPGRADE_OVERLAY_DIM_COLOR;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    const cardCount = Math.min(layout.upgradeCards.length, cards.length);
    for (let index = 0; index < cardCount; index++) {
        drawUpgradeCard(ctx, layout.upgradeCards[index], cards[index]);
    }
}

// Colours lifted from the deleted React OsrsMenu.css (see git history, a3acd2f^).
export const MENU_FONT =
    '16px "OSRS Bold", ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace';
const MENU_TITLE_TEXT_COLOR = "#5d5447";
const MENU_TITLE_BG_COLOR = "#000000";
const MENU_BORDER_COLOR = "#5d5447";
const MENU_OPTIONS_BG_COLOR = "#5d5447";
const MENU_TOOLTIP_BG_COLOR = "rgba(93, 84, 71, 0.7)";
const MENU_VERB_COLOR = "#ffffff";
const MENU_VERB_HOVER_COLOR = "#ffff00";
const MENU_OBJECT_NAME_COLOR = "#00ffff";
const MENU_NPC_NAME_COLOR = "#ffff00";
const MENU_NPC_LEVEL_COLOR = "#c0ff00";
const MENU_ITEM_NAME_COLOR = "#ff9040";
const MENU_TEXT_LEFT_PADDING_PX = 2;

// A measurer for the renderer's own hit-testing/layout (see WebGLMapViewerRenderer's menuState
// handling): an offscreen canvas rather than the HUD's own drawing context, since the renderer
// builds input from real mouse coordinates every frame regardless of whether the HUD canvas has
// drawn yet.
export function createMenuTextMeasurer(): (text: string) => number {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Failed to create a 2D context for menu text measurement");
    }
    ctx.font = MENU_FONT;
    return (text: string) => ctx.measureText(text).width;
}

function menuRunColor(role: MenuTextRunRole, hovered: boolean): string {
    switch (role) {
        case "verb":
        case "cancel":
            return hovered ? MENU_VERB_HOVER_COLOR : MENU_VERB_COLOR;
        case "objectName":
            return MENU_OBJECT_NAME_COLOR;
        case "npcName":
            return MENU_NPC_NAME_COLOR;
        case "npcLevel":
            return MENU_NPC_LEVEL_COLOR;
        case "itemName":
            return MENU_ITEM_NAME_COLOR;
        case "suffix":
            return MENU_VERB_COLOR;
    }
}

// A 1px black text shadow, matching the old CSS's `text-shadow: 1px 1px 0 black`.
function drawMenuText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
    ctx.fillStyle = "black";
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

function drawMenuEntryRuns(
    ctx: CanvasRenderingContext2D,
    entry: MenuEntry,
    x: number,
    y: number,
    hovered: boolean,
    measureText: (text: string) => number,
): void {
    let cursorX = x;
    for (const run of menuEntryTextRuns(entry)) {
        drawMenuText(ctx, run.text, cursorX, y, menuRunColor(run.role, hovered && run.role !== "suffix"));
        cursorX += measureText(run.text);
    }
}

// The standard OSRS right-click "Choose Option" menu - see git history (a3acd2f^) for the deleted
// React version this recreates on the HUD canvas.
export function drawContextMenu(
    ctx: CanvasRenderingContext2D,
    entries: readonly MenuEntry[],
    anchor: Point,
    viewport: Size,
    hoveredIndex: number | undefined,
): void {
    ctx.save();
    ctx.font = MENU_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const measureText = (text: string) => ctx.measureText(text).width;
    const layout = computeMenuLayout(entries, anchor, viewport, measureText);
    const { box } = layout;

    ctx.fillStyle = MENU_TITLE_BG_COLOR;
    ctx.fillRect(box.x, box.y, box.width, layout.titleHeight);
    ctx.fillStyle = MENU_OPTIONS_BG_COLOR;
    ctx.fillRect(
        box.x,
        box.y + layout.titleHeight,
        box.width,
        box.height - layout.titleHeight,
    );

    ctx.strokeStyle = MENU_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + layout.titleHeight + 0.5);
    ctx.lineTo(box.x + box.width, box.y + layout.titleHeight + 0.5);
    ctx.stroke();

    drawMenuText(
        ctx,
        "Choose Option",
        box.x + MENU_TEXT_LEFT_PADDING_PX,
        box.y + 1,
        MENU_TITLE_TEXT_COLOR,
    );

    entries.forEach((entry, index) => {
        const rect = layout.entryRects[index];
        drawMenuEntryRuns(
            ctx,
            entry,
            rect.x + MENU_TEXT_LEFT_PADDING_PX,
            rect.y + 1,
            index === hoveredIndex,
            measureText,
        );
    });
    ctx.restore();
}

// The hover tooltip shown while the menu is closed: "Pull Lever / 2 more options", offset below
// the cursor with a translucent background (see the old CSS's `.tooltip .options`).
export function drawContextMenuTooltip(
    ctx: CanvasRenderingContext2D,
    entries: readonly MenuEntry[],
    anchor: Point,
    viewport: Size,
): void {
    ctx.save();
    ctx.font = MENU_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const measureText = (text: string) => ctx.measureText(text).width;
    const layout = computeTooltipLayout(entries, anchor, viewport, measureText);
    if (!layout) {
        ctx.restore();
        return;
    }

    ctx.fillStyle = MENU_TOOLTIP_BG_COLOR;
    ctx.fillRect(layout.box.x, layout.box.y, layout.box.width, layout.box.height);

    let cursorX = layout.box.x + MENU_TEXT_LEFT_PADDING_PX;
    const y = layout.box.y + 1;
    for (const run of layout.runs) {
        drawMenuText(ctx, run.text, cursorX, y, menuRunColor(run.role, false));
        cursorX += measureText(run.text);
    }
    ctx.restore();
}

// The sprite's own native size (see assets/HudAssets.ts) - drawn 1:1, like OSRS.
const CLICK_CROSS_SIZE_PX = 16;
const OVERHEAD_ICON_SIZE_PX = 30;
const OVERHEAD_HEALTH_BAR_WIDTH_PX = 40;
const OVERHEAD_HEALTH_BAR_HEIGHT_PX = 6;
const OVERHEAD_GAP_PX = 4;

// OSRS's classic health bar: green for what's left, red for what's gone, just over the head, with
// the prayer icon stacked above it.
export function drawOverhead(
    ctx: CanvasRenderingContext2D,
    overhead: OverheadHudInfo,
    modelTop: { x: number; y: number },
): void {
    const barX = Math.round(modelTop.x - OVERHEAD_HEALTH_BAR_WIDTH_PX / 2);
    const barY = Math.round(modelTop.y - OVERHEAD_GAP_PX - OVERHEAD_HEALTH_BAR_HEIGHT_PX);
    const remaining = Math.round(
        OVERHEAD_HEALTH_BAR_WIDTH_PX * percentOf(overhead.health, overhead.maxHealth),
    );
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(barX, barY, OVERHEAD_HEALTH_BAR_WIDTH_PX, OVERHEAD_HEALTH_BAR_HEIGHT_PX);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(barX, barY, remaining, OVERHEAD_HEALTH_BAR_HEIGHT_PX);
    if (!overhead.prayerIcon) {
        return;
    }
    ctx.drawImage(
        overhead.prayerIcon,
        modelTop.x - OVERHEAD_ICON_SIZE_PX / 2,
        barY - OVERHEAD_GAP_PX - OVERHEAD_ICON_SIZE_PX,
        OVERHEAD_ICON_SIZE_PX,
        OVERHEAD_ICON_SIZE_PX,
    );
}

export function drawClickCross(
    ctx: CanvasRenderingContext2D,
    sprites: CrossSprites,
    cross: ClickCrossHudInfo,
): void {
    const frame = sprites[cross.kind][cross.frameIndex];
    ctx.drawImage(
        frame,
        cross.screenX - CLICK_CROSS_SIZE_PX / 2,
        cross.screenY - CLICK_CROSS_SIZE_PX / 2,
        CLICK_CROSS_SIZE_PX,
        CLICK_CROSS_SIZE_PX,
    );
}

const PICKUP_FLASH_MARGIN_TOP = 90;
const PICKUP_FLASH_COLOR = "#4dff7a";

export function drawPickupFlash(
    ctx: CanvasRenderingContext2D,
    width: number,
    text: string,
    progress: number,
): void {
    ctx.save();
    ctx.globalAlpha = 1 - Math.max(0, progress - 0.7) / 0.3;
    ctx.font = "700 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = PICKUP_FLASH_COLOR;
    ctx.strokeText(text, width / 2, PICKUP_FLASH_MARGIN_TOP);
    ctx.fillText(text, width / 2, PICKUP_FLASH_MARGIN_TOP);
    ctx.restore();
}
