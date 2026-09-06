import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationPlayback, AnimationState } from "./Animation";
import { Combatant, Faction } from "./Combatant";
import { Terrain } from "./Terrain";
import { resolveMovement } from "./movement";

export type PlayerInput = {
    x: number;
    y: number;
    running: boolean;
};

export class Player implements Combatant {
    static readonly HIT_RADIUS = 64;
    static readonly MAX_HEALTH = 100;

    readonly faction = Faction.PLAYER;
    readonly hitRadius = Player.HIT_RADIUS;
    readonly maxHealth = Player.MAX_HEALTH;
    health = Player.MAX_HEALTH;

    static readonly WALK_SPEED = 288 * 1.6;
    static readonly RUN_SPEED = 576 * 1.6;
    static readonly ATTACK_COOLDOWN_SECONDS = 0.2;
    static readonly ATTACK_ANIMATION_SPEED = 4;

    rotation = 0;
    readonly animation: AnimationState;

    private nextAttackTime = 0;
    private attackActive = false;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly idleSeqId: number,
        readonly walkSeqId: number,
        readonly runSeqId: number,
        readonly attackSeqId: number,
    ) {
        this.animation = new AnimationState(idleSeqId);
    }

    update(
        input: PlayerInput,
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        terrain: Terrain,
    ): void {
        if (this.attackActive) {
            if (
                !this.animation.advance(
                    deltaTimeSeconds,
                    seqTypeLoader,
                    seqFrameLoader,
                    AnimationPlayback.LOOP,
                    Player.ATTACK_ANIMATION_SPEED,
                )
            ) {
                return;
            }
            this.attackActive = false;
        }

        const length = Math.hypot(input.x, input.y);
        if (length === 0) {
            this.animation.setSequence(this.idleSeqId);
            this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        const speed = input.running ? Player.RUN_SPEED : Player.WALK_SPEED;
        const scale = (speed * deltaTimeSeconds) / length;
        const position = resolveMovement(
            terrain,
            this.level,
            this.x,
            this.y,
            input.x * scale,
            input.y * scale,
        );
        this.x = position.x;
        this.y = position.y;
        this.rotation = ((Math.atan2(input.x, input.y) / (Math.PI * 2)) * 2048 + 1024) & 2047;
        this.animation.setSequence(input.running ? this.runSeqId : this.walkSeqId);
        this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
    }

    isAttackReady(timeSeconds: number): boolean {
        return timeSeconds >= this.nextAttackTime;
    }

    attack(timeSeconds: number, rotation: number): void {
        this.nextAttackTime = timeSeconds + Player.ATTACK_COOLDOWN_SECONDS;
        this.rotation = (rotation + 1024) & 2047;
        this.attackActive = true;
        this.animation.setSequence(this.attackSeqId);
    }
}
