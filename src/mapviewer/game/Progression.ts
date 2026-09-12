import { AbilityModifiers, DEFAULT_ABILITY_MODIFIERS } from "./upgrades";

declare const experienceBrand: unique symbol;
declare const characterLevelBrand: unique symbol;

export type Experience = number & { readonly [experienceBrand]: true };
export type CharacterLevel = number & { readonly [characterLevelBrand]: true };

export type ProgressionState = {
    readonly experience: Experience;
    readonly level: CharacterLevel;
};

export type LevelTransition = {
    readonly state: ProgressionState;
    readonly gainedLevels: readonly CharacterLevel[];
};

export function createExperience(value: number): Experience {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`Experience must be a non-negative integer: ${value}`);
    }
    return value as Experience;
}

export function createCharacterLevel(value: number): CharacterLevel {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`Character level must be a positive integer: ${value}`);
    }
    return value as CharacterLevel;
}

export function experienceForLevel(level: CharacterLevel): Experience {
    return createExperience(100 * (level - 1) * (level - 1));
}

export function initialProgression(): ProgressionState {
    return { experience: createExperience(0), level: createCharacterLevel(1) };
}

export function grantExperience(state: ProgressionState, amount: Experience): LevelTransition {
    const experience = createExperience(state.experience + amount);
    const gainedLevels: CharacterLevel[] = [];
    let level = state.level;
    while (experience >= experienceForLevel(createCharacterLevel(level + 1))) {
        level = createCharacterLevel(level + 1);
        gainedLevels.push(level);
    }
    return { state: { experience, level }, gainedLevels };
}

export function levelAbilityModifiers(level: CharacterLevel): AbilityModifiers {
    const gained = level - 1;
    return {
        ...DEFAULT_ABILITY_MODIFIERS,
        damageMultiplier: 1 + gained * 0.05,
        maxHealthBonus: gained * 5,
        maxManaBonus: gained * 2,
    };
}
