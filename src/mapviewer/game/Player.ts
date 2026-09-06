import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityDefinition, AbilityTarget, WeaponStyle } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { AnimationPlayback, AnimationState, sequenceDurationSeconds } from "./Animation";
import { Combatant, Faction, ManaPool } from "./Combatant";
import { Terrain } from "./Terrain";
import { STYLE_SWITCH_SEQ_IDS, buildPlayerAbilityBar } from "./abilities";
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
    static readonly DEATH_SEQ_ID = 836;
    static readonly DEATH_SECONDS = 2;

    readonly faction = Faction.PLAYER;
    readonly hitRadius = Player.HIT_RADIUS;
    readonly maxHealth = Player.MAX_HEALTH;
    health = Player.MAX_HEALTH;
    readonly maxMana = Player.MAX_MANA;
    mana = Player.MAX_MANA;

    readonly spawnX: number;
    readonly spawnY: number;

    static readonly WALK_SPEED = 288 * 1.6;
    static readonly RUN_SPEED = 576 * 1.6;

    rotation = 0;

    private castAnimationEndsAt?: number;
    private castAnimationSpeed = 1;
    private switchAnimationEndsAt?: number;
    private switchAnimationSpeed = 1;
    private pendingStyleSwitch?: PendingStyleSwitch;
    private deadUntil?: number;
    style: WeaponStyle = WeaponStyle.RANGED;
    readonly animation: AnimationState;
    readonly abilityRuntime = new AbilityRuntime();

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly styleSeqIds: StanceSeqIdsByStance,
    ) {
        this.spawnX = x;
        this.spawnY = y;
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

    isDead(timeSeconds: number): boolean {
        return this.deadUntil !== undefined && timeSeconds < this.deadUntil;
    }

    isAwaitingRespawn(timeSeconds: number): boolean {
        return this.deadUntil !== undefined && timeSeconds >= this.deadUntil;
    }

    hasDied(): boolean {
        return this.deadUntil !== undefined;
    }

    die(timeSeconds: number): void {
        this.health = 0;
        this.deadUntil = timeSeconds + Player.DEATH_SECONDS;
        this.animation.restart(Player.DEATH_SEQ_ID);
    }

    respawn(): void {
        this.x = this.spawnX;
        this.y = this.spawnY;
        this.health = this.maxHealth;
        this.mana = this.maxMana;
        this.deadUntil = undefined;
        this.pendingStyleSwitch = undefined;
        this.castAnimationEndsAt = undefined;
        this.switchAnimationEndsAt = undefined;
        this.abilityRuntime.reset();
        this.animation.restart(this.idleSeqId);
    }

    update(
        input: PlayerInput,
        deltaTimeSeconds: number,
        timeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        terrain: Terrain,
    ): void {
        if (this.isDead(timeSeconds)) {
            this.animation.advance(
                deltaTimeSeconds,
                seqTypeLoader,
                seqFrameLoader,
                AnimationPlayback.ONCE,
            );
            return;
        }

        this.mana = Math.min(
            this.maxMana,
            this.mana + Player.MANA_REGEN_PER_SECOND * deltaTimeSeconds,
        );

        if (this.pendingStyleSwitch) {
            if (timeSeconds >= this.pendingStyleSwitch.readyAt) {
                this.style = this.pendingStyleSwitch.style;
                this.pendingStyleSwitch = undefined;
            } else {
                this.advanceStyleSwitchAnimation(
                    deltaTimeSeconds,
                    timeSeconds,
                    seqTypeLoader,
                    seqFrameLoader,
                );
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

    private advanceStyleSwitchAnimation(
        deltaTimeSeconds: number,
        timeSeconds: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): void {
        const pendingStyleSwitch = this.pendingStyleSwitch!;
        const switchSeqId = STYLE_SWITCH_SEQ_IDS[pendingStyleSwitch.style];
        if (switchSeqId === undefined) {
            this.animation.setSequence(this.idleSeqId);
            this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        if (this.switchAnimationEndsAt !== pendingStyleSwitch.readyAt) {
            this.switchAnimationEndsAt = pendingStyleSwitch.readyAt;
            this.animation.restart(switchSeqId);
            this.switchAnimationSpeed =
                sequenceDurationSeconds(switchSeqId, seqTypeLoader, seqFrameLoader) /
                (pendingStyleSwitch.readyAt - timeSeconds);
        }
        this.animation.advance(
            deltaTimeSeconds,
            seqTypeLoader,
            seqFrameLoader,
            AnimationPlayback.ONCE,
            this.switchAnimationSpeed,
        );
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
