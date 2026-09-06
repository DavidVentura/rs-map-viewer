import { worldToScreen } from "../webgl/groundPoint";
import { DamageSplatEvent, HudFrame } from "./HudFrame";
import {
    computeHudLayout,
    drawAbilityBar,
    drawBottomPanel,
    drawDamageSplat,
    drawHealthGlobe,
    drawManaGlobe,
    drawTargetPlate,
} from "./hudDraw";

const DAMAGE_SPLAT_LIFETIME_SECONDS = 1;

type LiveDamageSplat = DamageSplatEvent & { ageSeconds: number };

export class Hud {
    private splats: LiveDamageSplat[] = [];

    constructor(private readonly ctx: CanvasRenderingContext2D) {}

    draw(frame: HudFrame, deltaSeconds: number): void {
        this.spawnSplats(frame.damageEvents);
        this.tickSplats(deltaSeconds);

        const { ctx } = this;
        const { width, height } = frame.screenSize;
        ctx.clearRect(0, 0, width, height);

        const layout = computeHudLayout(width, height);
        drawBottomPanel(ctx, layout);
        drawAbilityBar(ctx, layout);
        if (frame.player) {
            drawHealthGlobe(ctx, layout, frame.player);
            drawManaGlobe(ctx, layout, frame.player);
        }
        if (frame.target) {
            drawTargetPlate(ctx, width, frame.target);
        }
        this.drawSplats(frame);
    }

    private spawnSplats(events: DamageSplatEvent[]): void {
        for (const event of events) {
            this.splats.push({ ...event, ageSeconds: 0 });
        }
    }

    private tickSplats(deltaSeconds: number): void {
        this.splats = this.splats
            .map((splat) => ({ ...splat, ageSeconds: splat.ageSeconds + deltaSeconds }))
            .filter((splat) => splat.ageSeconds < DAMAGE_SPLAT_LIFETIME_SECONDS);
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
            drawDamageSplat(
                this.ctx,
                screen,
                splat.amount,
                splat.factionHit,
                splat.ageSeconds / DAMAGE_SPLAT_LIFETIME_SECONDS,
            );
        }
    }
}
