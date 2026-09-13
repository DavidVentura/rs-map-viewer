import { WeaponStyle, abilityRange } from "./Ability";
import { CombatEventKind } from "./CombatEvent";
import { EnergySiphonActor, createEnergySiphonActor } from "./EncounterActor";
import { Enemy } from "./Enemy";
import { EnemyTypeId, ResolvedEnemyType } from "./EnemyType";
import { EnergySiphonState, HOSTILE_ENERGY_SIPHON } from "./EnergySiphon";
import { GameWorld } from "./GameWorld";
import { Player } from "./Player";
import {
    HOLD_THRESHOLD_SECONDS,
    OrderEvent,
    OrderEventKind,
    OrderTargetKind,
    PlayerOrderKind,
    SimInput,
} from "./PlayerOrders";
import { TILE_SIZE, Terrain } from "./Terrain";
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

const ANIMATIONS = stubEncounterAnimations();
const STEP_SECONDS = GameWorld.FIXED_STEP_SECONDS;
const IDLE_INPUT: SimInput = { orders: [], running: false, skills: [] };

// Never walks, so a test measures the player's own chase rather than two bodies converging.
const TARGET_DUMMY: ResolvedEnemyType = {
    ...ANIMATIONS.enemyType(EnemyTypeId.GOBLIN),
    walkSpeed: 0,
    maxHealth: 20,
};

function makeWorld(): GameWorld {
    const world = new GameWorld(new FlatTerrain(), ANIMATIONS, () => 0);
    world.spawnPlayer(0, 0, 0);
    return world;
}

function spawnDummy(world: GameWorld, x: number, y: number): Enemy {
    return world.findEnemy(world.spawnEnemyAtExactPosition(x, y, 0, TARGET_DUMMY))!;
}

function issue(world: GameWorld, ...orders: OrderEvent[]): void {
    world.advance(0, { ...IDLE_INPUT, orders });
}

function pressOnGround(x: number, y: number): OrderEvent {
    return { kind: OrderEventKind.PRESS, target: { kind: OrderTargetKind.GROUND, x, y } };
}

function pressOnEnemy(enemy: Enemy): OrderEvent {
    return { kind: OrderEventKind.PRESS, target: { kind: OrderTargetKind.ENEMY, enemy } };
}

const RELEASE: OrderEvent = { kind: OrderEventKind.RELEASE };

function advanceSeconds(world: GameWorld, seconds: number): void {
    const endsAt = world.timeSeconds + seconds;
    while (world.timeSeconds < endsAt) {
        world.step(IDLE_INPUT, STEP_SECONDS);
    }
}

function distanceBetween(player: Player, other: { x: number; y: number }): number {
    return Math.hypot(other.x - player.x, other.y - player.y);
}

describe("walk orders", () => {
    it("walks to a clicked point and stops exactly on it", () => {
        const world = makeWorld();
        issue(world, pressOnGround(300, 200), RELEASE);

        advanceSeconds(world, 2);

        expect(world.player!.x).toBeCloseTo(300, 6);
        expect(world.player!.y).toBeCloseTo(200, 6);
        expect(world.playerOrders.order.kind).toBe(PlayerOrderKind.IDLE);
    });

    it("follows the held pointer, then stops where it is once released", () => {
        const world = makeWorld();
        const player = world.player!;
        issue(world, pressOnGround(1000, 0));
        advanceSeconds(world, HOLD_THRESHOLD_SECONDS + 0.05);
        expect(player.x).toBeGreaterThan(0);

        issue(world, { kind: OrderEventKind.DRAG, x: 0, y: 1000 });
        const xWhenSteered = player.x;
        advanceSeconds(world, 0.2);
        expect(player.x).toBeLessThan(xWhenSteered);
        expect(player.y).toBeGreaterThan(0);

        issue(world, RELEASE, { kind: OrderEventKind.DRAG, x: -1000, y: -1000 });
        const stoppedAt = { x: player.x, y: player.y };
        advanceSeconds(world, 2);
        expect(player.x).toBe(stoppedAt.x);
        expect(player.y).toBe(stoppedAt.y);
        expect(world.playerOrders.order.kind).toBe(PlayerOrderKind.IDLE);
    });

    it("keeps walking to a held press point until the hold threshold, then stops on release", () => {
        const world = makeWorld();
        const player = world.player!;
        issue(world, pressOnGround(1000, 0));
        advanceSeconds(world, HOLD_THRESHOLD_SECONDS + 0.1);
        expect(player.x).toBeGreaterThan(0);

        issue(world, RELEASE);
        const stoppedAtX = player.x;
        advanceSeconds(world, 2);
        expect(player.x).toBe(stoppedAtX);
        expect(player.x).toBeLessThan(1000);
    });
});

describe("attack orders", () => {
    it.each([WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC])(
        "chases into range and attacks once with style %s, then stops",
        (style) => {
            const world = makeWorld();
            const player = world.player!;
            player.style = style;
            const enemy = spawnDummy(world, 0, 1000);
            issue(world, pressOnEnemy(enemy), RELEASE);

            for (let step = 0; step < 2000 && enemy.health === enemy.maxHealth; step++) {
                world.step(IDLE_INPUT, STEP_SECONDS);
            }
            const healthAfterFirstHit = enemy.health;
            expect(healthAfterFirstHit).toBeLessThan(enemy.maxHealth);
            expect(distanceBetween(player, enemy)).toBeLessThanOrEqual(
                abilityRange(player.basicAttack, player.hitRadius, enemy.hitRadius),
            );

            advanceSeconds(world, 3);

            expect(world.playerOrders.order.kind).toBe(PlayerOrderKind.IDLE);
            expect(enemy.health).toBe(healthAfterFirstHit);
        },
    );

    it.each([WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC])(
        "keeps attacking a held enemy with style %s, then lets the swing in progress land on release",
        (style) => {
            const world = makeWorld();
            const player = world.player!;
            player.style = style;
            const enemy = world.findEnemy(
                world.spawnEnemyAtExactPosition(0, 600, 0, { ...TARGET_DUMMY, maxHealth: 10000 }),
            )!;
            const attackStarts = new Set<number>();
            const stepAndCountAttacks = () => {
                world.step(IDLE_INPUT, STEP_SECONDS);
                const cast = player.abilityRuntime.activeCastAnimation(world.timeSeconds);
                if (cast) {
                    attackStarts.add(cast.startedAt);
                }
            };
            issue(world, pressOnEnemy(enemy));

            for (let step = 0; step < 5000 && attackStarts.size < 2; step++) {
                stepAndCountAttacks();
            }
            expect(attackStarts.size).toBe(2);
            expect(player.isBusy(world.timeSeconds)).toBe(true);

            issue(world, RELEASE);
            for (let step = 0; step < 3 / STEP_SECONDS; step++) {
                stepAndCountAttacks();
            }

            expect(world.playerOrders.order.kind).toBe(PlayerOrderKind.IDLE);
            expect(attackStarts.size).toBe(2);
            const hits = world.events.filter(
                (event) => event.kind === CombatEventKind.DAMAGE && event.target === enemy,
            );
            expect(hits).toHaveLength(2);
        },
    );

    it("stops attacking once a skill key is pressed", () => {
        const world = makeWorld();
        world.player!.style = WeaponStyle.MELEE;
        const enemy = spawnDummy(world, 0, 150);
        issue(world, pressOnEnemy(enemy), RELEASE);
        advanceSeconds(world, world.player!.basicAttack.timing.impactSeconds + 0.05);
        const healthAfterFirstSwing = enemy.health;
        expect(healthAfterFirstSwing).toBeLessThan(enemy.maxHealth);

        issue(world, { kind: OrderEventKind.SKILL_KEY });
        advanceSeconds(world, 3);

        expect(world.playerOrders.order.kind).toBe(PlayerOrderKind.IDLE);
        expect(enemy.health).toBe(healthAfterFirstSwing);
    });

    it("gives up the chase for a walk when the ground is clicked", () => {
        const world = makeWorld();
        world.player!.style = WeaponStyle.MELEE;
        const enemy = spawnDummy(world, 0, 2000);
        issue(world, pressOnEnemy(enemy), RELEASE);
        advanceSeconds(world, 0.5);

        issue(world, pressOnGround(-500, 0), RELEASE);
        advanceSeconds(world, 5);

        expect(world.player!.x).toBeCloseTo(-500, 6);
        expect(world.player!.y).toBeCloseTo(0, 6);
        expect(enemy.health).toBe(enemy.maxHealth);
    });

    it("lands a basic melee hit on a target most of a tile away without stepping in", () => {
        const world = makeWorld();
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const edgeGap = 0.6 * TILE_SIZE - 1;
        const enemy = spawnDummy(world, player.hitRadius + edgeGap + TARGET_DUMMY.hitRadius, 0);
        issue(world, pressOnEnemy(enemy), RELEASE);

        advanceSeconds(world, player.basicAttack.timing.impactSeconds + 0.05);

        expect(enemy.health).toBeLessThan(enemy.maxHealth);
        expect(player.x).toBe(0);
        expect(player.y).toBe(0);
    });
});

describe("energy siphon attack orders", () => {
    function placeSiphon(world: GameWorld, x: number, y: number): EnergySiphonActor {
        const siphon = createEnergySiphonActor(
            world.allocateActorId(),
            x,
            y,
            0,
            ANIMATIONS.enemyType(EnemyTypeId.ENERGY_SIPHON),
            0,
            HOSTILE_ENERGY_SIPHON,
            1,
        );
        world.encounterActors.push(siphon);
        return siphon;
    }

    function pressOnSiphon(siphon: EnergySiphonActor): OrderEvent {
        return {
            kind: OrderEventKind.PRESS,
            target: { kind: OrderTargetKind.ENERGY_SIPHON, siphon },
        };
    }

    it("walks into melee reach and reverses the siphon on the swing's contact frame", () => {
        const world = makeWorld();
        const player = world.player!;
        player.style = WeaponStyle.MELEE;
        const siphon = placeSiphon(world, 1000, 0);
        issue(world, pressOnSiphon(siphon), RELEASE);

        for (let step = 0; step < 2000 && !player.isBusy(world.timeSeconds); step++) {
            world.step(IDLE_INPUT, STEP_SECONDS);
        }
        const swing = player.basicAttack;
        const contactAt = world.timeSeconds + swing.timing.impactSeconds;
        expect(player.x).toBeGreaterThan(0);
        expect(distanceBetween(player, siphon)).toBeLessThanOrEqual(
            abilityRange(swing, player.hitRadius, siphon.type.hitRadius),
        );

        while (world.timeSeconds + STEP_SECONDS < contactAt) {
            world.step(IDLE_INPUT, STEP_SECONDS);
            expect(siphon.siphon.state).toBe(EnergySiphonState.HOSTILE);
            expect(player.animation.seqId).toBe(swing.castSeq.seqId);
        }
        world.step(IDLE_INPUT, STEP_SECONDS);
        world.step(IDLE_INPUT, STEP_SECONDS);

        expect(siphon.siphon.state).toBe(EnergySiphonState.REVERSED);
        expect(world.playerOrders.order.kind).toBe(PlayerOrderKind.IDLE);
    });

    it("refuses the order outright with a non-melee basic attack", () => {
        const world = makeWorld();
        const player = world.player!;
        player.style = WeaponStyle.RANGED;
        const siphon = placeSiphon(world, 1000, 0);
        issue(world, pressOnSiphon(siphon), RELEASE);

        advanceSeconds(world, 2);

        expect(world.playerOrders.order.kind).toBe(PlayerOrderKind.IDLE);
        expect(siphon.siphon.state).toBe(EnergySiphonState.HOSTILE);
        expect(player.x).toBe(0);
    });
});
