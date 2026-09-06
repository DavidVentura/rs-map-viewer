import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityDefinition, AbilityTarget, Stance } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { AnimationPlayback, AnimationState } from "./Animation";
import { Combatant, Faction, ManaPool } from "./Combatant";
import { Terrain } from "./Terrain";
import { PLAYER_ABILITY_BAR } from "./abilities";
import { resolveMovement } from "./movement";
import { computeFacingRotation } from "./projectileMath";

export type PlayerInput = {
    x: number;
    y: number;
    running: boolean;
};

export class Player implements Combatant, ManaPool {
    static readonly HIT_RADIUS = 64;
    static readonly MAX_HEALTH = 100;
    static readonly MAX_MANA = 100;
    static readonly MANA_REGEN_PER_SECOND = 4;

    readonly faction = Faction.PLAYER;
    readonly hitRadius = Player.HIT_RADIUS;
    readonly maxHealth = Player.MAX_HEALTH;
    health = Player.MAX_HEALTH;
    readonly maxMana = Player.MAX_MANA;
    mana = Player.MAX_MANA;

    static readonly WALK_SPEED = 288 * 1.6;
    static readonly RUN_SPEED = 576 * 1.6;
    static readonly ATTACK_ANIMATION_SPEED = 4;

    rotation = 0;
    stance: Stance = Stance.RANGED;
    readonly animation: AnimationState;
    readonly abilityRuntime = new AbilityRuntime();
    readonly abilityBar: readonly AbilityDefinition[] = PLAYER_ABILITY_BAR;

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
        timeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        terrain: Terrain,
    ): void {
        this.mana = Math.min(
            this.maxMana,
            this.mana + Player.MANA_REGEN_PER_SECOND * deltaTimeSeconds,
        );

        if (this.abilityRuntime.isBusy(timeSeconds)) {
            this.animation.setSequence(this.attackSeqId);
            this.animation.advance(
                deltaTimeSeconds,
                seqTypeLoader,
                seqFrameLoader,
                AnimationPlayback.LOOP,
                Player.ATTACK_ANIMATION_SPEED,
            );
            return;
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

    beginCast(definition: AbilityDefinition, target: AbilityTarget, timeSeconds: number): void {
        this.mana -= definition.manaCost;
        this.abilityRuntime.use(definition, target, timeSeconds);
        const deltaX = target.x - this.x;
        const deltaY = target.y - this.y;
        if (deltaX !== 0 || deltaY !== 0) {
            this.rotation = computeFacingRotation(deltaX, deltaY);
        }
    }
}
