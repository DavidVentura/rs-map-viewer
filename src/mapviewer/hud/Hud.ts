import { worldToScreen } from "../webgl/groundPoint";
import { HudFrame, PickupFlashEvent, SplatEvent, SplatKind } from "./HudFrame";
import {
    computeHudLayout,
    drawAbilityBar,
    drawBossBar,
    drawBottomPanel,
    drawClickCross,
    drawContextMenu,
    drawContextMenuTooltip,
    drawDamageSplat,
    drawGodModeLabel,
    drawHealSplat,
    drawHealthGlobe,
    drawLevelProgress,
    drawManaGlobe,
    drawOverheadIcon,
    drawPhaseCounter,
    drawPickupFlash,
    drawPreviewSeqLabel,
    drawStyleRow,
    drawTargetPlate,
    drawUpgradeOverlay,
} from "./hudDraw";

const SPLAT_LIFETIME_SECONDS = 1;

function drawOverheadIcons(ctx: CanvasRenderingContext2D, frame: HudFrame): void {
    const { width, height } = frame.screenSize;
    for (const overhead of frame.overheadIcons) {
        const screen = worldToScreen(
            frame.viewProjMatrix,
            overhead.worldX,
            overhead.worldY,
            overhead.height,
            width,
            height,
        );
        if (screen) {
            drawOverheadIcon(ctx, overhead.icon, screen);
        }
    }
}
const PICKUP_FLASH_LIFETIME_SECONDS = 2;

type LiveSplat = SplatEvent & { ageSeconds: number };
type LivePickupFlash = PickupFlashEvent & { ageSeconds: number };

export class Hud {
    private splats: LiveSplat[] = [];
    private pickupFlashes: LivePickupFlash[] = [];

    constructor(private readonly ctx: CanvasRenderingContext2D) {}

    draw(frame: HudFrame, deltaSeconds: number): void {
        this.spawnSplats(frame.splatEvents);
        this.tickSplats(deltaSeconds);
        this.spawnPickupFlashes(frame.pickupFlashEvents);
        this.tickPickupFlashes(deltaSeconds);

        const { ctx } = this;
        const { width, height } = frame.screenSize;
        ctx.clearRect(0, 0, width, height);

        const layout = computeHudLayout(
            width,
            height,
            frame.abilities.length,
            frame.upgradeOffer?.cards.length ?? 0,
        );
        drawBottomPanel(ctx, layout);
        drawAbilityBar(ctx, layout, frame.abilities);
        if (frame.activeStyle !== undefined) {
            drawStyleRow(ctx, layout, frame.activeStyle);
        }
        if (frame.player) {
            drawHealthGlobe(ctx, layout, frame.player);
            drawManaGlobe(ctx, layout, frame.player);
            drawLevelProgress(ctx, width, frame.player);
        }
        if (frame.target) {
            drawTargetPlate(ctx, width, frame.target);
        }
        if (frame.phase) {
            drawPhaseCounter(ctx, width, frame.phase);
        }
        if (frame.godMode) {
            drawGodModeLabel(ctx, width);
        }
        if (frame.boss) {
            drawBossBar(ctx, width, frame.boss);
        }
        drawOverheadIcons(ctx, frame);
        this.drawSplats(frame);
        this.drawPickupFlashes(width);
        if (frame.upgradeOffer) {
            drawUpgradeOverlay(ctx, width, height, layout, frame.upgradeOffer.cards);
        }
        if (frame.previewSeqId !== undefined) {
            drawPreviewSeqLabel(ctx, width, frame.previewSeqId);
        }
        if (frame.clickCross) {
            drawClickCross(ctx, frame.crossSprites, frame.clickCross);
        }
        if (frame.contextMenu) {
            drawContextMenu(
                ctx,
                frame.contextMenu.entries,
                frame.contextMenu.anchor,
                frame.screenSize,
                frame.contextMenu.hoveredIndex,
            );
        } else if (frame.contextMenuTooltip) {
            drawContextMenuTooltip(
                ctx,
                frame.contextMenuTooltip.entries,
                frame.contextMenuTooltip.anchor,
                frame.screenSize,
            );
        }
    }

    private spawnSplats(events: SplatEvent[]): void {
        for (const event of events) {
            this.splats.push({ ...event, ageSeconds: 0 });
        }
    }

    private tickSplats(deltaSeconds: number): void {
        this.splats = this.splats
            .map((splat) => ({ ...splat, ageSeconds: splat.ageSeconds + deltaSeconds }))
            .filter((splat) => splat.ageSeconds < SPLAT_LIFETIME_SECONDS);
    }

    private spawnPickupFlashes(events: PickupFlashEvent[]): void {
        for (const event of events) {
            this.pickupFlashes.push({ ...event, ageSeconds: 0 });
        }
    }

    private tickPickupFlashes(deltaSeconds: number): void {
        this.pickupFlashes = this.pickupFlashes
            .map((flash) => ({ ...flash, ageSeconds: flash.ageSeconds + deltaSeconds }))
            .filter((flash) => flash.ageSeconds < PICKUP_FLASH_LIFETIME_SECONDS);
    }

    private drawPickupFlashes(width: number): void {
        for (const flash of this.pickupFlashes) {
            drawPickupFlash(
                this.ctx,
                width,
                flash.text,
                flash.ageSeconds / PICKUP_FLASH_LIFETIME_SECONDS,
            );
        }
    }

    private drawSplats(frame: HudFrame): void {
        const { width, height } = frame.screenSize;
        for (const splat of this.splats) {
            const screen = worldToScreen(
                frame.viewProjMatrix,
                splat.worldX,
                splat.worldY,
                splat.groundHeight,
                width,
                height,
            );
            if (!screen) {
                continue;
            }
            const progress = splat.ageSeconds / SPLAT_LIFETIME_SECONDS;
            switch (splat.kind) {
                case SplatKind.HEAL:
                    drawHealSplat(this.ctx, screen, splat.amount, progress);
                    break;
                case SplatKind.DAMAGE:
                    drawDamageSplat(this.ctx, screen, splat.amount, splat.factionHit, progress);
                    break;
            }
        }
    }
}
