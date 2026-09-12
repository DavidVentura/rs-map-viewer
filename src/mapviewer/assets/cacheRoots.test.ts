import fs from "fs";
import path from "path";

import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { WeaponStyle } from "../game/Ability";
import { Encounter, EncounterId, getEncounter } from "../game/Encounter";
import { EnemyTypeId, getEnemyType } from "../game/EnemyType";
import { buildPlayerAbilityBar } from "../game/abilities";
import { cacheRoots } from "./cacheRoots";

function loadJson<T>(relativePath: string): T {
    return JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), "utf8"));
}

const npcSpawns = loadJson<NpcSpawn[]>("../data/npc/npc-spawns-osrs.json");
const objSpawns = loadJson<ObjSpawn[]>("../data/obj/obj-spawns.json");

function isInside(encounter: Encounter, x: number, y: number): boolean {
    return encounter.mapSquares.some(({ mapX, mapY }) => x >> 6 === mapX && y >> 6 === mapY);
}

function rootsFor(encounter: Encounter) {
    return cacheRoots(encounter, undefined, npcSpawns, objSpawns);
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

    it("Fight Caves roots leave out the npc spawns of its squares, since it has no ambient npcs", () => {
        const encounter = getEncounter(EncounterId.FIGHT_CAVES);
        const enemyNpcTypeIds = new Set(
            encounter.enemyTypeIds.map((id) => getEnemyType(id).npcTypeId),
        );
        const ambientOnlyIds = npcSpawns
            .filter((spawn) => isInside(encounter, spawn.x, spawn.y))
            .map((spawn) => spawn.id)
            .filter((id) => !enemyNpcTypeIds.has(id));
        expect(ambientOnlyIds.length).toBeGreaterThan(0);
        const roots = rootsFor(encounter);
        for (const id of ambientOnlyIds) {
            expect(roots.npcTypeIds).not.toContain(id);
        }
    });

    it("Lumbridge roots include the npc and obj spawns inside its square and none outside it", () => {
        const encounter = getEncounter(EncounterId.LUMBRIDGE);
        const roots = rootsFor(encounter);
        const noSpawnRoots = cacheRoots(encounter, undefined, [], []);

        const insideNpcIds = new Set(
            npcSpawns.filter((spawn) => isInside(encounter, spawn.x, spawn.y)).map((s) => s.id),
        );
        const outsideOnlyNpcIds = npcSpawns
            .filter((spawn) => !isInside(encounter, spawn.x, spawn.y))
            .map((spawn) => spawn.id)
            .filter((id) => !insideNpcIds.has(id) && !noSpawnRoots.npcTypeIds.includes(id));
        expect(insideNpcIds.size).toBeGreaterThan(0);
        expect(outsideOnlyNpcIds.length).toBeGreaterThan(0);
        expect(roots.npcTypeIds).toEqual(expect.arrayContaining([...insideNpcIds]));
        for (const id of outsideOnlyNpcIds) {
            expect(roots.npcTypeIds).not.toContain(id);
        }

        const insideObjIds = objSpawns
            .filter((spawn) => isInside(encounter, spawn.x, spawn.y))
            .map((spawn) => spawn.id);
        expect(insideObjIds.length).toBeGreaterThan(0);
        expect(roots.objTypeIds).toEqual(expect.arrayContaining(insideObjIds));
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
        "%s roots contain every sequence the player casts",
        (id) => {
            const roots = rootsFor(getEncounter(id));
            for (const style of [WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC]) {
                for (const ability of buildPlayerAbilityBar(style)) {
                    expect(roots.seqIds).toContain(ability.castSeqId);
                }
            }
        },
    );

    it("preview ranges become npc, seq and spot anim roots", () => {
        const lumbridge = getEncounter(EncounterId.LUMBRIDGE);
        const npcPreview = cacheRoots(
            lumbridge,
            { kind: "NPC_SEQS", npcTypeId: 8615, seqRange: { from: 9000, to: 9002 } },
            [],
            [],
        );
        expect(npcPreview.npcTypeIds).toContain(8615);
        expect(npcPreview.seqIds).toEqual(expect.arrayContaining([9000, 9001, 9002]));

        const gfxPreview = cacheRoots(
            lumbridge,
            { kind: "SPOT_ANIMS", range: { from: 3000, to: 3003 } },
            [],
            [],
        );
        expect(gfxPreview.spotAnimIds).toEqual(expect.arrayContaining([3000, 3001, 3002, 3003]));
    });
});
