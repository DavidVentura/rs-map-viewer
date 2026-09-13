import { AbilityTargetKind, WeaponStyle } from "./Ability";
import { CombatEventKind, applyDamage } from "./CombatEvent";
import { EncounterActorKind, EnergySiphonActor, createPhantomActor } from "./EncounterActor";
import { EnemyTypeId } from "./EnemyType";
import { EnergySiphonState } from "./EnergySiphon";
import { GameWorld, SimInput } from "./GameWorld";
import { ProjectileKind } from "./Projectile";
import { TILE_SIZE, Terrain } from "./Terrain";
import { VisualEffectKind } from "./VisualEffect";
import {
    WARDEN_P3_FLOOR_DECORATIONS,
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WARDEN_P3_SOLO_SIPHON_LAYOUT,
    WardenP3ArenaTile,
    WardenP3ArenaTileOccupancy,
    canOccupyWardenP3ArenaTile,
    wardenP3ArenaTile,
    wardenP3SolidFloorTiles,
    wardenP3TileOccupancy,
} from "./WardenP3Arena";
import {
    WardenP3Command,
    WardenP3Intermission,
    WardenP3StartPhase,
    WardenP3Tile,
    WardenPhantom,
    WardenSiphonStatus,
    WardenSlamTarget,
    WardenSlamTempo,
    WardenStance,
} from "./WardenP3Director";
import { WARDEN_P3_LIGHTNING } from "./WardenP3Enrage";
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

function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

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

function createWardenWorld(
    random: () => number = Math.random,
    startPhase = WardenP3StartPhase.OPENING,
): {
    readonly world: GameWorld;
    readonly wardenId: number;
} {
    const world = new GameWorld(new FlatTerrain(), ANIMATIONS, random);
    world.spawnPlayer(0, 0, 0);
    const wardenId = world.spawnEnemy(128, 0, 0, ANIMATIONS.enemyType(EnemyTypeId.TUMEKENS_WARDEN));
    addPhantoms(world);
    world.startWardenP3Runtime(wardenId, WARDEN_P3_SOLO_SIPHON_LAYOUT, startPhase);
    return { world, wardenId };
}

const STEP_SECONDS = 0.01;

// Steps from the opening of a siphon intermission to the Warden's throw, leaving the siphons just
// thrown and still in flight.
function stepUntilSiphonsThrown(world: GameWorld): EnergySiphonActor[] {
    for (let step = 0; step < 5000; step++) {
        world.step(EMPTY_INPUT, STEP_SECONDS);
        const siphons = energySiphons(world);
        if (siphons.length > 0) {
            return siphons;
        }
    }
    throw new Error("Expected the Warden to throw its siphons");
}

function stepUntilSiphonsLand(world: GameWorld): EnergySiphonActor[] {
    const landsAtSeconds = world.timeSeconds + WARDEN_ANIMATIONS.siphons.flightSeconds;
    while (world.timeSeconds < landsAtSeconds + STEP_SECONDS) {
        world.step(EMPTY_INPUT, STEP_SECONDS);
    }
    const siphons = energySiphons(world);
    expect(siphons.every((siphon) => siphon.siphon.state === EnergySiphonState.HOSTILE)).toBe(true);
    return siphons;
}

function reverseSiphon(world: GameWorld, siphon: EnergySiphonActor): void {
    world.player!.style = WeaponStyle.MELEE;
    world.player!.x = siphon.x;
    world.player!.y = siphon.y;
    world.step(attackSiphon(siphon), STEP_SECONDS);
}

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
                    reversalDamage: 5,
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

    it("keeps stepping once the defeated Warden's corpse has despawned", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 0;
        world.step(EMPTY_INPUT, 0.01);

        world.enemies = world.enemies.filter((enemy) => enemy.id !== wardenId);

        expect(() => world.step(EMPTY_INPUT, 0.01)).not.toThrow();
    });

    it("holds the Warden at its next threshold so one hit can't carry it past the phase", () => {
        const { world, wardenId } = createWardenWorld();
        const warden = world.findEnemy(wardenId)!;
        world.step(EMPTY_INPUT, 0.01);

        applyDamage(warden, warden.maxHealth, []);
        expect(warden.health).toBe(warden.maxHealth * 0.8);

        world.step(EMPTY_INPUT, 0.01);
        expect(warden.invulnerable).toBe(true);
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
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(energySiphons(world)).toEqual([]);

        expect(stepUntilSiphonsThrown(world)).toHaveLength(4);
        const siphons = stepUntilSiphonsLand(world);
        for (const siphon of siphons.slice(0, -1)) {
            reverseSiphon(world, siphon);
            expect(world.findEnergySiphon(siphon.id)?.siphon.state).toBe(
                EnergySiphonState.REVERSED,
            );
        }

        reverseSiphon(world, siphons.at(-1)!);

        expect(energySiphons(world)).toEqual([]);
        expect(world.wardenP3RenderState?.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.ALL_REVERSED,
            reversalDamage: 5,
        });
    });

    it("lets no siphon be reversed until it has landed on its tile", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        const [thrown] = stepUntilSiphonsThrown(world);

        reverseSiphon(world, thrown);
        expect(world.findEnergySiphon(thrown.id)?.siphon.state).toBe(EnergySiphonState.IN_FLIGHT);

        stepUntilSiphonsLand(world);
        reverseSiphon(world, thrown);
        expect(world.findEnergySiphon(thrown.id)?.siphon.state).toBe(EnergySiphonState.REVERSED);
    });

    it("resolves a siphon intermission when its authored deadline expires after the siphons land", () => {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        stepUntilSiphonsThrown(world);
        const deadlineAtSeconds =
            world.timeSeconds +
            WARDEN_ANIMATIONS.siphons.flightSeconds +
            WARDEN_P3_SOLO_SIPHON_LAYOUT.deadlineSeconds;

        while (world.timeSeconds + STEP_SECONDS < deadlineAtSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(energySiphons(world)).toHaveLength(4);
        while (energySiphons(world).length > 0) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }

        expect(world.timeSeconds).toBeLessThan(deadlineAtSeconds + 2 * STEP_SECONDS);
        expect(world.wardenP3RenderState?.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.DEADLINE_EXPIRED,
            reversalDamage: 5,
        });
        expect(world.wardenP3RenderState?.floorSlams).toHaveLength(1);
    });

    // Reverses reversedCount of the first intermission's siphons, then lets the rest run out the
    // deadline (or resolves at once when all are reversed), returning when the siphons fly back.
    function recallSiphons(reversedCount: number): {
        readonly world: GameWorld;
        readonly wardenId: number;
        readonly arrivesAtSeconds: number;
    } {
        const { world, wardenId } = createWardenWorld();
        world.findEnemy(wardenId)!.health = 80;
        stepUntilSiphonsThrown(world);
        const siphons = stepUntilSiphonsLand(world);
        for (const siphon of siphons.slice(0, reversedCount)) {
            reverseSiphon(world, siphon);
        }
        world.player!.x = 0;
        world.player!.y = 0;
        while (energySiphons(world).length > 0) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        return {
            world,
            wardenId,
            arrivesAtSeconds: world.timeSeconds + WARDEN_ANIMATIONS.siphons.recallSeconds,
        };
    }

    it("flies every siphon back into the Warden, striking with the reversed ones only as they arrive", () => {
        const { world, wardenId, arrivesAtSeconds } = recallSiphons(4);
        const warden = world.findEnemy(wardenId)!;
        const recallFlights = world.projectiles.filter(
            (projectile) => projectile.spec.kind === ProjectileKind.ENERGY_SIPHON_RECALL,
        );
        expect(recallFlights).toHaveLength(4);

        while (world.timeSeconds + STEP_SECONDS < arrivesAtSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(warden.health).toBe(80);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(warden.health).toBe(75);
    });

    it("still strikes with the siphons reversed before the deadline expired", () => {
        const { world, wardenId, arrivesAtSeconds } = recallSiphons(2);
        while (world.timeSeconds < arrivesAtSeconds + STEP_SECONDS) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.findEnemy(wardenId)!.health).toBe(77.5);
    });

    // Drives past one of the four scripted siphon intermissions (INTERMISSION_HEALTH_FRACTIONS in
    // WardenP3Director.ts) so a later health drop reaches enrage instead of retriggering siphons.
    function clearIntermission(world: GameWorld, wardenId: number, healthFraction: number): void {
        world.findEnemy(wardenId)!.health = healthFraction * 100;
        world.step(EMPTY_INPUT, 0.01);
        world.resolveWardenP3Siphons(WardenSiphonStatus.ALL_REVERSED);
        world.step(EMPTY_INPUT, 0.01);
    }

    it("blocks the player from walking onto floor the enrage has pulled", () => {
        // Always pulls the edge row's west end, so row 8's centre outlasts row 9.
        const { world } = createWardenWorld(() => 0, WardenP3StartPhase.ENRAGE);
        // Row 8, the second-furthest row: still solid once the furthest (row 9) is pulled, and
        // adjacent to it so a short run north crosses the pulled boundary.
        const solidTile = wardenP3ArenaTile(3936, 5164);
        world.player!.x = (solidTile.x + 0.5) * 128;
        world.player!.y = (solidTile.y + 0.5) * 128;

        while (world.wardenP3RenderState!.arenaFloor.clearedRowCount === 0) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }

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
        stepUntilSiphonsThrown(world);
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

    // The siphons thrown during the intermission fly and leech alongside Zebak's shots.
    function zebakShots(world: GameWorld) {
        return world.projectiles.filter(
            (projectile) =>
                projectile.spec.kind === ProjectileKind.ZEBAK_PHANTOM_MAGIC ||
                projectile.spec.kind === ProjectileKind.ZEBAK_PHANTOM_RANGED,
        );
    }

    function stepUntilShotLands(world: GameWorld): void {
        while (zebakShots(world).length > 0) {
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
        expect(zebakShots(world)).toHaveLength(1);
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

    function playerTile(world: GameWorld): WardenP3ArenaTile {
        return wardenP3ArenaTile(
            Math.floor(world.player!.x / TILE_SIZE),
            Math.floor(world.player!.y / TILE_SIZE),
        );
    }

    function stepUntilCommand(world: GameWorld, kind: WardenP3Command["kind"]): void {
        for (let step = 0; step < 5000; step++) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
            if (world.wardenP3RenderState?.commands.some((command) => command.kind === kind)) {
                return;
            }
        }
        throw new Error(`Expected the Warden to issue ${kind}`);
    }

    function pulledTiles(world: GameWorld): WardenP3ArenaTile[] {
        const floor = world.wardenP3RenderState!.arenaFloor;
        return WARDEN_P3_FLOOR_DECORATIONS.tiles
            .map((tile) => wardenP3ArenaTile(tile.x, tile.y))
            .filter(
                (tile) =>
                    wardenP3TileOccupancy(floor, tile) ===
                    WardenP3ArenaTileOccupancy.DESTROYED_FLOOR,
            );
    }

    it("starts enraged below every intermission threshold with both phantoms awake", () => {
        const { world, wardenId } = createWardenWorld(Math.random, WardenP3StartPhase.ENRAGE);
        const warden = world.findEnemy(wardenId)!;

        expect(warden.animation.seqId).toBe(
            WARDEN_ANIMATIONS.stances[WardenStance.ENRAGED].transition.seqId,
        );
        expect(warden.invulnerable).toBe(false);
        expect(world.wardenP3RenderState).toMatchObject({
            activeIntermission: undefined,
            activePhantoms: [WardenPhantom.ZEBAK, WardenPhantom.BABA],
        });
        const enrage = world.wardenP3RenderState?.commands.find(
            (command) => command.kind === "ENTER_ENRAGE",
        );
        if (enrage?.kind !== "ENTER_ENRAGE") {
            throw new Error("Expected the Warden to enter its enrage");
        }
        const healthBeforeHeal = warden.health - enrage.healAmount;
        expect(healthBeforeHeal).toBeGreaterThan(0);
        expect(healthBeforeHeal).toBeLessThan(warden.maxHealth * 0.2);

        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(world.wardenP3RenderState?.activeIntermission).toBeUndefined();
    });

    it.each([
        [WardenP3StartPhase.SIPHON_1, WardenP3Intermission.FIRST, []],
        [WardenP3StartPhase.SIPHON_2, WardenP3Intermission.SECOND, [WardenPhantom.ZEBAK]],
        [
            WardenP3StartPhase.SIPHON_3,
            WardenP3Intermission.THIRD,
            [WardenPhantom.ZEBAK, WardenPhantom.BABA],
        ],
        [
            WardenP3StartPhase.SIPHON_4,
            WardenP3Intermission.FOURTH,
            [WardenPhantom.ZEBAK, WardenPhantom.BABA],
        ],
    ])(
        "starts %s charging its intermission with the phantoms woken by then",
        (startPhase, intermission, phantoms) => {
            const { world, wardenId } = createWardenWorld(Math.random, startPhase);

            expect(world.findEnemy(wardenId)!.invulnerable).toBe(true);
            expect(world.wardenP3RenderState).toMatchObject({
                activeIntermission: intermission,
                activePhantoms: phantoms,
            });
            expect(stepUntilSiphonsThrown(world)).toHaveLength(4);
        },
    );

    it("pulls the enrage floor a tile at a time from the furthest row, flying each into the Warden", () => {
        const { world } = createWardenWorld(seededRandom(5), WardenP3StartPhase.ENRAGE);
        placePlayerOn(world, wardenP3ArenaTile(3936, 5158));

        for (let pull = 1; pull <= 3; pull++) {
            stepUntilCommand(world, "PULL_ARENA_TILE");
            const pulled = pulledTiles(world);
            expect(pulled).toHaveLength(pull);
            expect(pulled.every((tile) => tile.y === 5165)).toBe(true);
        }
        expect(
            world.projectiles.filter(
                (projectile) => projectile.spec.kind === ProjectileKind.WARDENS_PULLED_TILE,
            ),
        ).toHaveLength(3);
    });

    it("moves a player off a pulled tile onto the nearest solid floor without hurting them", () => {
        // Always pulls the edge row's west end first.
        const { world } = createWardenWorld(() => 0, WardenP3StartPhase.ENRAGE);
        const doomed = wardenP3ArenaTile(3926, 5165);
        placePlayerOn(world, doomed);
        const startingHealth = world.player!.health;

        stepUntilCommand(world, "PULL_ARENA_TILE");

        expect(pulledTiles(world)).toEqual([doomed]);
        const floor = world.wardenP3RenderState!.arenaFloor;
        expect(canOccupyWardenP3ArenaTile(floor, playerTile(world))).toBe(true);
        expect(playerTile(world)).toEqual(wardenP3ArenaTile(3926, 5164));
        expect(world.player!.health).toBe(startingHealth);
    });

    function lightningWarningTiles(world: GameWorld): WardenP3ArenaTile[] {
        return world.visualEffects
            .filter((effect) => effect.kind === WARDEN_P3_LIGHTNING.warning)
            .map((effect) =>
                wardenP3ArenaTile(
                    Math.floor(effect.x / TILE_SIZE),
                    Math.floor(effect.y / TILE_SIZE),
                ),
            );
    }

    // Stands the player on a tile of the first enrage volley, or off every one when dodging, and
    // steps just past the strike. Nothing else can land on the player this early in the enrage.
    function standThroughFirstVolley(dodge: boolean): {
        readonly world: GameWorld;
        readonly startingHealth: number;
        readonly struck: readonly WardenP3ArenaTile[];
    } {
        const { world } = createWardenWorld(seededRandom(9), WardenP3StartPhase.ENRAGE);
        placePlayerOn(world, wardenP3ArenaTile(3936, 5158));
        stepUntilCommand(world, "CALL_LIGHTNING");
        const strikesAtSeconds = world.timeSeconds + WARDEN_P3_LIGHTNING.warningSeconds;
        const struck = lightningWarningTiles(world);
        const floor = world.wardenP3RenderState!.arenaFloor;
        // Clear of the rows being pulled, so the tile stays under the player until the strike.
        const standOn = dodge
            ? wardenP3SolidFloorTiles(floor).find(
                  (tile) => tile.y < 5163 && !struck.some((t) => t.x === tile.x && t.y === tile.y),
              )!
            : struck.find((tile) => tile.y < 5163)!;
        placePlayerOn(world, standOn);
        const startingHealth = world.player!.health;
        while (world.timeSeconds + STEP_SECONDS < strikesAtSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.player!.health).toBe(startingHealth);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        return { world, startingHealth, struck };
    }

    it("calls several bolts onto solid floor at once, each warned before it strikes", () => {
        const { world } = createWardenWorld(seededRandom(9), WardenP3StartPhase.ENRAGE);
        stepUntilCommand(world, "CALL_LIGHTNING");
        const floor = world.wardenP3RenderState!.arenaFloor;

        const struck = lightningWarningTiles(world);
        expect(struck).toHaveLength(WARDEN_P3_LIGHTNING.boltCount);
        for (const tile of struck) {
            expect(canOccupyWardenP3ArenaTile(floor, tile)).toBe(true);
        }
    });

    it("hurts a player on a struck tile as its bolt strikes and spares one off every struck tile", () => {
        const hit = standThroughFirstVolley(false);
        expect(hit.world.player!.health).toBe(hit.startingHealth - WARDEN_P3_LIGHTNING.damage);
        expect(
            hit.world.visualEffects.filter((effect) => effect.kind === WARDEN_P3_LIGHTNING.strike),
        ).toHaveLength(hit.struck.length);

        const dodged = standThroughFirstVolley(true);
        expect(dodged.world.player!.health).toBe(dodged.startingHealth);
    });
});
