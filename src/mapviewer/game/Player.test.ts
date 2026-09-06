import { AbilityEffectKind, Stance } from "./Ability";
import { Player } from "./Player";
import { BOW_SHOT, HEALING_POTION, MAGIC_BOLT, STANCE_SWITCH } from "./abilities";

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;

describe("Player ability bar", () => {
    it("holds bow, magic, potion and stance in the expected slots", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        expect(player.abilityBar[0]).toBe(BOW_SHOT);
        expect(player.abilityBar[1]).toBe(MAGIC_BOLT);
        expect(player.abilityBar[2]).toBe(HEALING_POTION);
        expect(player.abilityBar[3]).toBe(STANCE_SWITCH);
    });
});

describe("Player mana", () => {
    it("starts at max mana", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        expect(player.mana).toBe(player.maxMana);
    });

    it("regenerates over time without exceeding the max", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        player.mana = 0;
        player.update({ x: 0, y: 0, running: false }, 1, 0, seqTypeLoader, {} as any, {} as any);
        expect(player.mana).toBeCloseTo(Player.MANA_REGEN_PER_SECOND);
        player.mana = player.maxMana;
        player.update({ x: 0, y: 0, running: false }, 1, 0, seqTypeLoader, {} as any, {} as any);
        expect(player.mana).toBe(player.maxMana);
    });
});

describe("Player.beginCast", () => {
    it("deducts mana and starts the ability's wind-up", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        player.beginCast(MAGIC_BOLT, { x: 100, y: 0 }, 10);
        expect(player.mana).toBe(player.maxMana - MAGIC_BOLT.manaCost);
        expect(player.abilityRuntime.isBusy(10)).toBe(true);
        expect(player.abilityRuntime.isBusy(10 + MAGIC_BOLT.windupSeconds)).toBe(false);
    });

    it("faces the caster toward the target", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        player.beginCast(BOW_SHOT, { x: 0, y: 500 }, 0);
        expect(player.rotation).toBe(1024);
    });
});

describe("Player movement while busy", () => {
    it("does not move while an ability is winding up", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        player.beginCast(BOW_SHOT, { x: 100, y: 0 }, 0);
        player.update(
            { x: 1, y: 0, running: false },
            0.01,
            0.01,
            seqTypeLoader,
            {} as any,
            {} as any,
        );
        expect(player.x).toBe(0);
        expect(player.y).toBe(0);
    });
});

describe("Stance switch", () => {
    it("channels, blocking further ability use until it completes", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        expect(STANCE_SWITCH.effect.kind).toBe(AbilityEffectKind.STANCE);
        player.beginCast(STANCE_SWITCH, { x: 0, y: 0 }, 0);
        expect(player.abilityRuntime.isChanneling(0)).toBe(true);
        expect(player.abilityRuntime.canUse(BOW_SHOT, player.mana, 0)).toBe(false);
        expect(player.abilityRuntime.isChanneling(STANCE_SWITCH.channelSeconds)).toBe(false);
    });

    it("defaults the player to the ranged stance", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        expect(player.stance).toBe(Stance.RANGED);
    });
});
