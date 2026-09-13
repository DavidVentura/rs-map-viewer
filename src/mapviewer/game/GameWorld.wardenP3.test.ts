import { WeaponStyle } from "./Ability";
import { CombatEventKind, applyDamage } from "./CombatEvent";
import {
    WARDENS_P3_SIPHON_LAYOUT,
    WARDENS_P3_SKULL_SWARM,
    WARDENS_P3_SOUNDS,
    WardenPhantomSpawn,
} from "./Encounter";
import { EncounterActorKind, EnergySiphonActor, createPhantomActor } from "./EncounterActor";
import { Enemy } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import { EnergySiphonState } from "./EnergySiphon";
import { GameWorld } from "./GameWorld";
import { OrderEventKind, OrderTargetKind, PlayerOrderKind, SimInput } from "./PlayerOrders";
import { ProjectileKind } from "./Projectile";
import { SoundPlay } from "./SoundCue";
import { TILE_SIZE, Terrain } from "./Terrain";
import { VisualEffectKind } from "./VisualEffect";
import {
    WARDEN_P3_FLOOR_DECORATIONS,
    WARDEN_P3_INITIAL_ARENA_FLOOR,
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
    WardenStance,
} from "./WardenP3Director";
import { WARDEN_P3_LIGHTNING } from "./WardenP3Enrage";
import { FloorSlam, floorSlamArrivalSeconds, floorSlamEndsAtSeconds } from "./WardenP3FloorSlam";
import {
    WARDEN_P3_PHANTOM_DAMAGE,
    ZEBAK_PHANTOM_SHOT,
    wardenPhantomEnemyTypeId,
} from "./WardenP3Phantoms";
import { WardenP3Runtime } from "./WardenP3Runtime";
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

const EMPTY_INPUT: SimInput = { orders: [], running: false, skills: [] };

function energySiphons(world: GameWorld): EnergySiphonActor[] {
    return world.encounterActors.filter(
        (actor): actor is EnergySiphonActor => actor.kind === EncounterActorKind.ENERGY_SIPHON,
    );
}

function attackSiphon(siphon: EnergySiphonActor): SimInput {
    return {
        ...EMPTY_INPUT,
        orders: [
            {
                kind: OrderEventKind.PRESS,
                target: { kind: OrderTargetKind.ENERGY_SIPHON, siphon },
            },
        ],
    };
}

function runTowards(x: number, y: number): SimInput {
    return {
        orders: [{ kind: OrderEventKind.PRESS, target: { kind: OrderTargetKind.GROUND, x, y } }],
        running: true,
        skills: [],
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

const PHANTOM_SPAWNS: readonly WardenPhantomSpawn[] = [
    { x: 3925, y: 5152, level: 0, phantom: WardenPhantom.ZEBAK },
    { x: 3943, y: 5152, level: 0, phantom: WardenPhantom.BABA },
];

function createWardenWorld(
    random: () => number = Math.random,
    startPhase = WardenP3StartPhase.OPENING,
): {
    readonly world: GameWorld;
    readonly wardenId: number;
    readonly wardens: WardenP3Runtime;
} {
    const world = new GameWorld(new FlatTerrain(), ANIMATIONS, random);
    world.spawnPlayer(0, 0, 0);
    const wardenId = world.spawnEnemy(128, 0, 0, ANIMATIONS.enemyType(EnemyTypeId.TUMEKENS_WARDEN));
    const wardens = new WardenP3Runtime(
        world,
        wardenId,
        WARDENS_P3_SIPHON_LAYOUT,
        WARDENS_P3_SKULL_SWARM,
        PHANTOM_SPAWNS,
        WARDENS_P3_SOUNDS,
        startPhase,
    );
    world.encounterScript = wardens;
    return { world, wardenId, wardens };
}

const STEP_SECONDS = 0.01;

const WARDEN_MAX_HEALTH = ANIMATIONS.enemyType(EnemyTypeId.TUMEKENS_WARDEN).maxHealth;

// Thresholds are fractions of the Warden's health, so tests set it the same way.
function setHealthFraction(warden: Enemy, fraction: number): void {
    warden.health = warden.maxHealth * fraction;
}

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

// Orders a basic melee attack on the siphon from where it stands and steps until that order is over:
// reversed on the swing's contact frame, or refused outright by a siphon that can't be struck.
function reverseSiphon(world: GameWorld, siphon: EnergySiphonActor): void {
    world.player!.style = WeaponStyle.MELEE;
    world.player!.x = siphon.x;
    world.player!.y = siphon.y;
    world.step(attackSiphon(siphon), STEP_SECONDS);
    // The order ends as the swing starts; the siphon only flips on the swing's hit frame.
    for (let step = 0; step < 200; step++) {
        const player = world.player!;
        const swinging = !player.canUseBasicAttackIgnoringTarget(world.timeSeconds);
        const current = world.findEnergySiphon(siphon.id);
        // The last reversal resolves the intermission, which recalls every siphon.
        const reversed = !current || current.siphon.state === EnergySiphonState.REVERSED;
        if (reversed || (world.playerOrders.order.kind !== PlayerOrderKind.ATTACK && !swinging)) {
            return;
        }
        world.step(EMPTY_INPUT, STEP_SECONDS);
    }
    throw new Error("Expected the siphon attack to finish");
}

function stepUntilFirstFloorSlam(world: GameWorld): FloorSlam {
    for (let step = 0; step < 2000; step++) {
        world.step(EMPTY_INPUT, STEP_SECONDS);
        const slam = world.encounterScript?.renderState.floorSlams[0];
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
        const right = WARDEN_ANIMATIONS.slams[WardenSlamTarget.RIGHT];
        const left = WARDEN_ANIMATIONS.slams[WardenSlamTarget.LEFT];

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

    it.skip("makes the Warden invulnerable for siphons and exposes the director commands to rendering", () => {
        const { world, wardenId, wardens } = createWardenWorld();
        const warden = world.findEnemy(wardenId)!;
        const charging = WARDEN_ANIMATIONS.stances[WardenStance.CHARGING];
        const standing = WARDEN_ANIMATIONS.stances[WardenStance.STANDING];
        setHealthFraction(warden, 0.8);

        world.step(EMPTY_INPUT, 0.01);

        expect(warden.invulnerable).toBe(true);
        expect(world.encounterScript?.renderState).toMatchObject({
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

        wardens.resolveSiphons(WardenSiphonStatus.ALL_REVERSED);
        world.step(EMPTY_INPUT, 0.01);

        expect(warden.invulnerable).toBe(false);
        expect(world.encounterScript?.renderState).toMatchObject({
            activeIntermission: undefined,
            commands: [
                {
                    kind: "RESOLVE_ENERGY_SIPHONS",
                    intermission: 0,
                    status: WardenSiphonStatus.ALL_REVERSED,
                    reversalDamage: WARDEN_MAX_HEALTH * 0.05,
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

        applyDamage(warden, warden.maxHealth, undefined, []);
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

    it("hurts a player running ahead of the front only once per slam", () => {
        const { world } = createWardenWorld();
        const firstTile = wardenP3ArenaTile(3940, 5160);
        const laterTile = wardenP3ArenaTile(3944, 5162);
        placePlayerOn(world, firstTile);
        const startingHealth = world.player!.health;

        const slam = stepUntilFirstFloorSlam(world);
        expect(floorSlamArrivalSeconds(slam, laterTile)!).toBeGreaterThan(
            floorSlamArrivalSeconds(slam, firstTile)!,
        );
        while (world.player!.health === startingHealth) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        placePlayerOn(world, laterTile);
        while (world.timeSeconds < floorSlamEndsAtSeconds(slam)) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }

        expect(world.player!.health).toBe(startingHealth - 30);
    });

    // The siphons are on hold while the skull swarm is tried in their place.
    it.skip("spawns mechanic-only siphons and resolves their intermission after basic melee reverses each", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
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
        expect(world.encounterScript?.renderState.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.ALL_REVERSED,
            reversalDamage: WARDEN_MAX_HEALTH * 0.05,
        });
    });

    it.skip("lets no siphon be reversed until it has landed on its tile", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
        const [thrown] = stepUntilSiphonsThrown(world);

        reverseSiphon(world, thrown);
        expect(world.findEnergySiphon(thrown.id)?.siphon.state).toBe(EnergySiphonState.IN_FLIGHT);

        stepUntilSiphonsLand(world);
        reverseSiphon(world, thrown);
        expect(world.findEnergySiphon(thrown.id)?.siphon.state).toBe(EnergySiphonState.REVERSED);
    });

    function siphonTile(siphon: EnergySiphonActor): WardenP3ArenaTile {
        return wardenP3ArenaTile(
            Math.floor(siphon.x / TILE_SIZE),
            Math.floor(siphon.y / TILE_SIZE),
        );
    }

    it.skip("blocks the player from walking onto a landed siphon's tile but not one still in flight", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
        const [siphon] = stepUntilSiphonsThrown(world);
        expect(world.terrain.canOccupy(siphon.level, siphon.x, siphon.y)).toBe(true);

        stepUntilSiphonsLand(world);
        expect(world.terrain.canOccupy(siphon.level, siphon.x, siphon.y)).toBe(false);

        const tile = siphonTile(siphon);
        placePlayerOn(world, wardenP3ArenaTile(tile.x + 1, tile.y));
        world.step(runTowards(world.player!.x - 10000, world.player!.y), 1);
        expect(playerTile(world)).toEqual(wardenP3ArenaTile(tile.x + 1, tile.y));
    });

    it.skip("sets a player standing where a siphon lands down on the nearest open tile, unhurt", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
        const [siphon] = stepUntilSiphonsThrown(world);
        world.player!.x = siphon.x;
        world.player!.y = siphon.y;
        const startingHealth = world.player!.health;

        stepUntilSiphonsLand(world);

        const tile = siphonTile(siphon);
        expect(playerTile(world)).not.toEqual(tile);
        expect(
            Math.abs(playerTile(world).x - tile.x) + Math.abs(playerTile(world).y - tile.y),
        ).toBe(1);
        expect(world.terrain.canOccupy(0, world.player!.x, world.player!.y)).toBe(true);
        expect(world.player!.health).toBe(startingHealth);
    });

    it.skip("cues the siphon landing sound once as the siphons land, heard from each of them", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
        stepUntilSiphonsThrown(world);
        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.siphonLanding)).toEqual([]);

        const siphons = stepUntilSiphonsLand(world);

        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.siphonLanding)).toEqual([
            {
                sound: WARDENS_P3_SOUNDS.siphonLanding,
                points: siphons.map((siphon) => ({ x: siphon.x, y: siphon.y })),
            },
        ]);
    });

    it.skip("turns a reversed siphon about at its turn rate rather than snapping", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
        stepUntilSiphonsThrown(world);
        const [siphon] = stepUntilSiphonsLand(world);
        const hostileFacing = (siphon.reversedRotation + 1024) % 2048;
        expect(siphon.rotation).toBe(hostileFacing);
        const { turnUnitsPerSecond } = WARDEN_ANIMATIONS.siphons;

        siphon.siphon = { state: EnergySiphonState.REVERSED };
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(siphon.rotation).toBeCloseTo(hostileFacing + turnUnitsPerSecond * STEP_SECONDS);

        const halfTurnSeconds = 1024 / turnUnitsPerSecond;
        world.step(EMPTY_INPUT, halfTurnSeconds - 2 * STEP_SECONDS);
        expect(siphon.rotation).not.toBe(siphon.reversedRotation);
        world.step(EMPTY_INPUT, 2 * STEP_SECONDS);
        expect(siphon.rotation).toBe(siphon.reversedRotation);
    });

    it.skip("resolves a siphon intermission when its authored deadline expires after the siphons land", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
        stepUntilSiphonsThrown(world);
        const deadlineAtSeconds =
            world.timeSeconds +
            WARDEN_ANIMATIONS.siphons.flightSeconds +
            WARDENS_P3_SIPHON_LAYOUT.deadlineSeconds;

        while (world.timeSeconds + STEP_SECONDS < deadlineAtSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(energySiphons(world)).toHaveLength(4);
        while (energySiphons(world).length > 0) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }

        expect(world.timeSeconds).toBeLessThan(deadlineAtSeconds + 2 * STEP_SECONDS);
        expect(world.encounterScript?.renderState.commands).toContainEqual({
            kind: "RESOLVE_ENERGY_SIPHONS",
            intermission: 0,
            status: WardenSiphonStatus.DEADLINE_EXPIRED,
            reversalDamage: WARDEN_MAX_HEALTH * 0.05,
        });
        expect(world.encounterScript?.renderState.floorSlams).toHaveLength(1);
    });

    // Reverses reversedCount of the first intermission's siphons, then lets the rest run out the
    // deadline (or resolves at once when all are reversed), returning when the siphons fly back.
    function recallSiphons(reversedCount: number): {
        readonly world: GameWorld;
        readonly wardenId: number;
        readonly arrivesAtSeconds: number;
    } {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
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

    it.skip("flies every siphon back into the Warden, striking with the reversed ones only as they arrive", () => {
        const { world, wardenId, arrivesAtSeconds } = recallSiphons(4);
        const warden = world.findEnemy(wardenId)!;
        const recallFlights = world.projectiles.filter(
            (projectile) => projectile.spec.kind === ProjectileKind.ENERGY_SIPHON_RECALL,
        );
        expect(recallFlights).toHaveLength(4);

        while (world.timeSeconds + STEP_SECONDS < arrivesAtSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(warden.health).toBe(WARDEN_MAX_HEALTH * 0.8);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(warden.health).toBe(WARDEN_MAX_HEALTH * 0.75);
    });

    it.skip("still strikes with the siphons reversed before the deadline expired", () => {
        const { world, wardenId, arrivesAtSeconds } = recallSiphons(2);
        while (world.timeSeconds < arrivesAtSeconds + STEP_SECONDS) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.findEnemy(wardenId)!.health).toBe(WARDEN_MAX_HEALTH * 0.775);
    });

    // Drives past one of the four scripted siphon intermissions (INTERMISSION_HEALTH_FRACTIONS in
    // WardenP3Director.ts) so a later health drop reaches enrage instead of retriggering siphons.
    function clearIntermission(
        { world, wardenId, wardens }: ReturnType<typeof createWardenWorld>,
        healthFraction: number,
    ): void {
        world.findEnemy(wardenId)!.health = healthFraction * 100;
        world.step(EMPTY_INPUT, 0.01);
        wardens.resolveSiphons(WardenSiphonStatus.ALL_REVERSED);
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

        while (world.encounterScript!.renderState.arenaFloor.clearedRowCount === 0) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }

        // Runs straight at the destroyed row (y+1): movement must stop at the row boundary
        // instead of crossing onto it.
        world.step(runTowards(world.player!.x, world.player!.y + 10000), 1);
        expect(Math.floor(world.player!.y / 128)).toBe(solidTile.y);

        // The remaining floor is still walkable.
        world.step(runTowards(world.player!.x + 10000, world.player!.y), 0.05);
        expect(world.player!.x).toBeGreaterThan((solidTile.x + 0.5) * 128);
    });

    it.skip("never counts phantoms or siphons as combatants", () => {
        const { world, wardenId } = createWardenWorld();
        setHealthFraction(world.findEnemy(wardenId)!, 0.8);
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
            const release = world.encounterScript?.renderState.commands.find(
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
        const wardenWorld = createWardenWorld();
        const { world, wardenId } = wardenWorld;
        placePlayerOn(world, wardenP3ArenaTile(3936, 5162));
        clearIntermission(wardenWorld, 0.8);
        setHealthFraction(world.findEnemy(wardenId)!, 0.6);
        return world;
    }

    function soundCuesOf(world: GameWorld, sound: SoundPlay) {
        return world.drainSoundCues().filter((cue) => cue.sound === sound);
    }

    function tileCentre(tile: WardenP3Tile): { x: number; y: number } {
        return { x: (tile.x + 0.5) * TILE_SIZE, y: (tile.y + 0.5) * TILE_SIZE };
    }

    function zebakJugs(world: GameWorld) {
        return world.projectiles.filter(
            (projectile) => projectile.spec.kind === ProjectileKind.ZEBAK_PHANTOM_JUG,
        );
    }

    function zebakPieces(world: GameWorld) {
        return world.projectiles.filter(
            (projectile) =>
                projectile.spec.kind === ProjectileKind.ZEBAK_PHANTOM_ROCK ||
                projectile.spec.kind === ProjectileKind.ZEBAK_PHANTOM_ORB,
        );
    }

    // Steps from Zebak's first release to just past its jug's burst.
    function stepUntilJugBursts(world: GameWorld, beforeBurst = () => {}): void {
        const burstsAtSeconds =
            world.timeSeconds + WARDEN_ANIMATIONS.phantoms.zebakShot.riseSeconds;
        while (world.timeSeconds + STEP_SECONDS < burstsAtSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        beforeBurst();
        expect(zebakPieces(world)).toEqual([]);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(zebakPieces(world)).toHaveLength(1);
    }

    function zebakShotShadowTiles(world: GameWorld): WardenP3ArenaTile[] {
        return world.visualEffects
            .filter((effect) => effect.kind === WARDEN_ANIMATIONS.phantoms.zebakShot.fallShadow)
            .map((effect) => {
                // The shadow sits on the landing tile's centre.
                expect(effect.x % TILE_SIZE).toBe(TILE_SIZE / 2);
                expect(effect.y % TILE_SIZE).toBe(TILE_SIZE / 2);
                return wardenP3ArenaTile(
                    Math.floor(effect.x / TILE_SIZE),
                    Math.floor(effect.y / TILE_SIZE),
                );
            });
    }

    it.skip("throws Zebak's jug up over the player, bursting it high in the air into a falling piece", () => {
        const world = createZebakWorld();

        stepUntilRelease(world, WardenPhantom.ZEBAK);
        const zebak = world.encounterActors.find(
            (actor) => actor.type.id === wardenPhantomEnemyTypeId(WardenPhantom.ZEBAK),
        )!;
        expect(zebak.animation.seqId).toBe(
            WARDEN_ANIMATIONS.phantoms.attacks[WardenPhantom.ZEBAK].seq.seqId,
        );
        expect(zebakJugs(world)).toHaveLength(1);
        world.drainSoundCues();

        stepUntilJugBursts(world);
        const bursts = world.visualEffects.filter(
            (effect) => effect.kind === ZEBAK_PHANTOM_SHOT.burstEffect,
        );
        expect(bursts).toHaveLength(1);
        expect(bursts[0].height).toBe(ZEBAK_PHANTOM_SHOT.burstHeight);
        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.zebakShotBurst)).toHaveLength(1);
    });

    it.skip("lands Zebak's shot on the centre of the player's tile at the burst, hurting only if they stay on it", () => {
        const world = createZebakWorld();
        // Off the tile's centre: the shot still aims at the centre and still hits anywhere on it.
        world.player!.x = 3936 * TILE_SIZE + 10;
        const startingHealth = world.player!.health;
        stepUntilRelease(world, WardenPhantom.ZEBAK);
        stepUntilJugBursts(world, () => placePlayerOn(world, wardenP3ArenaTile(3938, 5161)));
        world.player!.x += 40;
        expect(zebakShotShadowTiles(world)).toEqual([wardenP3ArenaTile(3938, 5161)]);
        world.drainSoundCues();

        const landsAtSeconds = world.timeSeconds + WARDEN_ANIMATIONS.phantoms.zebakShot.fallSeconds;
        while (world.timeSeconds + STEP_SECONDS < landsAtSeconds - STEP_SECONDS) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.player!.health).toBe(startingHealth);
        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.zebakShotLanding)).toEqual([]);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(world.player!.health).toBe(
            startingHealth - WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.ZEBAK],
        );
        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.zebakShotLanding)).toEqual([
            {
                sound: WARDENS_P3_SOUNDS.zebakShotLanding,
                points: [{ x: 3938.5 * TILE_SIZE, y: 5161.5 * TILE_SIZE }],
            },
        ]);

        const dodgingWorld = createZebakWorld();
        const dodgingHealth = dodgingWorld.player!.health;
        stepUntilRelease(dodgingWorld, WardenPhantom.ZEBAK);
        stepUntilJugBursts(dodgingWorld);
        placePlayerOn(dodgingWorld, wardenP3ArenaTile(3939, 5162));
        while (zebakPieces(dodgingWorld).length > 0) {
            dodgingWorld.step(EMPTY_INPUT, STEP_SECONDS);
        }
        dodgingWorld.step(EMPTY_INPUT, STEP_SECONDS);
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
    // steps to Ba-Ba's first release. Zebak's first jug is still rising when the rocks land, so only
    // rocks can hurt.
    function releaseBabaRocks(playerTile: WardenP3ArenaTile): GameWorld {
        const wardenWorld = createWardenWorld(() => 0.5);
        const { world, wardenId } = wardenWorld;
        placePlayerOn(world, playerTile);
        clearIntermission(wardenWorld, 0.8);
        clearIntermission(wardenWorld, 0.6);
        setHealthFraction(world.findEnemy(wardenId)!, 0.4);
        stepUntilRelease(world, WardenPhantom.BABA);
        return world;
    }

    it.skip("drops Ba-Ba's phantom rocks on solid floor and the player's tile, hitting only as they land", () => {
        // Clear of the third intermission's siphons, which would push the player off their tile.
        const playerTile = wardenP3ArenaTile(3934, 5163);
        const world = releaseBabaRocks(playerTile);
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
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(world.player!.health).toBe(startingHealth);
        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.babaRockLanding)).toEqual([]);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(world.player!.health).toBe(
            startingHealth - WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.BABA],
        );
        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.babaRockLanding)).toEqual([
            { sound: WARDENS_P3_SOUNDS.babaRockLanding, points: struck.map(tileCentre) },
        ]);
    });

    it.skip("lets the player step out from under Ba-Ba's phantom rock before it lands", () => {
        const world = releaseBabaRocks(wardenP3ArenaTile(3936, 5162));
        const landsAtSeconds =
            world.timeSeconds + WARDEN_ANIMATIONS.phantoms.rockFall.landingSeconds;
        const struck = shadowTiles(world);
        const safeTile = wardenP3SolidFloorTiles(WARDEN_P3_INITIAL_ARENA_FLOOR).find(
            (tile) => !struck.some((target) => target.x === tile.x && target.y === tile.y),
        )!;
        placePlayerOn(world, safeTile);
        const startingHealth = world.player!.health;

        while (world.timeSeconds < landsAtSeconds + 0.5) {
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
            if (
                world.encounterScript?.renderState.commands.some((command) => command.kind === kind)
            ) {
                return;
            }
        }
        throw new Error(`Expected the Warden to issue ${kind}`);
    }

    function pulledTiles(world: GameWorld): WardenP3ArenaTile[] {
        const floor = world.encounterScript!.renderState.arenaFloor;
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
        expect(world.encounterScript?.renderState).toMatchObject({
            activeIntermission: undefined,
            activePhantoms: [WardenPhantom.ZEBAK, WardenPhantom.BABA],
        });
        const enrage = world.encounterScript?.renderState.commands.find(
            (command) => command.kind === "ENTER_ENRAGE",
        );
        if (enrage?.kind !== "ENTER_ENRAGE") {
            throw new Error("Expected the Warden to enter its enrage");
        }
        const healthBeforeHeal = warden.health - enrage.healAmount;
        expect(healthBeforeHeal).toBeGreaterThan(0);
        expect(healthBeforeHeal).toBeLessThan(warden.maxHealth * 0.2);

        world.step(EMPTY_INPUT, STEP_SECONDS);
        expect(world.encounterScript?.renderState.activeIntermission).toBeUndefined();
    });

    it.skip.each([
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
            expect(world.encounterScript?.renderState).toMatchObject({
                activeIntermission: intermission,
                activePhantoms: phantoms,
            });
            expect(stepUntilSiphonsThrown(world)).toHaveLength(
                WARDENS_P3_SIPHON_LAYOUT.spawnsByIntermission[intermission].length,
            );
        },
    );

    it("pulls the enrage floor in chunks from the furthest row, flying each tile up and away behind the Warden", () => {
        const { world } = createWardenWorld(seededRandom(5), WardenP3StartPhase.ENRAGE);
        placePlayerOn(world, wardenP3ArenaTile(3936, 5158));

        stepUntilCommand(world, "PULL_ARENA_TILES");
        const pulled = pulledTiles(world);
        expect(pulled).toHaveLength(6);
        expect(pulled.every((tile) => tile.y === 5165)).toBe(true);
        const flights = () =>
            world.projectiles.filter(
                (projectile) => projectile.spec.kind === ProjectileKind.WARDENS_PULLED_TILE,
            );
        expect(flights()).toHaveLength(6);
        const risen = flights().map((flight) => ({ y: flight.y, height: flight.height }));
        world.step(EMPTY_INPUT, 0.1);
        flights().forEach((flight, index) => {
            expect(flight.y).toBeLessThan(risen[index].y);
            expect(flight.height).toBeGreaterThan(risen[index].height);
        });

        stepUntilCommand(world, "PULL_ARENA_TILES");
        expect(pulledTiles(world)).toHaveLength(11);
    });

    it("moves a player off a pulled tile onto the nearest solid floor without hurting them", () => {
        // Always pulls the edge row's west end first.
        const { world } = createWardenWorld(() => 0, WardenP3StartPhase.ENRAGE);
        const doomed = wardenP3ArenaTile(3926, 5165);
        placePlayerOn(world, doomed);
        const startingHealth = world.player!.health;

        stepUntilCommand(world, "PULL_ARENA_TILES");

        expect(pulledTiles(world)).toContainEqual(doomed);
        const floor = world.encounterScript!.renderState.arenaFloor;
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
        const floor = world.encounterScript!.renderState.arenaFloor;
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
        const floor = world.encounterScript!.renderState.arenaFloor;

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

    it("cues the lightning strike once as a volley strikes, heard from every struck tile", () => {
        const { world } = createWardenWorld(seededRandom(9), WardenP3StartPhase.ENRAGE);
        stepUntilCommand(world, "CALL_LIGHTNING");
        const strikesAtSeconds = world.timeSeconds + WARDEN_P3_LIGHTNING.warningSeconds;
        const struck = lightningWarningTiles(world);
        while (world.timeSeconds + STEP_SECONDS < strikesAtSeconds) {
            world.step(EMPTY_INPUT, STEP_SECONDS);
        }
        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.lightningStrike)).toEqual([]);

        world.step(EMPTY_INPUT, STEP_SECONDS);
        world.step(EMPTY_INPUT, STEP_SECONDS);

        expect(soundCuesOf(world, WARDENS_P3_SOUNDS.lightningStrike)).toEqual([
            { sound: WARDENS_P3_SOUNDS.lightningStrike, points: struck.map(tileCentre) },
        ]);
    });
});
