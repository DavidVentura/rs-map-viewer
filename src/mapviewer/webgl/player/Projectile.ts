export class Projectile {
    static readonly SPEED = 1024;
    static readonly LIFETIME_SECONDS = 1.2;

    age = 0;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly rotation: number,
        readonly velocityX: number,
        readonly velocityY: number,
    ) {}

    update(deltaTimeSeconds: number): boolean {
        this.x += this.velocityX * deltaTimeSeconds;
        this.y += this.velocityY * deltaTimeSeconds;
        this.age += deltaTimeSeconds;
        return this.age < Projectile.LIFETIME_SECONDS;
    }
}
