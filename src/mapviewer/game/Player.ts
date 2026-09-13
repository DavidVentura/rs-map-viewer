import { AbilityTarget, ResolvedAbility, WeaponStyle, abilityTargetPoint } from "./Ability";
import { AbilityRuntime } from "./AbilityRuntime";
import { AnimationPlayback, AnimationState, SeqTiming } from "./Animation";
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
    weaponPathForStyle,
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
import { PlayerLoadoutsByStyle } from "./abilities";
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

export enum PlayerMovementKind {
    STAND = 0,
    APPROACH = 1,
}

// Every walk the player takes heads for a point until within stopDistance of it: a clicked
// destination (0), a target's attack range, a ground item's pickup radius, an interaction's pose.
export type PlayerMovement =
    | { readonly kind: PlayerMovementKind.STAND }
    | {
          readonly kind: PlayerMovementKind.APPROACH;
          readonly x: number;
          readonly y: number;
          readonly stopDistance: number;
          readonly running: boolean;
      };

export const STAND_STILL: PlayerMovement = { kind: PlayerMovementKind.STAND };

export enum MovementOutcome {
    // Dead, or held in place by a cast animation.
    LOCKED = 0,
    STOOD = 1,
    MOVED = 2,
    // Walls or unwalkable floor ate most of the step.
    BLOCKED = 3,
}

// Below this share of the attempted step the player is pressing into a wall rather than sliding
// along it, so a walk towards a point behind the wall gives up instead of creeping forever.
const MIN_STEP_PROGRESS = 0.25;

// The stride that reaches a point lands on it only up to floating-point error, so anything closer
// counts as there.
export const ARRIVAL_TOLERANCE = 1e-6;

export type StanceSeqs = {
    readonly idle: SeqTiming;
    readonly walk: SeqTiming;
    readonly run: SeqTiming;
};

// Everything the player plays, resolved once when the encounter loads. Each style's stances are
// indexed by weapon tier (see WEAPON_LADDERS/resolveWeaponStance), the same way loadouts'
// basicAttackByTier is - a weapon tier with no stance of its own resolves to the style's default,
// so every tier is always present.
export type PlayerAnimations = {
    readonly stances: Readonly<Record<WeaponStyle, readonly StanceSeqs[]>>;
    readonly death: SeqTiming;
    readonly loadouts: PlayerLoadoutsByStyle<ResolvedAbility>;
};

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
        private readonly animations: PlayerAnimations,
    ) {
        this.spawnX = x;
        this.spawnY = y;
        this.animation = new AnimationState(this.activeStance.idle);
    }

    // The stance for the currently-equipped tier of the active style's weapon (see
    // PlayerAnimations.stances) - a plain field read, not a cast, so switching either the style or
    // the equipped tier picks a different pose the next time it's read (see update()).
    private get activeStance(): StanceSeqs {
        const tier = this.equipment[weaponPathForStyle(this.style)];
        return this.animations.stances[this.style][tier];
    }

    private get combinedModifiers(): AbilityModifiers {
        return composeModifiers(
            composeModifiers(this.modifiers, levelAbilityModifiers(this.progression.level)),
            equipmentAbilityModifiers(this.equipment, this.style),
        );
    }

    get basicAttack(): ResolvedAbility {
        const loadout = this.animations.loadouts[this.style];
        const weaponTier = this.equipment[weaponPathForStyle(this.style)];
        return applyModifiers(loadout.basicAttackByTier[weaponTier], this.combinedModifiers);
    }

    get skills(): readonly ResolvedAbility[] {
        const loadout = this.animations.loadouts[this.style];
        return loadout.skills.map((ability) => applyModifiers(ability, this.combinedModifiers));
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
        this.animation.restart(this.animations.death);
    }

    respawn(): void {
        this.x = this.spawnX;
        this.y = this.spawnY;
        this.health = this.maxHealth;
        this.mana = this.maxMana;
        this.deadUntil = undefined;
        this.castAnimationStartedAt = undefined;
        this.abilityRuntime.reset();
        this.animation.restart(this.activeStance.idle);
    }

    update(
        movement: PlayerMovement,
        deltaTimeSeconds: number,
        timeSeconds: number,
        terrain: Terrain,
    ): MovementOutcome {
        if (this.isDead(timeSeconds)) {
            this.animation.advance(deltaTimeSeconds, AnimationPlayback.ONCE);
            return MovementOutcome.LOCKED;
        }

        this.mana = Math.min(
            this.maxMana,
            this.mana + Player.MANA_REGEN_PER_SECOND * deltaTimeSeconds,
        );

        const activeCast = this.abilityRuntime.activeCastAnimation(timeSeconds);
        if (activeCast) {
            if (this.castAnimationStartedAt !== activeCast.startedAt) {
                this.castAnimationStartedAt = activeCast.startedAt;
                this.animation.restart(activeCast.definition.castSeq);
            }
            this.animation.advance(
                deltaTimeSeconds,
                AnimationPlayback.ONCE,
                activeCast.definition.castSpeed,
            );
            return MovementOutcome.LOCKED;
        }

        if (movement.kind === PlayerMovementKind.STAND) {
            return this.standIdle(deltaTimeSeconds, MovementOutcome.STOOD);
        }
        const deltaX = movement.x - this.x;
        const deltaY = movement.y - this.y;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance <= Math.max(movement.stopDistance, ARRIVAL_TOLERANCE)) {
            return this.standIdle(deltaTimeSeconds, MovementOutcome.STOOD);
        }

        // A full stride may carry the player up to one step inside stopDistance, so whoever asked
        // for the walk finds itself strictly within its range once it stops, but never past the
        // point itself.
        const speed =
            (movement.running ? Player.RUN_SPEED : Player.WALK_SPEED) *
            this.modifiers.moveSpeedMultiplier;
        const step = Math.min(speed * deltaTimeSeconds, distance);
        const position = resolveMovement(
            terrain,
            this.level,
            this.x,
            this.y,
            (deltaX / distance) * step,
            (deltaY / distance) * step,
        );
        const moved = Math.hypot(position.x - this.x, position.y - this.y);
        this.x = position.x;
        this.y = position.y;
        this.rotation = directionToRotation(deltaX, deltaY);
        if (moved < step * MIN_STEP_PROGRESS) {
            return this.standIdle(deltaTimeSeconds, MovementOutcome.BLOCKED);
        }
        this.animation.setSequence(
            movement.running ? this.activeStance.run : this.activeStance.walk,
        );
        this.animation.advance(deltaTimeSeconds);
        return MovementOutcome.MOVED;
    }

    private standIdle(deltaTimeSeconds: number, outcome: MovementOutcome): MovementOutcome {
        this.animation.setSequence(this.activeStance.idle);
        this.animation.advance(deltaTimeSeconds);
        return outcome;
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
