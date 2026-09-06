export class Projectile {
    static readonly SPEED = 2048;
    static readonly START_HEIGHT = 128;

    x: number;
    y: number;
    height: number = Projectile.START_HEIGHT;

    private age = 0;
    private readonly duration: number;
    private readonly arcHeight: number;

    constructor(
        readonly startX: number,
        readonly startY: number,
        readonly level: number,
        readonly targetX: number,
        readonly targetY: number,
        readonly targetHeight: number,
        readonly rotation: number,
    ) {
        this.x = startX;
        this.y = startY;
        const distance = Math.hypot(targetX - startX, targetY - startY);
        this.duration = distance / Projectile.SPEED;
        this.arcHeight = Math.min(256 + distance * 0.15, 768);
    }

    update(deltaTimeSeconds: number): boolean {
        this.age += deltaTimeSeconds;
        const progress = Math.min(this.age / this.duration, 1);
        this.x = this.startX + (this.targetX - this.startX) * progress;
        this.y = this.startY + (this.targetY - this.startY) * progress;
        this.height =
            Projectile.START_HEIGHT +
            (this.targetHeight - Projectile.START_HEIGHT) * progress +
            this.arcHeight * 4 * progress * (1 - progress);
        return progress < 1;
    }
}
