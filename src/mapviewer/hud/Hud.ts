import { worldToScreen } from "../webgl/groundPoint";
import { HitsplatSlot, pickHitsplatSlot } from "./Hitsplats";
import {
    DamageSplatEvent,
    HealSplatEvent,
    HudFrame,
    PickupFlashEvent,
    SplatEvent,
    SplatKind,
} from "./HudFrame";
import {
    computeHudLayout,
    drawAbilityBar,
    drawBottomPanel,
    drawClickCross,
    drawContextMenu,
    drawContextMenuTooltip,
    drawDamageSplat,
    drawExperienceBar,
    drawGodModeLabel,
    drawHealSplat,
    drawHealthGlobe,
    drawManaGlobe,
    drawOverhead,
    drawPhaseCounter,
    drawPickupFlash,
    drawPreviewSeqLabel,
    drawStyleRow,
    drawUpgradeOverlay,
} from "./hudDraw";

const SPLAT_LIFETIME_SECONDS = 1;

function drawOverheads(ctx: CanvasRenderingContext2D, frame: HudFrame): void {
    const { width, height } = frame.screenSize;
    for (const overhead of frame.overheads) {
        const screen = worldToScreen(
            frame.viewProjMatrix,
            overhead.worldX,
            overhead.worldY,
            overhead.modelTopHeight,
            width,
            height,
        );
        if (screen) {
            drawOverhead(ctx, overhead, screen);
        }
    }
}
const PICKUP_FLASH_LIFETIME_SECONDS = 2;

type LiveHitsplat = DamageSplatEvent & { slot: HitsplatSlot };
type LiveSplat = (HealSplatEvent | LiveHitsplat) & { ageSeconds: number };
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
            drawExperienceBar(ctx, layout, frame.player);
        }
        if (frame.phase) {
            drawPhaseCounter(ctx, width, frame.phase);
        }
        if (frame.godMode) {
            drawGodModeLabel(ctx, width);
        }
        drawOverheads(ctx, frame);
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
            if (event.kind === SplatKind.HEAL) {
                this.splats.push({ ...event, ageSeconds: 0 });
                continue;
            }
            const onTarget = this.splats.filter(
                (splat): splat is LiveHitsplat & { ageSeconds: number } =>
                    splat.kind === SplatKind.DAMAGE && splat.target === event.target,
            );
            const slot = pickHitsplatSlot(onTarget);
            this.splats = this.splats.filter(
                (splat) =>
                    splat.kind !== SplatKind.DAMAGE ||
                    splat.target !== event.target ||
                    splat.slot !== slot,
            );
            this.splats.push({ ...event, slot, ageSeconds: 0 });
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
            const anchor = frame.splatAnchors.get(splat.target);
            if (!anchor) {
                continue;
            }
            const screen = worldToScreen(
                frame.viewProjMatrix,
                anchor.worldX,
                anchor.worldY,
                anchor.height,
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
                    drawDamageSplat(
                        this.ctx,
                        frame.hitsplatSprites,
                        screen,
                        splat.slot,
                        splat.amount,
                    );
                    break;
            }
        }
    }
}
