import { WeaponStyle } from "./Ability";
import { Encounter, EncounterId, EncounterSpawnMode } from "./Encounter";
import { EnemyState } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import { GameWorld, SimInput } from "./GameWorld";
import { StanceSeqIdsByStance } from "./Player";
import { Terrain } from "./Terrain";
import { UPGRADE_POOL } from "./upgrades";

class FakeTerrain implements Terrain {
    isLoaded(): boolean {
        return true;
    }

    canOccupy(): boolean {
        return true;
    }

    getWallFlag(): number {
        return 0;
    }

    getHeight(): number {
        return 0;
    }
}

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;
const seqFrameLoader = {} as any;

const STYLE_SEQ_IDS: StanceSeqIdsByStance = {
    [WeaponStyle.RANGED]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 426 },
    [WeaponStyle.MAGIC]: { idleSeqId: 813, walkSeqId: 1146, runSeqId: 1210, attackSeqId: 711 },
    [WeaponStyle.MELEE]: { idleSeqId: 808, walkSeqId: 819, runSeqId: 824, attackSeqId: 390 },
};

// Two waves. Wave 2's condition uses a fraction threshold below the valid 0..1 range so it can
// never start via the "previous wave died down" path (real encounters always stay within 0..1;
// this is a deliberately unreachable value that isolates wave 2 to the elapsed-time path only),
// which only fires 50ms after wave 1 starts. That keeps the two waves from starting in the same
// tick a real, overlapping encounter would allow, so the pause/resume tests below have a clean,
// unambiguous "before" and "after".
function twoWaveEncounter(): Encounter {
    return {
        id: EncounterId.FIGHT_CAVES,
        mapSquares: [{ mapX: 0, mapY: 0 }],
        playerSpawn: { x: 0, y: 0, level: 0 },
        enemySpawns: [
            { x: 1000, y: 0, level: 0 },
            { x: -1000, y: 0, level: 0 },
        ],
        enemyTypeIds: [EnemyTypeId.TZ_KIH],
        spawnMode: EncounterSpawnMode.WAVES,
        ambientNpcs: false,
        musicFile: "audio/tzhaar.opus",
        waves: [
            {
                groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
                startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 },
            },
            {
                groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 1 }],
                startCondition: { maxPreviousAliveFraction: -1, maxElapsedSeconds: 0.05 },
            },
        ],
    };
}

function idleInput(): SimInput {
    return { movement: { x: 0, y: 0, running: false }, abilities: [] };
}

function killAllEnemies(world: GameWorld): void {
    for (const enemy of world.enemies) {
        enemy.health = 0;
    }
}

describe("Wave-cleared upgrade offer", () => {
    it("pauses the sim and offers 3 distinct upgrades once a non-final wave fully clears", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(twoWaveEncounter(), 0, 0, 0, STYLE_SEQ_IDS);

        world.advance(1 / 120, idleInput());
        expect(world.enemies.length).toBe(1);
        expect(world.pendingUpgradeOffer).toBeUndefined();

        killAllEnemies(world);
        world.advance(1 / 120, idleInput());

        expect(world.pendingUpgradeOffer).toBeDefined();
        const offer = world.pendingUpgradeOffer!;
        expect(offer.length).toBe(3);
        expect(new Set(offer.map((upgrade) => upgrade.id)).size).toBe(3);
        expect(offer).toEqual([UPGRADE_POOL[0], UPGRADE_POOL[1], UPGRADE_POOL[2]]);
    });

    it("freezes the director while an offer is pending, even once wave 2's timer would fire", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(twoWaveEncounter(), 0, 0, 0, STYLE_SEQ_IDS);
        world.advance(1 / 120, idleInput());
        killAllEnemies(world);
        world.advance(1 / 120, idleInput());
        expect(world.pendingUpgradeOffer).toBeDefined();
        const enemyCountDuringOffer = world.enemies.length;

        // 200 ticks at 1/120s is ~1.67s, well past wave 2's 50ms elapsed-time trigger: if the
        // director weren't paused, wave 2 would have started by now.
        for (let i = 0; i < 200; i++) {
            world.advance(1 / 120, idleInput());
        }

        expect(world.pendingUpgradeOffer).toBeDefined();
        expect(world.enemies.length).toBe(enemyCountDuringOffer);
    });

    it("applies the chosen upgrade to the player, clears the offer, and resumes the director", () => {
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(twoWaveEncounter(), 0, 0, 0, STYLE_SEQ_IDS);
        world.advance(1 / 120, idleInput());
        killAllEnemies(world);
        world.advance(1 / 120, idleInput());
        const offer = world.pendingUpgradeOffer!;
        const player = world.player!;
        const previousModifiers = player.getModifiers();

        world.advance(1 / 120, {
            movement: { x: 0, y: 0, running: false },
            abilities: [],
            chooseUpgrade: 1,
        });

        expect(world.pendingUpgradeOffer).toBeUndefined();
        expect(player.getModifiers()).toEqual(offer[1].apply(previousModifiers));

        // The director resumes stepping; once wave 2's 50ms elapsed-time trigger fires, it spawns.
        for (let i = 0; i < 20; i++) {
            world.advance(1 / 120, idleInput());
        }
        expect(world.enemies.filter((enemy) => enemy.state !== EnemyState.DEAD).length).toBe(1);
    });

    it("sends the final wave's clear straight to ENCOUNTER_CLEARED, with no offer", () => {
        const encounter: Encounter = {
            ...twoWaveEncounter(),
            waves: [twoWaveEncounter().waves[0]],
        };
        const world = new GameWorld(new FakeTerrain(), seqTypeLoader, seqFrameLoader, () => 0);
        world.startEncounter(encounter, 0, 0, 0, STYLE_SEQ_IDS);
        world.advance(1 / 120, idleInput());
        killAllEnemies(world);
        world.advance(1 / 120, idleInput());

        expect(world.pendingUpgradeOffer).toBeUndefined();
        expect(world.getWaveProgress()?.cleared).toBe(true);
    });
});
