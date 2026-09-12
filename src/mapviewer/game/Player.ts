import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityTarget, ResolvedAbility, WeaponStyle, abilityTargetPoint } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { AnimationPlayback, AnimationState } from "./Animation";
import { Combatant, Faction, ManaPool } from "./Combatant";
import {
    DEFAULT_EQUIPMENT,
    EquipmentGrant,
    EquipmentPath,
    EquipmentState,
    applyEquipmentGrant,
    equipAtTier,
    equipmentAbilityModifiers,
    equipmentDamageTakenMultiplier,
    equipmentMaxHealthBonus,
} from "./Equipment";
import {
    CharacterLevel,
    Experience,
    LevelTransition,
    ProgressionState,
    grantExperience,
    initialProgression,
    levelAbilityModifiers,
} from "./Progression";
import {
    INITIAL_STANCE_MECHANICS,
    StanceMechanicsState,
    applyStanceMechanicUpgrade,
} from "./StanceMechanics";
import { Terrain } from "./Terrain";
import { PlayerLoadout, PlayerLoadoutsByStyle } from "./abilities";
import { AbilitySlotReadiness, CastCosts, computeSlotReadiness } from "./abilityRules";
import { resolveMovement } from "./movement";
import { directionToRotation } from "./projectileMath";
import {
    AbilityModifiers,
    DEFAULT_ABILITY_MODIFIERS,
    Upgrade,
    applyModifiers,
    composeModifiers,
} from "./upgrades";

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

export class Player implements Combatant, ManaPool {
    static readonly HIT_RADIUS = 64;
    static readonly PROJECTILE_LAUNCH_HEIGHT = 40;
    static readonly MAX_HEALTH = 100;
    static readonly MAX_MANA = 100;
    static readonly MANA_REGEN_PER_SECOND = 4;
    static readonly DEATH_SEQ_ID = 836;
    static readonly DEATH_SECONDS = 2;

    readonly faction = Faction.PLAYER;
    readonly hitRadius = Player.HIT_RADIUS;
    readonly projectileLaunchHeight = Player.PROJECTILE_LAUNCH_HEIGHT;
    health = Player.MAX_HEALTH;
    mana = Player.MAX_MANA;
    // Debug god mode: no damage taken and every skill castable for free, for tuning skill and
    // projectile feel without fighting the encounter.
    godMode = false;

    private modifiers: AbilityModifiers = DEFAULT_ABILITY_MODIFIERS;
    progression: ProgressionState = initialProgression();
    stanceMechanics: StanceMechanicsState = INITIAL_STANCE_MECHANICS;
    equipment: EquipmentState = DEFAULT_EQUIPMENT;

    get maxHealth(): number {
        return (
            Player.MAX_HEALTH +
            this.modifiers.maxHealthBonus +
            levelAbilityModifiers(this.progression.level).maxHealthBonus +
            equipmentMaxHealthBonus(this.equipment)
        );
    }

    // Only the melee defender mitigates damage in the current design; always active regardless of
    // the player's active style, like a permanently worn shield. Read by CombatEvent.applyDamage.
    get damageTakenMultiplier(): number {
        return equipmentDamageTakenMultiplier(this.equipment);
    }

    get maxMana(): number {
        return (
            Player.MAX_MANA +
            this.modifiers.maxManaBonus +
            levelAbilityModifiers(this.progression.level).maxManaBonus
        );
    }

    readonly spawnX: number;
    readonly spawnY: number;

    static readonly WALK_SPEED = 288 * 1.6;
    static readonly RUN_SPEED = 576 * 1.6;

    rotation = 0;

    private castAnimationStartedAt?: number;
    private deadUntil?: number;
    style: WeaponStyle = WeaponStyle.RANGED;
    readonly animation: AnimationState;
    readonly abilityRuntime = new AbilityRuntime();

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly styleSeqIds: StanceSeqIdsByStance,
        private readonly loadouts: PlayerLoadoutsByStyle<ResolvedAbility>,
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

    private get activeLoadout(): PlayerLoadout<ResolvedAbility> {
        const combined = composeModifiers(
            composeModifiers(this.modifiers, levelAbilityModifiers(this.progression.level)),
            equipmentAbilityModifiers(this.equipment, this.style),
        );
        const loadout = this.loadouts[this.style];
        return {
            basicAttack: applyModifiers(loadout.basicAttack, combined),
            skills: loadout.skills.map((ability) => applyModifiers(ability, combined)),
        };
    }

    get basicAttack(): ResolvedAbility {
        return this.activeLoadout.basicAttack;
    }

    get skills(): readonly ResolvedAbility[] {
        return this.activeLoadout.skills;
    }

    getModifiers(): AbilityModifiers {
        return this.modifiers;
    }

    applyUpgrade(upgrade: Upgrade): void {
        const previousMaxHealth = this.maxHealth;
        const previousMaxMana = this.maxMana;
        this.modifiers = upgrade.apply(this.modifiers);
        this.stanceMechanics = applyStanceMechanicUpgrade(this.stanceMechanics, upgrade.id);
        this.health = Math.min(this.maxHealth, this.health + (this.maxHealth - previousMaxHealth));
        this.mana = Math.min(this.maxMana, this.mana + (this.maxMana - previousMaxMana));
    }

    refundMana(amount: number): void {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new RangeError(`Mana refund must be finite and non-negative: ${amount}`);
        }
        this.mana = Math.min(this.maxMana, this.mana + amount);
    }

    grantExperience(amount: Experience): LevelTransition {
        const previousMaxHealth = this.maxHealth;
        const previousMaxMana = this.maxMana;
        const transition = grantExperience(this.progression, amount);
        this.progression = transition.state;
        this.health = Math.min(this.maxHealth, this.health + this.maxHealth - previousMaxHealth);
        this.mana = Math.min(this.maxMana, this.mana + this.maxMana - previousMaxMana);
        return transition;
    }

    get characterLevel(): CharacterLevel {
        return this.progression.level;
    }

    // Bumps the given path to the next tier above the player's current tier (never below it, never
    // past the path's max), used by the pickup flow: a drop is always the next tier on some path.
    equipItemUpgrade(path: EquipmentPath, tierIndex: number): void {
        const previousMaxHealth = this.maxHealth;
        const previousMaxMana = this.maxMana;
        this.equipment = equipAtTier(this.equipment, path, tierIndex);
        this.health = Math.min(this.maxHealth, this.health + (this.maxHealth - previousMaxHealth));
        this.mana = Math.min(this.maxMana, this.mana + (this.maxMana - previousMaxMana));
    }

    equipGrant(grant: EquipmentGrant): void {
        const previousMaxHealth = this.maxHealth;
        const previousMaxMana = this.maxMana;
        this.equipment = applyEquipmentGrant(this.equipment, grant);
        this.health = Math.min(this.maxHealth, this.health + this.maxHealth - previousMaxHealth);
        this.mana = Math.min(this.maxMana, this.mana + this.maxMana - previousMaxMana);
    }

    resetProgression(): void {
        this.modifiers = DEFAULT_ABILITY_MODIFIERS;
        this.progression = initialProgression();
        this.stanceMechanics = INITIAL_STANCE_MECHANICS;
        this.equipment = DEFAULT_EQUIPMENT;
    }

    get invulnerable(): boolean {
        return this.godMode;
    }

    private castCosts(): CastCosts {
        return this.godMode ? CastCosts.FREE : CastCosts.CHARGED;
    }

    getBasicAttackReadiness(timeSeconds: number): AbilitySlotReadiness {
        const attack = this.basicAttack;
        return computeSlotReadiness(
            attack,
            this.abilityRuntime.chargeStateFor(attack),
            this.mana,
            timeSeconds,
            this.castCosts(),
        );
    }

    getSkillReadiness(skillSlot: number, timeSeconds: number): AbilitySlotReadiness {
        const skill = this.skillAt(skillSlot);
        return computeSlotReadiness(
            skill,
            this.abilityRuntime.chargeStateFor(skill),
            this.mana,
            timeSeconds,
            this.castCosts(),
        );
    }

    canUseBasicAttackIgnoringTarget(timeSeconds: number): boolean {
        return this.abilityRuntime.canUse(
            this.basicAttack,
            this.mana,
            timeSeconds,
            this.castCosts(),
        );
    }

    canUseSkillIgnoringTarget(skillSlot: number, timeSeconds: number): boolean {
        return this.abilityRuntime.canUse(
            this.skillAt(skillSlot),
            this.mana,
            timeSeconds,
            this.castCosts(),
        );
    }

    private skillAt(skillSlot: number): ResolvedAbility {
        const skill = this.skills[skillSlot];
        if (!skill) {
            throw new Error(`No skill at slot ${skillSlot} for ${this.style}`);
        }
        return skill;
    }

    isBusy(timeSeconds: number): boolean {
        return this.abilityRuntime.isBusy(timeSeconds);
    }

    // Style switches are instant: no cooldown lock, no busy state, no animation, always allowed.
    requestStyleSwitch(style: WeaponStyle): void {
        this.style = style;
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
        this.castAnimationStartedAt = undefined;
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

        const activeCast = this.abilityRuntime.activeCastAnimation(timeSeconds);
        if (activeCast) {
            if (this.castAnimationStartedAt !== activeCast.startedAt) {
                this.castAnimationStartedAt = activeCast.startedAt;
                this.animation.restart(activeCast.definition.castSeqId);
            }
            this.animation.advance(
                deltaTimeSeconds,
                seqTypeLoader,
                seqFrameLoader,
                AnimationPlayback.ONCE,
                activeCast.definition.castSpeed,
            );
            return;
        }

        const length = Math.hypot(input.x, input.y);
        if (length === 0) {
            this.animation.setSequence(this.idleSeqId);
            this.animation.advance(deltaTimeSeconds, seqTypeLoader, seqFrameLoader);
            return;
        }

        const speed =
            (input.running ? Player.RUN_SPEED : Player.WALK_SPEED) *
            this.modifiers.moveSpeedMultiplier;
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

    beginCast(ability: ResolvedAbility, target: AbilityTarget, timeSeconds: number): void {
        if (this.castCosts() === CastCosts.CHARGED) {
            this.mana -= ability.manaCost;
        }
        this.abilityRuntime.use(ability, target, timeSeconds);
        const aim = abilityTargetPoint(target);
        const deltaX = aim.x - this.x;
        const deltaY = aim.y - this.y;
        if (deltaX !== 0 || deltaY !== 0) {
            this.rotation = directionToRotation(deltaX, deltaY);
        }
    }
}
