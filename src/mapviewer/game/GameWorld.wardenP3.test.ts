import { AbilityTargetKind, WeaponStyle } from "./Ability";
import { CombatEventKind } from "./CombatEvent";
import { EncounterActorKind, EnergySiphonActor, createPhantomActor } from "./EncounterActor";
import { EnemyTypeId } from "./EnemyType";
import { EnergySiphonState } from "./EnergySiphon";
import { GameWorld, SimInput } from "./GameWorld";
import { TILE_SIZE, Terrain } from "./Terrain";
import { VisualEffectKind } from "./VisualEffect";
import {
    WARDEN_P3_ARENA_ROW_COUNT,
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WARDEN_P3_SOLO_SIPHON_LAYOUT,
    WardenP3ArenaTile,
    wardenP3ArenaTile,
    wardenP3SolidFloorTiles,
} from "./WardenP3Arena";
import {
    WardenP3Arena,
    WardenP3Tile,
    WardenPhantom,
    WardenSiphonStatus,
    WardenSlamTarget,
    WardenSlamTempo,
    WardenStance,
} from "./WardenP3Director";
import { FloorSlam, floorSlamArrivalSeconds, floorSlamEndsAtSeconds } from "./WardenP3FloorSlam";
import { WARDEN_P3_PHANTOM_DAMAGE, wardenPhantomEnemyTypeId } from "./WardenP3Phantoms";
import { stubEncounterAnimations } from "./testLoaders";

class FlatTerrain implements Terrain {
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

const EMPTY_INPUT: SimInput = {
    movement: { x: 0, y: 0, running: false },
    combat: { basicAttack: { held: false }, skills: [] },
};

function energySiphons(world: GameWorld): EnergySiphonActor[] {
    return world.encounterActors.filter(
        (actor): actor is EnergySiphonActor => actor.kind === EncounterActorKind.ENERGY_SIPHON,
    );
}

function attackSiphon(siphon: EnergySiphonActor): SimInput {
    return {
        movement: { x: 0, y: 0, running: false },
        combat: {
            basicAttack: {
                held: true,
                target: { kind: AbilityTargetKind.ENERGY_SIPHON, siphon },
            },
            skills: [],
        },
    };
}

const ANIMATIONS = stubEncounterAnimations();
const WARDEN_ANIMATIONS = ANIMATIONS.wardenP3();

// Matches the real encounter definition (Encounter.ts), which always starts enrage's row removal
// countdown from the full 9-row floor.
const ARENA: WardenP3Arena = { furthestRowFromWarden: WARDEN_P3_ARENA_ROW_COUNT };

// The scripted encounter spawns both phantoms north of the floor; these tests start the runtime
// on its own, so they place them the same way.
function addPhantoms(world: GameWorld): void {
    const spawns: readonly [WardenPhantom, number][] = [
        [WardenPhantom.ZEBAK, 3925],
        [WardenPhantom.BABA, 3943],
    ];
    for (const [phantom, tileX] of spawns) {
        world.encounterActors.push(
            createPhantomActor(
                9000 + tileX,
                (tileX + 2.5) * TILE_SIZE,
                (5152 + 2.5) * TILE_SIZE,
                0,
                ANIMATIONS.enemyType(wardenPhantomEnemyTypeId(phantom)),
                0,
            ),
        );
    }
}

function createWardenWorld(random: () => number = Math.random): {
    readonly world: GameWorld;
    readonly wardenId: number;
} {
    const world = new GameWorld(new FlatTerrain(), ANIMATIONS, random);
    world.spawnPlayer(0, 0, 0);
    const wardenId = world.spawnEnemy(128, 0, 0, ANIMATIONS.enemyType(EnemyTypeId.TUMEKENS_WARDEN));
    addPhantoms(world);
    world.startWardenP3Runtime(wardenId, ARENA, WARDEN_P3_SOLO_SIPHON_LAYOUT);
    return { world, wardenId };
}

const STEP_SECONDS = 0.01;

function stepUntilFirstFloorSlam(world: GameWorld): FloorSlam {
    for (let step = 0; step < 2000; step++) {
        world.step(EMPTY_INPUT, STEP_SECONDS);
        const slam = world.wardenP3RenderState?.floorSlams[0];
        if (slam) {
            return slam;
        }
    }
    throw new Error("Expected the Warden to slam the floor");
}

describe("Wardens P3 world runtime", () => {
    it("plays each slam on the Warden and sets the floor wave off at the slam's impact frame", () => {
        const { world, wardenId } = createWardenWorld();
        const warden = world.findEnemy(wardenId)!;
        const right = WARDEN_ANIMATIONS.slams[WardenSlamTempo.NORMAL][WardenSlamTarget.RIGHT];
        const left = WARDEN_ANIMATIONS.slams[WardenSlamTempo.NORMAL][WardenSlamTarget.LEFT];

        world.step(EMPTY_INPUT, STEP_SECONDS);
        const beganAtSeconds = world.timeSeconds;
        expect(warden.animation.seqId).toBe(right.seq.seqId);

        const slam = stepUntilFirstFloorSlam(world);
        expect(slam.startsAtSeconds).toBeGreaterThanOrEqual(beganAtSeconds + right.impactSeconds);
        expect(slam.startsAtSeconds).toBeLessThan(
            beganAtSeconds + right.impactSeconds + STEP_SECONDS,
        );
        expect(warden.animation.seqId).toBe(right.seq.seqId);

        while (world.timeSeconds < beganAtSeconds + right.durationSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(warden.animation.seqId).toBe(left.seq.seqId);
    });

    it("makes the Warden invulnerable for siphons and exposes the director commands to rendering", () => {
        const { world, wardenId } = createWardenWorld();
        const warden = world.findEnemy(wardenId)!;
        const charging = WARDEN_ANIMATIONS.stances[WardenStance.CHARGING];
        const standing = WARDEN_ANIMATIONS.stances[WardenStance.STANDING];
        warden.health = 80;

        world.step(EMPTY_INPUT, 0.01);

        expect(warden.invulnerable).toBe(true);
        expect(world.wardenP3RenderState).toMatchObject({
            activeIntermission: 0,
            commands: [
                { kind: "SET_WARDEN_VULNERABILITY", vulnerable: false },
                { kind: "SPAWN_ENERGY_SIPHONS", intermission: 0 },
                { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.CHARGING },
            ],
        });
        expect(warden.animation.seqId).toBe(charging.transition.seqId);
        world.step(EMPTY_INPUT, charging.transitionSeconds + STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(warden.animation.seqId).toBe(charging.hold.seqId);

        world.resolveWardenP3Siphons(WardenSiphonStatus.ALL_REVERSED);
        world.step(EMPTY_INPUT, 0.01);

        expect(warden.invulnerable).toBe(false);
        expect(world.wardenP3RenderState).toMatchObject({
            activeIntermission: undefined,
            commands: [
                {
                    kind: "RESOLVE_ENERGY_SIPHONS",
                    intermission: 0,
                    status: WardenSiphonStatus.ALL_REVERSED,
                    wardenDamage: 5,
                },
                { kind: "SET_WARDEN_VULNERABILITY", vulnerable: true },
                { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.STANDING },
            ],
        });
        expect(warden.animation.seqId).toBe(standing.transition.seqId);
    });

    it("emits encounter completion when the Warden dies", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 0;

        world.step(EMPTY_INPUT, 0.01);

        expect(world.drainEvents()).toContainEqual({ kind: CombatEventKind.ENCOUNTER_CLEARED });
    });

    it("damages the attacked floor as the front arrives while leaving the safe side untouched", () => {
        const { world } = createWardenWorld();
        const struckTile = wardenP3ArenaTile(3940, 5160);
        world.player!.x = (struckTile.x + 0.5) * 128;
        world.player!.y = (struckTile.y + 0.5) * 128;
        const startingHealth = world.player!.health;

        const slam = stepUntilFirstFloorSlam(world);
        const arrival = floorSlamArrivalSeconds(slam, struckTile)!;
        while (world.timeSeconds + STEP_SECONDS < arrival) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.player!.health).toBe(startingHealth);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(world.player!.health).toBe(startingHealth - 30);

        const safeWorld = createWardenWorld().world;
        safeWorld.player!.x = (3930 + 0.5) * 128;
        safeWorld.player!.y = (5160 + 0.5) * 128;
        const safeHealth = safeWorld.player!.health;
        const safeSlam = stepUntilFirstFloorSlam(safeWorld);
        while (safeWorld.timeSeconds < floorSlamEndsAtSeconds(safeSlam)) {
            safeWorld.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(safeWorld.player!.health).toBe(safeHealth);
    });

    it("spawns mechanic-only siphons and resolves their intermission after basic melee reverses each", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        world.step(EMPTY_INPUT, 0.01);

        expect(energySiphons(world)).toHaveLength(4);
        world.player!.style = WeaponStyle.MELEE;
        for (let index = 0; index < energySiphons(world).length - 1; index++) {
            const siphon = energySiphons(world)[index];
            world.player!.x = siphon.x;
            world.player!.y = siphon.y;
            world.step(attackSiphon(siphon), 0.01);
            expect(world.findEnergySiphon(siphon.id)?.siphon.state).toBe(
                EnergySiphonState.REVERSED,
            );
        }

        const finalSiphon = energySiphons(world).at(-1)!;
        world.player!.x = finalSiphon.x;
        world.player!.y = finalSiphon.y;
        world.step(attackSiphon(finalSiphon), 0.01);

        expect(energySiphons(world)).toEqual([]);
        expect(world.wardenP3RenderState?.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.ALL_REVERSED,
            wardenDamage: 5,
        });
    });

    it("resolves a siphon intermission when its authored deadline expires", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        world.step(EMPTY_INPUT, 0.01);

        world.step(EMPTY_INPUT, WARDEN_P3_SOLO_SIPHON_LAYOUT.deadlineSeconds);

        expect(energySiphons(world)).toEqual([]);
        expect(world.wardenP3RenderState?.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.DEADLINE_EXPIRED,
            wardenDamage: 0,
        });
        expect(world.wardenP3RenderState?.floorSlams).toHaveLength(1);
    });

    // Drives past one of the four scripted siphon intermissions (INTERMISSION_HEALTH_FRACTIONS in
    // WardenP3Director.ts) so a later health drop reaches enrage instead of retriggering siphons.
    function clearIntermission(world: GameWorld, wardenId: number, healthFraction: number): void {
        world.findEnemy(wardenId)!.health = healthFraction * 100;
        world.step(EMPTY_INPUT, 0.01);
        world.resolveWardenP3Siphons(WardenSiphonStatus.ALL_REVERSED);
        world.step(EMPTY_INPUT, 0.01);
    }

    it("blocks the player from walking onto arena rows the enrage has destroyed", () => {
        const { world, wardenId } = createWardenWorld();
        // Row 8, the second-furthest row: still solid once the first (furthest, row 9) is
        // destroyed, and adjacent to it so a short run north crosses the removed boundary.
        const solidTile = wardenP3ArenaTile(3936, 5164);
        world.player!.x = (solidTile.x + 0.5) * 128;
        world.player!.y = (solidTile.y + 0.5) * 128;

        clearIntermission(world, wardenId, 0.8);
        clearIntermission(world, wardenId, 0.6);
        clearIntermission(world, wardenId, 0.4);
        clearIntermission(world, wardenId, 0.2);
        world.findEnemy(wardenId)!.health = 1;
        world.step(EMPTY_INPUT, 0.01);
        world.step(EMPTY_INPUT, 2.5);

        expect(world.wardenP3RenderState?.removedArenaRows).toContain(9);

        // Runs straight at the destroyed row (y+1): movement must stop at the row boundary
        // instead of crossing onto it.
        world.step({ movement: { x: 0, y: 1, running: true }, combat: EMPTY_INPUT.combat }, 1);
        expect(Math.floor(world.player!.y / 128)).toBe(solidTile.y);

        // The remaining floor is still walkable.
        world.step({ movement: { x: 1, y: 0, running: true }, combat: EMPTY_INPUT.combat }, 0.05);
        expect(world.player!.x).toBeGreaterThan((solidTile.x + 0.5) * 128);
    });

    it("never counts phantoms or siphons as combatants", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        world.step(EMPTY_INPUT, 0.01);
        world.encounterActors.push(
            createPhantomActor(9999, 0, 0, 0, world.findEnemy(wardenId)!.type, 0),
        );

        expect(energySiphons(world).length).toBeGreaterThan(0);
        expect(
            world.encounterActors.some((actor) => actor.kind === EncounterActorKind.PHANTOM),
        ).toBe(true);

        const combatants = world.combatants();
        for (const actor of world.encounterActors) {
            expect(combatants).not.toContain(actor);
        }
    });

    function placePlayerOn(world: GameWorld, tile: WardenP3Tile): void {
        world.player!.x = (tile.x + 0.5) * TILE_SIZE;
        world.player!.y = (tile.y + 0.5) * TILE_SIZE;
    }

    function stepUntilRelease(world: GameWorld, phantom: WardenPhantom, beforeStep = () => {}) {
        for (let step = 0; step < 5000; step++) {
            beforeStep();
            world.step(EMPTY_INPUT, STEP_SECONDS);
            const release = world.wardenP3RenderState?.commands.find(
                (command) =>
                    command.kind === "RELEASE_PHANTOM_ATTACK" &&
                    command.release.phantom === phantom,
            );
            if (release) {
                return;
            }
        }
        throw new Error(`Expected the ${phantom} phantom to release an attack`);
    }

    // Leaves the Warden in its second siphon intermission, where Zebak's phantom has just woken.
    function createZebakWorld(): GameWorld {
        const { world, wardenId } = createWardenWorld();
        placePlayerOn(world, wardenP3ArenaTile(3936, 5162));
        clearIntermission(world, wardenId, 0.8);
        world.findEnemy(wardenId)!.health = 60;
        return world;
    }

    function stepUntilShotLands(world: GameWorld): void {
        while (world.projectiles.length > 0) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
    }

    it("lands Zebak's phantom shot where the player stood at release, hurting only if they stayed", () => {
        const world = createZebakWorld();
        const zebak = world.encounterActors.find(
            (actor) => actor.type.id === wardenPhantomEnemyTypeId(WardenPhantom.ZEBAK),
        )!;
        const startingHealth = world.player!.health;

        stepUntilRelease(world, WardenPhantom.ZEBAK);
        expect(zebak.animation.seqId).toBe(
            WARDEN_ANIMATIONS.phantoms.attacks[WardenPhantom.ZEBAK].seq.seqId,
        );
        expect(world.projectiles).toHaveLength(1);
        stepUntilShotLands(world);
        expect(world.player!.health).toBe(
            startingHealth - WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.ZEBAK],
        );

        const dodgingWorld = createZebakWorld();
        const dodgingHealth = dodgingWorld.player!.health;
        stepUntilRelease(dodgingWorld, WardenPhantom.ZEBAK);
        placePlayerOn(dodgingWorld, wardenP3ArenaTile(3939, 5162));
        stepUntilShotLands(dodgingWorld);
        expect(dodgingWorld.player!.health).toBe(dodgingHealth);
    });

    function shadowTiles(world: GameWorld): WardenP3ArenaTile[] {
        return world.visualEffects
            .filter((effect) => effect.kind === VisualEffectKind.FALLING_SHADOW)
            .map((effect) =>
                wardenP3ArenaTile(
                    Math.floor(effect.x / TILE_SIZE),
                    Math.floor(effect.y / TILE_SIZE),
                ),
            );
    }

    // Leaves the Warden in its third siphon intermission, where Ba-Ba's phantom has just woken, and
    // steps to Ba-Ba's first release. Zebak's shots are cleared as they fly so only rocks can hurt.
    function releaseBabaRocks(playerTile: WardenP3ArenaTile): {
        readonly world: GameWorld;
        readonly clearZebakShots: () => void;
    } {
        const { world, wardenId } = createWardenWorld(() => 0.5);
        placePlayerOn(world, playerTile);
        clearIntermission(world, wardenId, 0.8);
        clearIntermission(world, wardenId, 0.6);
        world.findEnemy(wardenId)!.health = 40;
        const clearZebakShots = () => {
            world.projectiles = [];
        };
        stepUntilRelease(world, WardenPhantom.BABA, clearZebakShots);
        return { world, clearZebakShots };
    }

    it("drops Ba-Ba's phantom rocks on solid floor and the player's tile, hitting only as they land", () => {
        const playerTile = wardenP3ArenaTile(3936, 5162);
        const { world, clearZebakShots } = releaseBabaRocks(playerTile);
        const landsAtSeconds =
            world.timeSeconds + WARDEN_ANIMATIONS.phantoms.rockFall.landingSeconds;
        const struck = shadowTiles(world);
        const solid = wardenP3SolidFloorTiles(WARDEN_P3_INITIAL_ARENA_FLOOR);
        expect(struck).toContainEqual(playerTile);
        for (const tile of struck) {
            expect(solid).toContainEqual(tile);
        }
        const startingHealth = world.player!.health;

        while (world.timeSeconds + STEP_SECONDS < landsAtSeconds) {
            clearZebakShots();
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.player!.health).toBe(startingHealth);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(world.player!.health).toBe(
            startingHealth - WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.BABA],
        );
    });

    it("lets the player step out from under Ba-Ba's phantom rock before it lands", () => {
        const { world, clearZebakShots } = releaseBabaRocks(wardenP3ArenaTile(3936, 5162));
        const landsAtSeconds =
            world.timeSeconds + WARDEN_ANIMATIONS.phantoms.rockFall.landingSeconds;
        const struck = shadowTiles(world);
        const safeTile = wardenP3SolidFloorTiles(WARDEN_P3_INITIAL_ARENA_FLOOR).find(
            (tile) => !struck.some((target) => target.x === tile.x && target.y === tile.y),
        )!;
        placePlayerOn(world, safeTile);
        const startingHealth = world.player!.health;

        while (world.timeSeconds < landsAtSeconds + 0.5) {
            clearZebakShots();
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.player!.health).toBe(startingHealth);
    });
});
