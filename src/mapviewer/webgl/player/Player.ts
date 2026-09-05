import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { AnimationFrames } from "../AnimationFrames";

export type PlayerInput = {
    x: number;
    y: number;
    running: boolean;
};

export class Player {
    static readonly WALK_SPEED = 192;
    static readonly RUN_SPEED = 384;
    static readonly MAP_SIZE = 64 * 128;

    rotation = 0;
    movementFrame = 0;

    private animationFrameTime = 0;
    private animationSeqId: number;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly id: number,
        readonly idleAnim: AnimationFrames,
        readonly walkAnim: AnimationFrames,
        readonly runAnim: AnimationFrames,
        readonly idleSeqId: number,
        readonly walkSeqId: number,
        readonly runSeqId: number,
    ) {
        this.animationSeqId = idleSeqId;
    }

    update(
        input: PlayerInput,
        deltaTimeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): void {
        const length = Math.hypot(input.x, input.y);
        if (length === 0) {
            this.setAnimation(this.idleSeqId);
            this.advanceAnimation(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        const speed = input.running ? Player.RUN_SPEED : Player.WALK_SPEED;
        const scale = (speed * deltaTimeSeconds) / length;
        this.x = Math.min(Math.max(this.x + input.x * scale, 64), Player.MAP_SIZE - 64);
        this.y = Math.min(Math.max(this.y + input.y * scale, 64), Player.MAP_SIZE - 64);
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
        return this.idleAnim;
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
    ): void {
        const sequence = seqTypeLoader.load(this.animationSeqId);
        if (!sequence.frameIds || sequence.frameIds.length === 0) {
            return;
        }

        this.animationFrameTime += deltaTimeSeconds / 0.02;
        while (
            this.animationFrameTime > sequence.getFrameLength(seqFrameLoader, this.movementFrame)
        ) {
            this.animationFrameTime -= sequence.getFrameLength(seqFrameLoader, this.movementFrame);
            this.movementFrame = (this.movementFrame + 1) % sequence.frameIds.length;
        }
    }
}
