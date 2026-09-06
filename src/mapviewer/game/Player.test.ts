import { AbilityEffectKind, Stance } from "./Ability";
import { Player, StanceSeqIdsByStance } from "./Player";
import {
    BOW_SHOT,
    HEALING_POTION,
    MAGIC_BOLT,
    SCIMITAR_SLASH,
    SWITCH_TO_BOW,
    SWITCH_TO_SCIMITAR,
    SWITCH_TO_STAFF,
} from "./abilities";

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;

const STANCE_SEQ_IDS: StanceSeqIdsByStance = {
    [Stance.RANGED]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 426 },
    [Stance.MAGIC]: { idleSeqId: 813, walkSeqId: 1146, runSeqId: 1210, attackSeqId: 711 },
    [Stance.MELEE]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 390 },
};

function makePlayer(): Player {
    return new Player(0, 0, 0, STANCE_SEQ_IDS);
}

describe("Player ability bar", () => {
    it("resolves slot 0 from the current stance, and fixes the rest", () => {
        const player = makePlayer();
        expect(player.abilityBar[0]).toBe(BOW_SHOT);
        expect(player.abilityBar[1]).toBe(HEALING_POTION);
        expect(player.abilityBar[2]).toBe(SWITCH_TO_BOW);
        expect(player.abilityBar[3]).toBe(SWITCH_TO_STAFF);
        expect(player.abilityBar[4]).toBe(SWITCH_TO_SCIMITAR);
    });

    it("switches slot 0 to the melee attack once in the melee stance", () => {
        const player = makePlayer();
        player.stance = Stance.MELEE;
        expect(player.abilityBar[0]).toBe(SCIMITAR_SLASH);
    });

    it("switches slot 0 to the magic attack once in the magic stance", () => {
        const player = makePlayer();
        player.stance = Stance.MAGIC;
        expect(player.abilityBar[0]).toBe(MAGIC_BOLT);
    });
});

describe("Player animation ids follow the equipped stance", () => {
    it("uses the ranged stance's seq ids by default", () => {
        const player = makePlayer();
        expect(player.idleSeqId).toBe(808);
        expect(player.walkSeqId).toBe(819);
        expect(player.runSeqId).toBe(824);
        expect(player.attackSeqId).toBe(426);
    });

    it("switches to the magic stance's seq ids once the stance changes", () => {
        const player = makePlayer();
        player.stance = Stance.MAGIC;
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

describe("Stance switch abilities", () => {
    it("channel, blocking further ability use until they complete", () => {
        const player = makePlayer();
        expect(SWITCH_TO_SCIMITAR.effect.kind).toBe(AbilityEffectKind.STANCE);
        player.beginCast(SWITCH_TO_SCIMITAR, { x: 0, y: 0 }, 0);
        expect(player.abilityRuntime.isChanneling(0)).toBe(true);
        expect(player.abilityRuntime.canUse(BOW_SHOT, player.mana, 0)).toBe(false);
        expect(player.abilityRuntime.isChanneling(SWITCH_TO_SCIMITAR.channelSeconds)).toBe(false);
    });

    it("defaults the player to the ranged stance", () => {
        const player = makePlayer();
        expect(player.stance).toBe(Stance.RANGED);
    });

    it("is not usable while already in the target stance", () => {
        const player = makePlayer();
        expect(player.canUseSlotIgnoringTarget(2, 0)).toBe(false);
        player.stance = Stance.MAGIC;
        expect(player.canUseSlotIgnoringTarget(2, 0)).toBe(true);
    });
});

describe("Player.getSlotReadiness", () => {
    it("reports mana-blocked for the magic stance's attack when out of mana", () => {
        const player = makePlayer();
        player.stance = Stance.MAGIC;
        player.mana = 0;
        expect(player.getSlotReadiness(0, 0).manaBlocked).toBe(true);
        player.mana = player.maxMana;
        expect(player.getSlotReadiness(0, 0).manaBlocked).toBe(false);
    });

    it("marks a stance-switch slot as the active stance once selected", () => {
        const player = makePlayer();
        expect(player.getSlotReadiness(2, 0).isActiveStance).toBe(true);
        expect(player.getSlotReadiness(3, 0).isActiveStance).toBe(false);
    });
});
