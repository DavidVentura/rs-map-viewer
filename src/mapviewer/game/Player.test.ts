import {
    AbilityDefinition,
    AbilityTarget,
    AbilityTargetKind,
    ResolvedAbility,
    WeaponStyle,
    attackLockSeconds,
    resolveAbility,
} from "./Ability";
import { Player, StanceSeqIdsByStance } from "./Player";
import {
    BOW_SHOT,
    HEALING_POTION,
    HEALING_POTION_CAST_SEQ_ID,
    MAGIC_BOLT,
    SCIMITAR_SLASH,
    resolvePlayerAbilityBars,
} from "./abilities";
import { stubSequenceLoaders } from "./testLoaders";
import { DEFAULT_ABILITY_MODIFIERS, FLEET_FOOTED, VITALITY } from "./upgrades";

const { seqTypeLoader, seqFrameLoader } = stubSequenceLoaders();

function resolve(definition: AbilityDefinition): ResolvedAbility {
    return resolveAbility(definition, seqTypeLoader, seqFrameLoader);
}

const STYLE_SEQ_IDS: StanceSeqIdsByStance = {
    [WeaponStyle.RANGED]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 426 },
    [WeaponStyle.MAGIC]: { idleSeqId: 813, walkSeqId: 1146, runSeqId: 1210, attackSeqId: 711 },
    [WeaponStyle.MELEE]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 390 },
};

function point(x: number, y: number): AbilityTarget {
    return { kind: AbilityTargetKind.POINT, x, y };
}

function makePlayer(): Player {
    return new Player(
        0,
        0,
        0,
        STYLE_SEQ_IDS,
        resolvePlayerAbilityBars(seqTypeLoader, seqFrameLoader),
    );
}

describe("Player ability bar", () => {
    it("resolves slot 0 from the current style, with the potion last", () => {
        const player = makePlayer();
        expect(player.abilityBar[0].id).toBe(BOW_SHOT.id);
        expect(player.abilityBar[player.abilityBar.length - 1].id).toBe("healing_potion");
    });

    it("switches slot 0 to the melee attack once in the melee style", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MELEE;
        expect(player.abilityBar[0].id).toBe(SCIMITAR_SLASH.id);
    });

    it("switches slot 0 to the magic attack once in the magic style", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        expect(player.abilityBar[0].id).toBe(MAGIC_BOLT.id);
    });
});

describe("Player animation ids follow the equipped style", () => {
    it("uses the ranged style's seq ids by default", () => {
        const player = makePlayer();
        expect(player.idleSeqId).toBe(808);
        expect(player.walkSeqId).toBe(819);
        expect(player.runSeqId).toBe(824);
    });

    it("switches to the magic style's seq ids once the style changes", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        expect(player.idleSeqId).toBe(813);
        expect(player.walkSeqId).toBe(1146);
        expect(player.runSeqId).toBe(1210);
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
        const bolt = resolve(MAGIC_BOLT);
        player.beginCast(bolt, point(100, 0), 10);
        expect(player.mana).toBe(player.maxMana - MAGIC_BOLT.manaCost);
        expect(player.abilityRuntime.isBusy(10)).toBe(true);
        expect(player.abilityRuntime.isBusy(10 + bolt.timing.impactSeconds)).toBe(false);
    });

    it("faces the caster toward the target", () => {
        const player = makePlayer();
        player.beginCast(resolve(BOW_SHOT), point(0, 500), 0);
        expect(player.rotation).toBe(1024);
    });
});

describe("Player cast animation duration", () => {
    it("keeps the cast animation active for the cast sequence's own duration, not the ATTACK lock", () => {
        const player = makePlayer();
        const bow = resolve(BOW_SHOT);
        player.beginCast(bow, point(100, 0), 0);
        const played = bow.timing.animationSeconds;
        expect(player.abilityRuntime.activeCastAnimation(played - 0.01)).toBeDefined();
        expect(player.abilityRuntime.activeCastAnimation(played)).toBeUndefined();
    });

    it("returns to idle once the drink animation itself finishes, even though the heal/attack locks are still recovering", () => {
        const player = makePlayer();
        const potion = resolve(HEALING_POTION);
        player.beginCast(potion, point(0, 0), 0);
        const played = potion.timing.animationSeconds;
        expect(played).toBeLessThan(potion.timing.impactSeconds + attackLockSeconds(potion));

        player.update(
            { x: 0, y: 0, running: false },
            played - 0.01,
            played - 0.01,
            seqTypeLoader,
            {} as any,
            {} as any,
        );
        expect(player.animation.seqId).toBe(HEALING_POTION_CAST_SEQ_ID);

        player.update(
            { x: 0, y: 0, running: false },
            0.02,
            played + 0.01,
            seqTypeLoader,
            {} as any,
            {} as any,
        );
        expect(player.animation.seqId).toBe(player.idleSeqId);
    });
});

describe("Player movement while busy", () => {
    it("does not move while an ability is winding up", () => {
        const player = makePlayer();
        player.beginCast(resolve(BOW_SHOT), point(100, 0), 0);
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
        player.requestStyleSwitch(WeaponStyle.RANGED);
        expect(player.style).toBe(WeaponStyle.RANGED);
    });

    it("switches immediately, with no delay or busy lock", () => {
        const player = makePlayer();
        player.requestStyleSwitch(WeaponStyle.MELEE);
        expect(player.style).toBe(WeaponStyle.MELEE);
        expect(player.isBusy(0)).toBe(false);
        expect(player.canUseSlotIgnoringTarget(0, 0)).toBe(true);
    });

    it("lets a second switch immediately override the first", () => {
        const player = makePlayer();
        player.requestStyleSwitch(WeaponStyle.MELEE);
        player.requestStyleSwitch(WeaponStyle.MAGIC);
        expect(player.style).toBe(WeaponStyle.MAGIC);
    });

    it("does not touch the animation state: an immediate switch has no flourish to play", () => {
        const player = makePlayer();
        const seqIdBeforeSwitch = player.animation.seqId;
        player.requestStyleSwitch(WeaponStyle.MELEE);
        expect(player.animation.seqId).toBe(seqIdBeforeSwitch);
    });
});

describe("Player.applyUpgrade", () => {
    it("raises max health and heals the player by the same amount", () => {
        const player = makePlayer();
        player.health = 50;
        player.applyUpgrade(VITALITY);
        expect(player.maxHealth).toBe(Player.MAX_HEALTH + 20);
        expect(player.health).toBe(70);
    });

    it("does not overheal past the new max health", () => {
        const player = makePlayer();
        player.applyUpgrade(VITALITY);
        expect(player.health).toBe(player.maxHealth);
    });

    it("speeds up movement once Fleet Footed is applied", () => {
        const player = makePlayer();
        player.applyUpgrade(FLEET_FOOTED);
        player.update(
            { x: 1, y: 0, running: false },
            0.1,
            0.1,
            seqTypeLoader,
            {} as any,
            {
                isLoaded: () => true,
                canOccupy: () => true,
                getWallFlag: () => 0,
                getHeight: () => 0,
            } as any,
        );
        expect(player.x).toBeCloseTo(Player.WALK_SPEED * 1.15 * 0.1);
    });

    it("stacks modifiers from multiple upgrades", () => {
        const player = makePlayer();
        player.applyUpgrade(VITALITY);
        player.applyUpgrade(VITALITY);
        expect(player.maxHealth).toBe(Player.MAX_HEALTH + 40);
    });

    it("resetProgression restores the default modifiers", () => {
        const player = makePlayer();
        player.applyUpgrade(VITALITY);
        player.resetProgression();
        expect(player.maxHealth).toBe(Player.MAX_HEALTH);
        expect(player.getModifiers()).toEqual(DEFAULT_ABILITY_MODIFIERS);
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
