import { worldToScreen } from "../webgl/groundPoint";
import { HudFrame, SplatEvent, SplatKind } from "./HudFrame";
import {
    computeHudLayout,
    drawAbilityBar,
    drawBottomPanel,
    drawDamageSplat,
    drawFrozenSplat,
    drawHealSplat,
    drawHealthGlobe,
    drawManaGlobe,
    drawStyleRow,
    drawStyleSwitchLabel,
    drawTargetPlate,
    styleDisplayName,
} from "./hudDraw";

const SPLAT_LIFETIME_SECONDS = 1;

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

        const layout = computeHudLayout(width, height, frame.abilities.length);
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
        this.drawSplats(frame);
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
                case SplatKind.FROZEN:
                    drawFrozenSplat(this.ctx, screen, progress);
                    break;
                case SplatKind.DAMAGE:
                    drawDamageSplat(this.ctx, screen, splat.amount, splat.factionHit, progress);
                    break;
            }
        }
    }
}
