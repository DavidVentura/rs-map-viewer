import { clamp } from "../../util/MathUtil";
import { Faction } from "../game/Combatant";
import { PlayerHudInfo, TargetHudInfo } from "./HudFrame";

const HEALTH_GLOBE_COLOR = { light: "#ff4a3a", dark: "#5a0606", glow: "#ff9a8a" };
const MANA_GLOBE_COLOR = { light: "#4a6cff", dark: "#0a1660", glow: "#9ab0ff" };

const PANEL_MAX_WIDTH = 880;
const PANEL_HEIGHT = 96;
const PANEL_BOTTOM_MARGIN = 0;
const GLOBE_RADIUS = 58;
const ABILITY_SLOT_SIZE = 56;
const ABILITY_SLOT_GAP = 8;
const ABILITY_SLOT_COUNT = 4;
const TARGET_PLATE_WIDTH = 300;
const TARGET_PLATE_HEIGHT = 56;
const TARGET_PLATE_MARGIN_TOP = 16;

export type HudLayout = {
    panelX: number;
    panelY: number;
    panelWidth: number;
    panelHeight: number;
    healthGlobe: { x: number; y: number; radius: number };
    manaGlobe: { x: number; y: number; radius: number };
    slots: { x: number; y: number; size: number }[];
};

export function computeHudLayout(width: number, height: number): HudLayout {
    const panelWidth = Math.min(PANEL_MAX_WIDTH, width);
    const panelX = width / 2 - panelWidth / 2;
    const panelY = height - PANEL_BOTTOM_MARGIN - PANEL_HEIGHT;
    const globeY = height - PANEL_BOTTOM_MARGIN - GLOBE_RADIUS - 6;
    const slotsWidth =
        ABILITY_SLOT_SIZE * ABILITY_SLOT_COUNT + ABILITY_SLOT_GAP * (ABILITY_SLOT_COUNT - 1);
    const slotsX = width / 2 - slotsWidth / 2;
    const slotsY = panelY + PANEL_HEIGHT / 2 - ABILITY_SLOT_SIZE / 2;
    return {
        panelX,
        panelY,
        panelWidth,
        panelHeight: PANEL_HEIGHT,
        healthGlobe: { x: panelX + GLOBE_RADIUS, y: globeY, radius: GLOBE_RADIUS },
        manaGlobe: { x: panelX + panelWidth - GLOBE_RADIUS, y: globeY, radius: GLOBE_RADIUS },
        slots: Array.from({ length: ABILITY_SLOT_COUNT }, (_, i) => ({
            x: slotsX + i * (ABILITY_SLOT_SIZE + ABILITY_SLOT_GAP),
            y: slotsY,
            size: ABILITY_SLOT_SIZE,
        })),
    };
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

export function drawAbilityBar(ctx: CanvasRenderingContext2D, layout: HudLayout): void {
    for (const slot of layout.slots) {
        ctx.fillStyle = "rgba(6, 6, 8, 0.9)";
        ctx.fillRect(slot.x, slot.y, slot.size, slot.size);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(120, 96, 60, 0.6)";
        ctx.strokeRect(slot.x + 1, slot.y + 1, slot.size - 2, slot.size - 2);
    }
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

const DAMAGE_SPLAT_RISE_PIXELS = 46;
const DAMAGE_TO_PLAYER_COLOR = "#ff4d4d";
const DAMAGE_TO_ENEMY_COLOR = "#ffd24d";

export function drawDamageSplat(
    ctx: CanvasRenderingContext2D,
    screen: { x: number; y: number },
    amount: number,
    factionHit: Faction,
    progress: number,
): void {
    const rise = DAMAGE_SPLAT_RISE_PIXELS * progress;
    const color = factionHit === Faction.PLAYER ? DAMAGE_TO_PLAYER_COLOR : DAMAGE_TO_ENEMY_COLOR;

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.font = "700 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = color;
    const text = `${Math.round(amount)}`;
    ctx.strokeText(text, screen.x, screen.y - rise);
    ctx.fillText(text, screen.x, screen.y - rise);
    ctx.restore();
}
