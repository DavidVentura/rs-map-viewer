import { WeaponStyle } from "../game/Ability";
import { Encounter, EncounterId, getEncounter } from "../game/Encounter";
import { EnemyTypeId, getEnemyType } from "../game/EnemyType";
import { buildPlayerLoadout } from "../game/abilities";
import { cacheRoots, packRequest } from "./cacheRoots";

function rootsFor(encounter: Encounter) {
    return cacheRoots(encounter, undefined);
}

const TZTOK_JAD_NPC_TYPE_ID = 3127;
const JAD_FIRE_PROJECTILE_SPOTANIM_ID = 449;
const JAD_FIRE_HIT_SPOTANIM_ID = 450;
const JAD_RANGED_ROCK_SPOTANIM_ID = 451;

describe("cacheRoots", () => {
    it("Fight Caves roots contain TzTok-Jad and his graphics", () => {
        const roots = rootsFor(getEncounter(EncounterId.FIGHT_CAVES));
        expect(roots.npcTypeIds).toContain(TZTOK_JAD_NPC_TYPE_ID);
        expect(roots.spotAnimIds).toEqual(
            expect.arrayContaining([
                JAD_FIRE_PROJECTILE_SPOTANIM_ID,
                JAD_FIRE_HIT_SPOTANIM_ID,
                JAD_RANGED_ROCK_SPOTANIM_ID,
            ]),
        );
        expect(roots.mapSquares).toHaveLength(8);
    });

    it("Lumbridge roots hold the 3x3 squares around the player's square", () => {
        const encounter = getEncounter(EncounterId.LUMBRIDGE);
        const playerMapX = encounter.playerSpawn.x >> 13;
        const playerMapY = encounter.playerSpawn.y >> 13;
        const expected = [-1, 0, 1].flatMap((dx) =>
            [-1, 0, 1].map((dy) => ({ mapX: playerMapX + dx, mapY: playerMapY + dy })),
        );
        expect(rootsFor(encounter).mapSquares).toEqual(expected);
    });

    it("Fight Caves asks for the obj spawns of its squares but not the npc spawns, since it has no ambient npcs", () => {
        const encounter = getEncounter(EncounterId.FIGHT_CAVES);
        const request = packRequest(encounter, undefined);
        expect(request.roots).toEqual(rootsFor(encounter));
        expect(request.npcSpawnSquares).toEqual([]);
        expect(request.objSpawnSquares).toEqual(request.roots.mapSquares);
    });

    it("Lumbridge asks for the npc and obj spawns of all its squares", () => {
        const request = packRequest(getEncounter(EncounterId.LUMBRIDGE), undefined);
        expect(request.npcSpawnSquares).toEqual(request.roots.mapSquares);
        expect(request.objSpawnSquares).toEqual(request.roots.mapSquares);
    });

    it("the animation viewer asks for no npc spawns, since it maps without ambient npcs", () => {
        const request = packRequest(getEncounter(EncounterId.LUMBRIDGE), {
            kind: "SPOT_ANIMS",
            range: { from: 3000, to: 3003 },
        });
        expect(request.npcSpawnSquares).toEqual([]);
        expect(request.objSpawnSquares).toEqual(request.roots.mapSquares);
    });

    it("an extra wave of enemy types already in the roster keeps the roots, a new enemy type changes them", () => {
        const fightCaves = getEncounter(EncounterId.FIGHT_CAVES);
        const roots = rootsFor(fightCaves);

        const withExtraWave: Encounter = {
            ...fightCaves,
            waves: [
                ...fightCaves.waves,
                {
                    groups: [
                        { enemyTypeId: EnemyTypeId.TZ_KIH, count: 30 },
                        { enemyTypeId: EnemyTypeId.KET_ZEK, count: 2 },
                    ],
                    startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: 60 },
                },
            ],
        };
        expect(rootsFor(withExtraWave)).toEqual(roots);

        const withGoblins: Encounter = {
            ...withExtraWave,
            enemyTypeIds: [...fightCaves.enemyTypeIds, EnemyTypeId.GOBLIN],
            waves: [
                ...fightCaves.waves,
                {
                    groups: [{ enemyTypeId: EnemyTypeId.GOBLIN, count: 4 }],
                    startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: 60 },
                },
            ],
        };
        const goblinRoots = rootsFor(withGoblins);
        expect(goblinRoots).not.toEqual(roots);
        expect(goblinRoots.npcTypeIds).toContain(getEnemyType(EnemyTypeId.GOBLIN).npcTypeId);
        expect(roots.npcTypeIds).not.toContain(getEnemyType(EnemyTypeId.GOBLIN).npcTypeId);
    });

    it.each(Object.values(EncounterId))(
        "%s roots contain every sequence the player can cast",
        (id) => {
            const roots = rootsFor(getEncounter(id));
            for (const style of [WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC]) {
                const loadout = buildPlayerLoadout(style);
                for (const ability of [loadout.basicAttack, ...loadout.skills]) {
                    expect(roots.seqIds).toContain(ability.castSeqId);
                }
            }
        },
    );

    it("preview ranges become npc, seq and spot anim roots", () => {
        const lumbridge = getEncounter(EncounterId.LUMBRIDGE);
        const npcPreview = cacheRoots(lumbridge, {
            kind: "NPC_SEQS",
            npcTypeId: 8615,
            seqRange: { from: 9000, to: 9002 },
        });
        expect(npcPreview.npcTypeIds).toContain(8615);
        expect(npcPreview.seqIds).toEqual(expect.arrayContaining([9000, 9001, 9002]));

        const gfxPreview = cacheRoots(lumbridge, {
            kind: "SPOT_ANIMS",
            range: { from: 3000, to: 3003 },
        });
        expect(gfxPreview.spotAnimIds).toEqual(expect.arrayContaining([3000, 3001, 3002, 3003]));
    });
});
