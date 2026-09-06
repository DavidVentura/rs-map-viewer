import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityDefinition, AbilityTarget, WeaponStyle } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { AnimationPlayback, AnimationState, sequenceDurationSeconds } from "./Animation";
import { Combatant, Faction, ManaPool } from "./Combatant";
import { Terrain } from "./Terrain";
import { buildPlayerAbilityBar } from "./abilities";
import { AbilitySlotReadiness, computeSlotReadiness } from "./abilityRules";
import { resolveMovement } from "./movement";
import { directionToRotation } from "./projectileMath";

export type PlayerInput = {
    x: number;
    y: number;
    running: boolean;
};

export type StanceSeqIds = {
    readonly idleSeqId: number;
    readonly walkSeqId: number;
    readonly runSeqId: number;
    readonly attackSeqId: number;
};

export type StanceSeqIdsByStance = Record<WeaponStyle, StanceSeqIds>;

type PendingStyleSwitch = {
    readonly style: WeaponStyle;
    readonly readyAt: number;
};

export class Player implements Combatant, ManaPool {
    static readonly HIT_RADIUS = 64;
    static readonly MAX_HEALTH = 100;
    static readonly MAX_MANA = 100;
    static readonly MANA_REGEN_PER_SECOND = 4;
    static readonly STYLE_SWITCH_SECONDS = 1;

    readonly faction = Faction.PLAYER;
    readonly hitRadius = Player.HIT_RADIUS;
    readonly maxHealth = Player.MAX_HEALTH;
    health = Player.MAX_HEALTH;
    readonly maxMana = Player.MAX_MANA;
    mana = Player.MAX_MANA;

    static readonly WALK_SPEED = 288 * 1.6;
    static readonly RUN_SPEED = 576 * 1.6;

    rotation = 0;

    private castAnimationEndsAt?: number;
    private castAnimationSpeed = 1;
    private pendingStyleSwitch?: PendingStyleSwitch;
    style: WeaponStyle = WeaponStyle.RANGED;
    readonly animation: AnimationState;
    readonly abilityRuntime = new AbilityRuntime();

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly styleSeqIds: StanceSeqIdsByStance,
    ) {
        this.animation = new AnimationState(this.activeSeqIds.idleSeqId);
    }

    private get activeSeqIds(): StanceSeqIds {
        return this.styleSeqIds[this.style];
    }

    get idleSeqId(): number {
        return this.activeSeqIds.idleSeqId;
    }

    get walkSeqId(): number {
        return this.activeSeqIds.walkSeqId;
    }

    get runSeqId(): number {
        return this.activeSeqIds.runSeqId;
    }

    get attackSeqId(): number {
        return this.activeSeqIds.attackSeqId;
    }

    get abilityBar(): readonly AbilityDefinition[] {
        return buildPlayerAbilityBar(this.style);
    }

    getSlotReadiness(slot: number, timeSeconds: number): AbilitySlotReadiness {
        const definition = this.abilityBar[slot];
        return computeSlotReadiness(
            definition,
            this.abilityRuntime.chargeStateFor(definition),
            this.mana,
            timeSeconds,
        );
    }

    canUseSlotIgnoringTarget(slot: number, timeSeconds: number): boolean {
        if (this.isSwitchingStyle(timeSeconds)) {
            return false;
        }
        return this.abilityRuntime.canUse(this.abilityBar[slot], this.mana, timeSeconds);
    }

    isBusy(timeSeconds: number): boolean {
        return this.abilityRuntime.isBusy(timeSeconds) || this.isSwitchingStyle(timeSeconds);
    }

    isSwitchingStyle(timeSeconds: number): boolean {
        return (
            this.pendingStyleSwitch !== undefined && timeSeconds < this.pendingStyleSwitch.readyAt
        );
    }

    styleSwitchProgress(timeSeconds: number): number | undefined {
        if (!this.isSwitchingStyle(timeSeconds)) {
            return undefined;
        }
        const remaining = this.pendingStyleSwitch!.readyAt - timeSeconds;
        return 1 - remaining / Player.STYLE_SWITCH_SECONDS;
    }

    pendingStyle(timeSeconds: number): WeaponStyle | undefined {
        if (!this.pendingStyleSwitch || timeSeconds >= this.pendingStyleSwitch.readyAt) {
            return undefined;
        }
        return this.pendingStyleSwitch.style;
    }

    requestStyleSwitch(style: WeaponStyle, timeSeconds: number): void {
        if (style === this.style || this.isBusy(timeSeconds)) {
            return;
        }
        this.pendingStyleSwitch = { style, readyAt: timeSeconds + Player.STYLE_SWITCH_SECONDS };
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

        if (this.pendingStyleSwitch) {
            if (timeSeconds >= this.pendingStyleSwitch.readyAt) {
                this.style = this.pendingStyleSwitch.style;
                this.pendingStyleSwitch = undefined;
            } else {
                this.animation.setSequence(this.idleSeqId);
                this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
                return;
            }
        }

        const castEndsAt = this.abilityRuntime.castEndsAt();
        if (castEndsAt !== undefined && timeSeconds < castEndsAt) {
            if (this.castAnimationEndsAt !== castEndsAt) {
                this.castAnimationEndsAt = castEndsAt;
                const castSeqId =
                    this.abilityRuntime.pendingDefinition()?.castSeqId ?? this.attackSeqId;
                this.animation.restart(castSeqId);
                this.castAnimationSpeed =
                    sequenceDurationSeconds(castSeqId, seqTypeLoader, seqFrameLoader) /
                    (castEndsAt - timeSeconds);
            }
            this.animation.advance(
                deltaTimeSeconds,
                seqTypeLoader,
                seqFrameLoader,
                AnimationPlayback.ONCE,
                this.castAnimationSpeed,
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
        this.rotation = directionToRotation(input.x, input.y);
        this.animation.setSequence(input.running ? this.runSeqId : this.walkSeqId);
        this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
    }

    beginCast(definition: AbilityDefinition, target: AbilityTarget, timeSeconds: number): void {
        this.mana -= definition.manaCost;
        this.abilityRuntime.use(definition, target, timeSeconds);
        const deltaX = target.x - this.x;
        const deltaY = target.y - this.y;
        if (deltaX !== 0 || deltaY !== 0) {
            this.rotation = directionToRotation(deltaX, deltaY);
        }
    }
}
