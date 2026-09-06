import { WeaponStyle } from "./Ability";
import { Player, StanceSeqIdsByStance } from "./Player";
import { BOW_SHOT, MAGIC_BOLT, SCIMITAR_SLASH } from "./abilities";

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;

const STYLE_SEQ_IDS: StanceSeqIdsByStance = {
    [WeaponStyle.RANGED]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 426 },
    [WeaponStyle.MAGIC]: { idleSeqId: 813, walkSeqId: 1146, runSeqId: 1210, attackSeqId: 711 },
    [WeaponStyle.MELEE]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 390 },
};

function makePlayer(): Player {
    return new Player(0, 0, 0, STYLE_SEQ_IDS);
}

describe("Player ability bar", () => {
    it("resolves slot 0 from the current style, with the potion last", () => {
        const player = makePlayer();
        expect(player.abilityBar[0]).toBe(BOW_SHOT);
        expect(player.abilityBar[player.abilityBar.length - 1].id).toBe("healing_potion");
    });

    it("switches slot 0 to the melee attack once in the melee style", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MELEE;
        expect(player.abilityBar[0]).toBe(SCIMITAR_SLASH);
    });

    it("switches slot 0 to the magic attack once in the magic style", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        expect(player.abilityBar[0]).toBe(MAGIC_BOLT);
    });
});

describe("Player animation ids follow the equipped style", () => {
    it("uses the ranged style's seq ids by default", () => {
        const player = makePlayer();
        expect(player.idleSeqId).toBe(808);
        expect(player.walkSeqId).toBe(819);
        expect(player.runSeqId).toBe(824);
        expect(player.attackSeqId).toBe(426);
    });

    it("switches to the magic style's seq ids once the style changes", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        expect(player.idleSeqId).toBe(813);
        expect(player.walkSeqId).toBe(1146);
        expect(player.runSeqId).toBe(1210);
        expect(player.attackSeqId).toBe(711);
    });
});

describe("Player mana", () => {
    it("starts at max mana", () => {
        const player = makePlayer();
        expect(player.mana).toBe(player.maxMana);
    });

    it("regenerates over time without exceeding the max", () => {
        const player = makePlayer();
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
        const player = makePlayer();
        player.beginCast(MAGIC_BOLT, { x: 100, y: 0 }, 10);
        expect(player.mana).toBe(player.maxMana - MAGIC_BOLT.manaCost);
        expect(player.abilityRuntime.isBusy(10)).toBe(true);
        expect(player.abilityRuntime.isBusy(10 + MAGIC_BOLT.windupSeconds)).toBe(false);
    });

    it("faces the caster toward the target", () => {
        const player = makePlayer();
        player.beginCast(BOW_SHOT, { x: 0, y: 500 }, 0);
        expect(player.rotation).toBe(1024);
    });
});

describe("Player movement while busy", () => {
    it("does not move while an ability is winding up", () => {
        const player = makePlayer();
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

describe("Player.requestStyleSwitch", () => {
    it("defaults the player to the ranged style", () => {
        const player = makePlayer();
        expect(player.style).toBe(WeaponStyle.RANGED);
    });

    it("is a no-op when requesting the currently active style", () => {
        const player = makePlayer();
        player.requestStyleSwitch(WeaponStyle.RANGED, 0);
        expect(player.isSwitchingStyle(0)).toBe(false);
    });

    it("channels for STYLE_SWITCH_SECONDS, blocking further ability use until it completes", () => {
        const player = makePlayer();
        player.requestStyleSwitch(WeaponStyle.MELEE, 0);
        expect(player.isSwitchingStyle(0)).toBe(true);
        expect(player.canUseSlotIgnoringTarget(0, 0)).toBe(false);
        expect(player.style).toBe(WeaponStyle.RANGED);

        expect(player.isSwitchingStyle(Player.STYLE_SWITCH_SECONDS - 0.001)).toBe(true);
        expect(player.isSwitchingStyle(Player.STYLE_SWITCH_SECONDS)).toBe(false);
    });

    it("does not start a new switch while already busy switching", () => {
        const player = makePlayer();
        player.requestStyleSwitch(WeaponStyle.MELEE, 0);
        player.requestStyleSwitch(WeaponStyle.MAGIC, 0.1);
        player.update(
            { x: 0, y: 0, running: false },
            Player.STYLE_SWITCH_SECONDS,
            Player.STYLE_SWITCH_SECONDS,
            seqTypeLoader,
            {} as any,
            {} as any,
        );
        expect(player.style).toBe(WeaponStyle.MELEE);
    });

    it("applies the new style once the switch completes, via update", () => {
        const player = makePlayer();
        player.requestStyleSwitch(WeaponStyle.MAGIC, 0);
        player.update(
            { x: 0, y: 0, running: false },
            0.5,
            0.5,
            seqTypeLoader,
            {} as any,
            {} as any,
        );
        expect(player.style).toBe(WeaponStyle.RANGED);
        player.update(
            { x: 0, y: 0, running: false },
            0.5,
            Player.STYLE_SWITCH_SECONDS,
            seqTypeLoader,
            {} as any,
            {} as any,
        );
        expect(player.style).toBe(WeaponStyle.MAGIC);
    });

    it("reports undefined progress once not switching", () => {
        const player = makePlayer();
        expect(player.styleSwitchProgress(0)).toBeUndefined();
        player.requestStyleSwitch(WeaponStyle.MELEE, 0);
        expect(player.styleSwitchProgress(0)).toBeCloseTo(0);
        expect(player.styleSwitchProgress(Player.STYLE_SWITCH_SECONDS / 2)).toBeCloseTo(0.5);
    });
});

describe("Player.getSlotReadiness", () => {
    it("reports mana-blocked for the magic style's attack when out of mana", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        player.mana = 0;
        expect(player.getSlotReadiness(0, 0).manaBlocked).toBe(true);
        player.mana = player.maxMana;
        expect(player.getSlotReadiness(0, 0).manaBlocked).toBe(false);
    });
});
