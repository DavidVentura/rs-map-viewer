import { worldRadiusToScreenPx, worldToScreen } from "../webgl/groundPoint";
import { HudFrame, SplatEvent, SplatKind } from "./HudFrame";
import {
    computeHudLayout,
    drawAbilityBar,
    drawBottomPanel,
    drawDamageSplat,
    drawGroundImpactFlash,
    drawGroundShadow,
    drawHealSplat,
    drawHealthGlobe,
    drawManaGlobe,
    drawStyleRow,
    drawStyleSwitchLabel,
    drawTargetPlate,
    drawUpgradeOverlay,
    drawWaveCounter,
    styleDisplayName,
} from "./hudDraw";

const SPLAT_LIFETIME_SECONDS = 1;
const GROUND_IMPACT_LIFETIME_SECONDS = 0.25;

function splatLifetimeSeconds(kind: SplatKind): number {
    return kind === SplatKind.GROUND_IMPACT
        ? GROUND_IMPACT_LIFETIME_SECONDS
        : SPLAT_LIFETIME_SECONDS;
}

type LiveSplat = SplatEvent & { ageSeconds: number };

export class Hud {
    private splats: LiveSplat[] = [];

    constructor(private readonly ctx: CanvasRenderingContext2D) {}

    draw(frame: HudFrame, deltaSeconds: number): void {
        this.spawnSplats(frame.splatEvents);
        this.tickSplats(deltaSeconds);

        const { ctx } = this;
        const { width, height } = frame.screenSize;
        ctx.clearRect(0, 0, width, height);

        this.drawGroundShadows(frame);

        const layout = computeHudLayout(
            width,
            height,
            frame.abilities.length,
            frame.upgradeOffer?.cards.length ?? 0,
        );
        drawBottomPanel(ctx, layout);
        drawAbilityBar(ctx, layout, frame.abilities);
        if (frame.activeStyle !== undefined) {
            drawStyleRow(ctx, layout, frame.activeStyle, frame.styleSwitch);
        }
        if (frame.styleSwitch) {
            drawStyleSwitchLabel(ctx, layout, width, styleDisplayName(frame.styleSwitch.target));
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
        this.drawSplats(frame);
        if (frame.upgradeOffer) {
            drawUpgradeOverlay(ctx, width, height, layout, frame.upgradeOffer.cards);
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
