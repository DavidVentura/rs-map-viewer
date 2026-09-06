import { clamp } from "../../util/MathUtil";
import { Stance } from "../game/Ability";
import { Faction } from "../game/Combatant";
import {
    AbilitySlotBlockReason,
    AbilitySlotHudInfo,
    PlayerHudInfo,
    TargetHudInfo,
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
const STANCE_LABEL_MARGIN_TOP = 4;

export type HudLayout = {
    panelX: number;
    panelY: number;
    panelWidth: number;
    panelHeight: number;
    healthGlobe: { x: number; y: number; radius: number };
    manaGlobe: { x: number; y: number; radius: number };
    slots: { x: number; y: number; size: number }[];
    stanceLabelY: number;
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
        stanceLabelY: slotsY + ABILITY_SLOT_SIZE + STANCE_LABEL_MARGIN_TOP,
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

export function hitTestHud(layout: HudLayout, x: number, y: number): boolean {
    if (isInsideRect(x, y, layout.panelX, layout.panelY, layout.panelWidth, layout.panelHeight)) {
        return true;
    }
    if (isInsideCircle(x, y, layout.healthGlobe) || isInsideCircle(x, y, layout.manaGlobe)) {
        return true;
    }
    return layout.slots.some((slot) => isInsideRect(x, y, slot.x, slot.y, slot.size, slot.size));
}

const STANCE_NAMES: Record<Stance, string> = {
    [Stance.MELEE]: "Melee",
    [Stance.RANGED]: "Ranged",
    [Stance.MAGIC]: "Magic",
};

export function stanceDisplayName(stance: Stance): string {
    return STANCE_NAMES[stance];
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
const ACTIVE_STANCE_BORDER_COLOR = "#ffd24d";
const MANA_BLOCK_TINT = "rgba(20, 30, 90, 0.55)";
const COOLDOWN_SWEEP_COLOR = "rgba(0, 0, 0, 0.72)";

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

function drawCooldownSweep(
    ctx: CanvasRenderingContext2D,
    slot: { x: number; y: number; size: number },
    cooldownFraction: number,
): void {
    if (cooldownFraction <= 0) {
        return;
    }
    const cx = slot.x + slot.size / 2;
    const cy = slot.y + slot.size / 2;
    const radius = slot.size * 0.75;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * clamp(cooldownFraction, 0, 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, slot.size, slot.size);
    ctx.clip();
    ctx.fillStyle = COOLDOWN_SWEEP_COLOR;
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

    drawCooldownSweep(ctx, slot, ability.cooldownFraction);

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

    ctx.lineWidth = ability.isActiveStance ? 3 : 2;
    ctx.strokeStyle = ability.isActiveStance
        ? ACTIVE_STANCE_BORDER_COLOR
        : "rgba(120, 96, 60, 0.6)";
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

export function drawStanceLabel(
    ctx: CanvasRenderingContext2D,
    layout: HudLayout,
    width: number,
    stanceName: string,
): void {
    ctx.save();
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#ffd24d";
    const text = `Stance: ${stanceName}`;
    ctx.strokeText(text, width / 2, layout.stanceLabelY);
    ctx.fillText(text, width / 2, layout.stanceLabelY);
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
