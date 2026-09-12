import {
    AbilityDefinition,
    AbilityTarget,
    AbilityTargetKind,
    ResolvedAbility,
    WeaponStyle,
    attackLockSeconds,
    resolveAbility,
} from "./Ability";
import { EquipmentPath } from "./Equipment";
import { Player } from "./Player";
import { createExperience } from "./Progression";
import { Terrain } from "./Terrain";
import {
    BOW_SHOT,
    CLEAVE,
    HEALING_POTION,
    HEALING_POTION_CAST_SEQ_ID,
    MAGIC_BOLT,
    SCIMITAR_SLASH,
} from "./abilities";
import { stubEncounterAnimations, stubSeqCatalog } from "./testLoaders";
import { DEFAULT_ABILITY_MODIFIERS, FLEET_FOOTED, VITALITY } from "./upgrades";

const seqCatalog = stubSeqCatalog();
const ANIMATIONS = stubEncounterAnimations();

function resolve(definition: AbilityDefinition): ResolvedAbility {
    return resolveAbility(definition, seqCatalog);
}

const OPEN_TERRAIN = {
    isLoaded: () => true,
    canOccupy: () => true,
    getWallFlag: () => 0,
    getHeight: () => 0,
} as unknown as Terrain;

function point(x: number, y: number): AbilityTarget {
    return { kind: AbilityTargetKind.POINT, x, y };
}

function makePlayer(): Player {
    return new Player(0, 0, 0, ANIMATIONS.player);
}

describe("Player loadout", () => {
    it("separates the ranged basic attack from its keyboard skills", () => {
        const player = makePlayer();
        expect(player.basicAttack.id).toBe(BOW_SHOT.id);
        expect(player.skills.map((skill) => skill.id)).toEqual([
            "volley",
            "power_shot",
            HEALING_POTION.id,
        ]);
    });

    it("switches to the melee basic attack and stable skill layout", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MELEE;
        expect(player.basicAttack.id).toBe(SCIMITAR_SLASH.id);
        expect(player.skills.map((skill) => skill.id)).toEqual([
            CLEAVE.id,
            "maul_smash",
            HEALING_POTION.id,
        ]);
    });

    it("switches to the magic basic attack and its two keyboard skills", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        expect(player.basicAttack.id).toBe(MAGIC_BOLT.id);
        expect(player.skills.map((skill) => skill.id)).toEqual(["ice_barrage", HEALING_POTION.id]);
    });

    it("the basic attack itself changes as the equipped weapon tier is upgraded", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MELEE;
        expect(player.basicAttack.id).toBe(SCIMITAR_SLASH.id);

        player.equipItemUpgrade(EquipmentPath.SCIMITAR, 1);
        expect(player.basicAttack.id).toBe("dragon_scimitar_slash");

        player.equipItemUpgrade(EquipmentPath.SCIMITAR, 2);
        expect(player.basicAttack.id).toBe("whip_slash");

        player.equipItemUpgrade(EquipmentPath.SCIMITAR, 3);
        expect(player.basicAttack.id).toBe("scythe_sweep");
    });
});

describe("Player animations follow the equipped style", () => {
    function playedSeqIds(player: Player): readonly number[] {
        player.update({ x: 0, y: 0, running: false }, 0.01, 0, OPEN_TERRAIN);
        const idle = player.animation.seqId;
        player.update({ x: 1, y: 0, running: false }, 0.01, 0, OPEN_TERRAIN);
        const walk = player.animation.seqId;
        player.update({ x: 1, y: 0, running: true }, 0.01, 0, OPEN_TERRAIN);
        return [idle, walk, player.animation.seqId];
    }

    it("plays the ranged style's idle, walk and run by default", () => {
        expect(playedSeqIds(makePlayer())).toEqual([808, 819, 824]);
    });

    it("plays the magic style's idle, walk and run once the style changes", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        expect(playedSeqIds(player)).toEqual([813, 1146, 1210]);
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
        player.update({ x: 0, y: 0, running: false }, 1, 0, {} as any);
        expect(player.mana).toBeCloseTo(Player.MANA_REGEN_PER_SECOND);
        player.mana = player.maxMana;
        player.update({ x: 0, y: 0, running: false }, 1, 0, {} as any);
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

        player.update({ x: 0, y: 0, running: false }, played - 0.01, played - 0.01, {} as any);
        expect(player.animation.seqId).toBe(HEALING_POTION_CAST_SEQ_ID);

        player.update({ x: 0, y: 0, running: false }, 0.02, played + 0.01, {} as any);
        expect(player.animation.seqId).toBe(808);
    });
});

describe("Player movement while busy", () => {
    it("does not move while an ability is winding up", () => {
        const player = makePlayer();
        player.beginCast(resolve(BOW_SHOT), point(100, 0), 0);
        player.update({ x: 1, y: 0, running: false }, 0.01, 0.01, {} as any);
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
        expect(player.canUseBasicAttackIgnoringTarget(0)).toBe(true);
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
        player.update({ x: 1, y: 0, running: false }, 0.1, 0.1, {
            isLoaded: () => true,
            canOccupy: () => true,
            getWallFlag: () => 0,
            getHeight: () => 0,
        } as any);
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

describe("Player.getBasicAttackReadiness", () => {
    it("reports mana-blocked for the magic style's attack when out of mana", () => {
        const player = makePlayer();
        player.style = WeaponStyle.MAGIC;
        player.mana = 0;
        expect(player.getBasicAttackReadiness(0).manaBlocked).toBe(true);
        player.mana = player.maxMana;
        expect(player.getBasicAttackReadiness(0).manaBlocked).toBe(false);
    });
});

describe("Player character progression", () => {
    it("applies universal level growth separately from upgrades", () => {
        const player = makePlayer();
        const transition = player.grantExperience(createExperience(100));
        expect(transition.gainedLevels).toEqual([2]);
        expect(player.characterLevel).toBe(2);
        expect(player.maxHealth).toBe(Player.MAX_HEALTH + 5);
        expect(player.maxMana).toBe(Player.MAX_MANA + 2);
        expect(player.basicAttack.effect.payloads[0]).toMatchObject({
            roll: { min: 8.4, max: 8.4 },
        });
    });
});
