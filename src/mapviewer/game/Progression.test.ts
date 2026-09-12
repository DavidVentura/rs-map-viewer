import {
    createCharacterLevel,
    createExperience,
    experienceForLevel,
    grantExperience,
    initialProgression,
    levelAbilityModifiers,
} from "./Progression";

describe("character progression", () => {
    it("uses deterministic quadratic total-experience thresholds", () => {
        expect(experienceForLevel(createCharacterLevel(1))).toBe(0);
        expect(experienceForLevel(createCharacterLevel(2))).toBe(100);
        expect(experienceForLevel(createCharacterLevel(3))).toBe(400);
    });

    it("reports every level crossed by one experience grant", () => {
        const transition = grantExperience(initialProgression(), createExperience(450));
        expect(transition.state.level).toBe(3);
        expect(transition.gainedLevels).toEqual([2, 3]);
    });

    it("derives universal growth without changing mechanical upgrade state", () => {
        const modifiers = levelAbilityModifiers(createCharacterLevel(3));
        expect(modifiers.damageMultiplier).toBe(1.1);
        expect(modifiers.maxHealthBonus).toBe(10);
        expect(modifiers.maxManaBonus).toBe(4);
    });
});
