import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { Combatant, Faction } from "./Combatant";
import { Enemy } from "./Enemy";
import { Player, PlayerInput } from "./Player";
import { ARROW_SPEC, Projectile } from "./Projectile";
import { Terrain } from "./Terrain";
import { directionToRotation } from "./projectileMath";
import { resolveSpawn } from "./spawn";

export type AttackRequest = {
    targetX: number;
    targetY: number;
};

export type SimInput = {
    movement: PlayerInput;
    attackRequest?: AttackRequest;
};

export class GameWorld {
    static readonly FIXED_STEP_SECONDS = 1 / 120;
    static readonly MAX_ACCUMULATED_SECONDS = 0.1;
    static readonly MAX_PROJECTILES = 32;

    timeSeconds = 0;
    player?: Player;
    enemies: Enemy[] = [];
    projectiles: Projectile[] = [];

    private accumulatedSeconds = 0;
    private nextEnemyId = 1;
    private queuedAttackRequest?: AttackRequest;

    constructor(
        private readonly terrain: Terrain,
        private readonly seqTypeLoader: SeqTypeLoader,
        private readonly seqFrameLoader: SeqFrameLoader,
    ) {}

    spawnPlayer(
        x: number,
        y: number,
        level: number,
        idleSeqId: number,
        walkSeqId: number,
        runSeqId: number,
        attackSeqId: number,
    ): void {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        this.player = new Player(
            spawn.x,
            spawn.y,
            level,
            idleSeqId,
            walkSeqId,
            runSeqId,
            attackSeqId,
        );
    }

    spawnEnemy(
        x: number,
        y: number,
        level: number,
        idleSeqId: number,
        walkSeqId: number,
        deathSeqId: number,
    ): void {
        const spawn = resolveSpawn(this.terrain, level, x, y);
        this.enemies.push(
            new Enemy(
                this.nextEnemyId++,
                spawn.x,
                spawn.y,
                level,
                spawn.x,
                spawn.y,
                idleSeqId,
                walkSeqId,
                deathSeqId,
            ),
        );
    }

    findEnemy(id: number): Enemy | undefined {
        return this.enemies.find((enemy) => enemy.id === id);
    }

    combatants(): Combatant[] {
        const combatants: Combatant[] = [...this.enemies];
        if (this.player) {
            combatants.push(this.player);
        }
        return combatants;
    }

    advance(deltaSeconds: number, input: SimInput): void {
        if (input.attackRequest) {
            this.queuedAttackRequest = input.attackRequest;
        }
        this.accumulatedSeconds += Math.min(deltaSeconds, GameWorld.MAX_ACCUMULATED_SECONDS);
        while (this.accumulatedSeconds >= GameWorld.FIXED_STEP_SECONDS) {
            this.step(input.movement, GameWorld.FIXED_STEP_SECONDS);
            this.accumulatedSeconds -= GameWorld.FIXED_STEP_SECONDS;
        }
    }

    step(movement: PlayerInput, dtSeconds: number): void {
        this.timeSeconds += dtSeconds;

        const attackRequest = this.queuedAttackRequest;
        this.queuedAttackRequest = undefined;
        if (this.player && attackRequest) {
            this.tryAttack(this.player, attackRequest);
        }

        if (this.player) {
            this.player.update(
                movement,
                dtSeconds,
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.terrain,
            );
        }

        for (const enemy of this.enemies) {
            enemy.update(
                this.player,
                dtSeconds,
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.terrain,
            );
        }

        const combatants = this.combatants();
        this.projectiles = this.projectiles.filter((projectile) =>
            projectile.update(dtSeconds, combatants),
        );
    }

    private tryAttack(player: Player, request: AttackRequest): void {
        const deltaX = request.targetX - player.x;
        const deltaY = request.targetY - player.y;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance === 0 || !player.isAttackReady(this.timeSeconds)) {
            return;
        }

        const rotation = directionToRotation(deltaX, deltaY);
        player.attack(this.timeSeconds, rotation);

        if (this.projectiles.length >= GameWorld.MAX_PROJECTILES) {
            return;
        }
        this.projectiles.push(
            new Projectile(
                ARROW_SPEC,
                Faction.PLAYER,
                player.level,
                player.x + (deltaX / distance) * 48,
                player.y + (deltaY / distance) * 48,
                deltaX,
                deltaY,
                distance,
            ),
        );
    }
}
