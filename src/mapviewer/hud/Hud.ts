import { worldRadiusToScreenPx, worldToScreen } from "../webgl/groundPoint";
import { HudFrame, PickupFlashEvent, SplatEvent, SplatKind } from "./HudFrame";
import {
    computeHudLayout,
    drawAbilityBar,
    drawBossBar,
    drawBottomPanel,
    drawDamageSplat,
    drawGodModeLabel,
    drawGroundImpactFlash,
    drawGroundItemLabel,
    drawGroundShadow,
    drawHealSplat,
    drawHealthGlobe,
    drawManaGlobe,
    drawPickupFlash,
    drawPreviewSeqLabel,
    drawStyleRow,
    drawTargetPlate,
    drawUpgradeOverlay,
    drawWaveCounter,
} from "./hudDraw";

const SPLAT_LIFETIME_SECONDS = 1;
const GROUND_IMPACT_LIFETIME_SECONDS = 0.25;
const PICKUP_FLASH_LIFETIME_SECONDS = 2;

function splatLifetimeSeconds(kind: SplatKind): number {
    switch (kind) {
        case SplatKind.GROUND_IMPACT:
            return GROUND_IMPACT_LIFETIME_SECONDS;
        default:
            return SPLAT_LIFETIME_SECONDS;
    }
}

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

        this.drawGroundShadows(frame);
        this.drawGroundItemLabels(frame);

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
        }
        if (frame.target) {
            drawTargetPlate(ctx, width, frame.target);
        }
        if (frame.wave) {
            drawWaveCounter(ctx, width, frame.wave);
        }
        if (frame.godMode) {
            drawGodModeLabel(ctx, width);
        }
        if (frame.boss) {
            drawBossBar(ctx, width, frame.boss);
        }
        this.drawSplats(frame);
        this.drawPickupFlashes(width);
        if (frame.upgradeOffer) {
            drawUpgradeOverlay(ctx, width, height, layout, frame.upgradeOffer.cards);
        }
        if (frame.previewSeqId !== undefined) {
            drawPreviewSeqLabel(ctx, width, frame.previewSeqId);
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
            .filter((splat) => splat.ageSeconds < splatLifetimeSeconds(splat.kind));
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

    private drawGroundShadows(frame: HudFrame): void {
        for (const shadow of frame.groundShadows) {
            drawGroundShadow(
                this.ctx,
                { x: shadow.screenX, y: shadow.screenY },
                shadow.radiusPx,
                shadow.progress,
            );
        }
    }

    private drawGroundItemLabels(frame: HudFrame): void {
        for (const item of frame.groundItems) {
            drawGroundItemLabel(this.ctx, { x: item.screenX, y: item.screenY }, item);
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
            const progress = splat.ageSeconds / splatLifetimeSeconds(splat.kind);
            switch (splat.kind) {
                case SplatKind.HEAL:
                    drawHealSplat(this.ctx, screen, splat.amount, progress);
                    break;
                case SplatKind.DAMAGE:
                    drawDamageSplat(this.ctx, screen, splat.amount, splat.factionHit, progress);
                    break;
                case SplatKind.GROUND_IMPACT: {
                    const radiusPx = worldRadiusToScreenPx(
                        frame.viewProjMatrix,
                        splat.worldX,
                        splat.worldY,
                        splat.groundHeight,
                        splat.radius,
                        width,
                        height,
                    );
                    if (radiusPx !== undefined) {
                        drawGroundImpactFlash(this.ctx, screen, radiusPx, progress);
                    }
                    break;
                }
            }
        }
    }
}
