import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { AnimationFrames } from "../AnimationFrames";

export type PlayerInput = {
    x: number;
    y: number;
    running: boolean;
};

export type PlayerMovementResolver = (
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
) => { x: number; y: number };

export class Player {
    static readonly WALK_SPEED = 288;
    static readonly RUN_SPEED = 576;
    static readonly ATTACK_COOLDOWN_SECONDS = 0.2;
    static readonly ATTACK_ANIMATION_SPEED = 4;

    rotation = 0;
    movementFrame = 0;

    private animationFrameTime = 0;
    private animationSeqId: number;
    private nextAttackTime = 0;
    private attackActive = false;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly id: number,
        readonly idleAnim: AnimationFrames,
        readonly walkAnim: AnimationFrames,
        readonly runAnim: AnimationFrames,
        readonly attackAnim: AnimationFrames,
        readonly idleSeqId: number,
        readonly walkSeqId: number,
        readonly runSeqId: number,
        readonly attackSeqId: number,
    ) {
        this.animationSeqId = idleSeqId;
    }

    update(
        input: PlayerInput,
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        resolveMovement: PlayerMovementResolver,
    ): void {
        if (this.attackActive) {
            if (
                !this.advanceAnimation(
                    deltaTimeSeconds,
                    seqTypeLoader,
                    seqFrameLoader,
                    Player.ATTACK_ANIMATION_SPEED,
                )
            ) {
                return;
            }
            this.attackActive = false;
        }

        const length = Math.hypot(input.x, input.y);
        if (length === 0) {
            this.setAnimation(this.idleSeqId);
            this.advanceAnimation(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        const speed = input.running ? Player.RUN_SPEED : Player.WALK_SPEED;
        const scale = (speed * deltaTimeSeconds) / length;
        const position = resolveMovement(this.x, this.y, input.x * scale, input.y * scale);
        this.x = position.x;
        this.y = position.y;
        this.rotation = ((Math.atan2(input.x, input.y) / (Math.PI * 2)) * 2048 + 1024) & 2047;
        this.setAnimation(input.running ? this.runSeqId : this.walkSeqId);
        this.advanceAnimation(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
    }

    getAnimationFrames(): AnimationFrames {
        if (this.animationSeqId === this.walkSeqId) {
            return this.walkAnim;
        }
        if (this.animationSeqId === this.runSeqId) {
            return this.runAnim;
        }
        if (this.animationSeqId === this.attackSeqId) {
            return this.attackAnim;
        }
        return this.idleAnim;
    }

    canAttack(timeSeconds: number): boolean {
        if (timeSeconds < this.nextAttackTime) {
            return false;
        }
        this.nextAttackTime = timeSeconds + Player.ATTACK_COOLDOWN_SECONDS;
        return true;
    }

    attack(rotation: number): void {
        this.rotation = (rotation + 1024) & 2047;
        this.attackActive = true;
        this.setAnimation(this.attackSeqId);
    }

    private setAnimation(seqId: number): void {
        if (this.animationSeqId === seqId) {
            return;
        }
        this.animationSeqId = seqId;
        this.movementFrame = 0;
        this.animationFrameTime = 0;
    }

    private advanceAnimation(
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        speed: number = 1,
    ): boolean {
        const sequence = seqTypeLoader.load(this.animationSeqId);
        if (!sequence.frameIds || sequence.frameIds.length === 0) {
            return true;
        }

        let completed = false;
        this.animationFrameTime += (deltaTimeSeconds / 0.02) * speed;
        while (
            this.animationFrameTime > sequence.getFrameLength(seqFrameLoader, this.movementFrame)
        ) {
            this.animationFrameTime -= sequence.getFrameLength(seqFrameLoader, this.movementFrame);
            this.movementFrame = (this.movementFrame + 1) % sequence.frameIds.length;
            completed ||= this.movementFrame === 0;
        }
        return completed;
    }
}
