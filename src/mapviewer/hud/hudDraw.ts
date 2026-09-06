import { clamp } from "../../util/MathUtil";
import { WeaponStyle } from "../game/Ability";
import { Faction } from "../game/Combatant";
import {
    AbilitySlotBlockReason,
    AbilitySlotHudInfo,
    PlayerHudInfo,
    StyleSwitchHudInfo,
    TargetHudInfo,
    WaveHudInfo,
} from "./HudFrame";

const HEALTH_GLOBE_COLOR = { light: "#ff4a3a", dark: "#5a0606", glow: "#ff9a8a" };
const MANA_GLOBE_COLOR = { light: "#4a6cff", dark: "#0a1660", glow: "#9ab0ff" };

const PANEL_MAX_WIDTH = 880;
const PANEL_HEIGHT = 96;
const PANEL_BOTTOM_MARGIN = 0;
const GLOBE_RADIUS = 58;
const ABILITY_SLOT_SIZE = 56;
const ABILITY_SLOT_GAP = 8;
const TARGET_PLATE_WIDTH = 300;
const TARGET_PLATE_HEIGHT = 56;
const TARGET_PLATE_MARGIN_TOP = 16;
const SWITCH_LABEL_MARGIN_TOP = 4;
const STYLE_ICON_SIZE = 26;
const STYLE_ICON_GAP = 6;
const STYLE_ROW_MARGIN_BOTTOM = 6;

const STYLE_ORDER: readonly WeaponStyle[] = [
    WeaponStyle.MELEE,
    WeaponStyle.RANGED,
    WeaponStyle.MAGIC,
];

const STYLE_NAMES: Record<WeaponStyle, string> = {
    [WeaponStyle.MELEE]: "Melee",
    [WeaponStyle.RANGED]: "Ranged",
    [WeaponStyle.MAGIC]: "Magic",
};

const STYLE_KEY_LABELS: Record<WeaponStyle, string> = {
    [WeaponStyle.MELEE]: "Q",
    [WeaponStyle.RANGED]: "W",
    [WeaponStyle.MAGIC]: "E",
};

export function styleDisplayName(style: WeaponStyle): string {
    return STYLE_NAMES[style];
}

export type HudLayout = {
    panelX: number;
    panelY: number;
    panelWidth: number;
    panelHeight: number;
    healthGlobe: { x: number; y: number; radius: number };
    manaGlobe: { x: number; y: number; radius: number };
    slots: { x: number; y: number; size: number }[];
    styleIcons: { x: number; y: number; size: number; style: WeaponStyle }[];
    switchLabelY: number;
};

export function computeHudLayout(width: number, height: number, slotCount: number): HudLayout {
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
    const styleIconsY = slotsY - STYLE_ICON_SIZE - STYLE_ROW_MARGIN_BOTTOM;
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
        styleIcons: STYLE_ORDER.map((style, i) => ({
            x: styleIconsX + i * (STYLE_ICON_SIZE + STYLE_ICON_GAP),
            y: styleIconsY,
            size: STYLE_ICON_SIZE,
            style,
        })),
        switchLabelY: slotsY + ABILITY_SLOT_SIZE + SWITCH_LABEL_MARGIN_TOP,
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
}

export type HudRegion =
    | { readonly kind: HudRegionKind.PANEL }
    | { readonly kind: HudRegionKind.ORB }
    | { readonly kind: HudRegionKind.SLOT; readonly slot: number }
    | { readonly kind: HudRegionKind.STYLE; readonly style: WeaponStyle };

export function hitTestHud(layout: HudLayout, x: number, y: number): HudRegion | undefined {
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
const STYLE_SWITCH_SWEEP_COLOR = "rgba(255, 210, 77, 0.55)";
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
    switchProgress: number | undefined,
): void {
    const { x, y, size, style } = icon;

    ctx.fillStyle = "rgba(6, 6, 8, 0.9)";
    ctx.fillRect(x, y, size, size);

    drawStyleGlyph(ctx, style, x + size / 2, y + size / 2, size);

    if (switchProgress !== undefined) {
        drawRadialSweep(ctx, icon, switchProgress, STYLE_SWITCH_SWEEP_COLOR);
    }

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
    styleSwitch: StyleSwitchHudInfo | undefined,
): void {
    for (const icon of layout.styleIcons) {
        const switchProgress =
            styleSwitch !== undefined && styleSwitch.target === icon.style
                ? styleSwitch.progress
                : undefined;
        drawStyleIcon(ctx, icon, icon.style === activeStyle, switchProgress);
    }
}

export function drawStyleSwitchLabel(
    ctx: CanvasRenderingContext2D,
    layout: HudLayout,
    width: number,
    targetStyleName: string,
): void {
    ctx.save();
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#ffd24d";
    const text = `Switching to ${targetStyleName}`;
    ctx.strokeText(text, width / 2, layout.switchLabelY);
    ctx.fillText(text, width / 2, layout.switchLabelY);
    ctx.restore();
}

export function drawTargetPlate(
    ctx: CanvasRenderingContext2D,
    width: number,
    target: TargetHudInfo,
): void {
    const x = width / 2 - TARGET_PLATE_WIDTH / 2;
    const y = TARGET_PLATE_MARGIN_TOP;

    ctx.fillStyle = "rgba(6, 6, 10, 0.82)";
    ctx.fillRect(x, y, TARGET_PLATE_WIDTH, TARGET_PLATE_HEIGHT);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.strokeRect(x, y, TARGET_PLATE_WIDTH, TARGET_PLATE_HEIGHT);

    ctx.fillStyle = "#e8e0d0";
    ctx.font = "600 15px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`${target.name} (level-${target.combatLevel})`, width / 2, y + 6);

    const barWidth = TARGET_PLATE_WIDTH - 24;
    const barHeight = 10;
    const barX = width / 2 - barWidth / 2;
    const barY = y + 32;
    const percent = percentOf(target.health, target.maxHealth);

    ctx.fillStyle = "rgba(40, 6, 6, 0.9)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = "#c81e1e";
    ctx.fillRect(barX, barY, barWidth * percent, barHeight);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeRect(barX, barY, barWidth, barHeight);
}

const SPLAT_RISE_PIXELS = 46;
const DAMAGE_TO_PLAYER_COLOR = "#ff4d4d";
const DAMAGE_TO_ENEMY_COLOR = "#ffd24d";
const HEAL_COLOR = "#4dff7a";
const FROZEN_COLOR = "#7ac8ff";

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

export function drawDamageSplat(
    ctx: CanvasRenderingContext2D,
    screen: { x: number; y: number },
    amount: number,
    factionHit: Faction,
    progress: number,
): void {
    const color = factionHit === Faction.PLAYER ? DAMAGE_TO_PLAYER_COLOR : DAMAGE_TO_ENEMY_COLOR;
    drawSplatText(ctx, screen, `${Math.round(amount)}`, color, progress);
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
const WAVE_COUNTER_MARGIN_RIGHT = 20;

export function drawWaveCounter(
    ctx: CanvasRenderingContext2D,
    width: number,
    wave: WaveHudInfo,
): void {
    const text = wave.cleared
        ? "Encounter cleared"
        : `Wave ${wave.index} / ${wave.total} · ${wave.aliveEnemies} left`;

    ctx.save();
    ctx.font = "700 18px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = wave.cleared ? "#4dff7a" : "#e8e0d0";
    ctx.strokeText(text, width - WAVE_COUNTER_MARGIN_RIGHT, WAVE_COUNTER_MARGIN_TOP);
    ctx.fillText(text, width - WAVE_COUNTER_MARGIN_RIGHT, WAVE_COUNTER_MARGIN_TOP);
    ctx.restore();
}

export function drawFrozenSplat(
    ctx: CanvasRenderingContext2D,
    screen: { x: number; y: number },
    progress: number,
): void {
    drawSplatText(ctx, screen, "Frozen", FROZEN_COLOR, progress);
}
