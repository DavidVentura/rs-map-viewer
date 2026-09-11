import {
    AbilityTarget,
    AbilityTargetKind,
    CircleCenter,
    ConeDelivery,
    DeliveryKind,
} from "./Ability";
import { Combatant, Faction } from "./Combatant";
import { Affects } from "./Effect";
import {
    CONE_TILE_MAX_JITTER,
    CONE_TILE_STAGGER_SECONDS,
    DirectDelivery,
    affectedCombatants,
    coneTileSpawns,
} from "./EffectResolution";
import { TILE_SIZE } from "./Terrain";
import { directionToRotation } from "./projectileMath";

function makeCombatant(
    x: number,
    y: number,
    faction: Faction,
    overrides?: Partial<Combatant>,
): Combatant {
    return {
        x,
        y,
        rotation: 0,
        level: 0,
        faction,
        hitRadius: 16,
        projectileLaunchHeight: 40,
        health: 10,
        maxHealth: 10,
        ...overrides,
    };
}

function at(combatant: Combatant): AbilityTarget {
    return { kind: AbilityTargetKind.COMBATANT, combatant };
}

function point(x: number, y: number): AbilityTarget {
    return { kind: AbilityTargetKind.POINT, x, y };
}

const TARGET: DirectDelivery = { kind: DeliveryKind.TARGET, reach: 48 };
const CONE: DirectDelivery = { kind: DeliveryKind.CONE, angleRadians: Math.PI / 2, reach: 300 };
const CIRCLE_AT_TARGET: DirectDelivery = {
    kind: DeliveryKind.CIRCLE,
    radiusTiles: 1,
    center: CircleCenter.TARGET,
};
const CIRCLE_AT_CASTER: DirectDelivery = {
    kind: DeliveryKind.CIRCLE,
    radiusTiles: 1,
    center: CircleCenter.CASTER,
};

describe("affectedCombatants: TARGET", () => {
    const caster = makeCombatant(0, 0, Faction.PLAYER);

    it("is the aimed combatant when within reach plus both hit radii", () => {
        const aimed = makeCombatant(48 + 16 + 16, 0, Faction.ENEMY);
        expect(affectedCombatants(caster, TARGET, Affects.HOSTILE, at(aimed), [aimed])).toEqual([
            aimed,
        ]);
    });

    it("is empty when the aimed combatant is out of reach, dead, or off-level", () => {
        const far = makeCombatant(48 + 16 + 16 + 1, 0, Faction.ENEMY);
        const dead = makeCombatant(0, 0, Faction.ENEMY, { health: 0 });
        const upstairs = makeCombatant(0, 0, Faction.ENEMY, { level: 1 });
        for (const aimed of [far, dead, upstairs]) {
            expect(affectedCombatants(caster, TARGET, Affects.HOSTILE, at(aimed), [aimed])).toEqual(
                [],
            );
        }
    });

    it("is empty when aimed at a bare point or at a combatant the effect does not affect", () => {
        const enemy = makeCombatant(10, 0, Faction.ENEMY);
        const ally = makeCombatant(10, 0, Faction.PLAYER);
        expect(affectedCombatants(caster, TARGET, Affects.HOSTILE, point(10, 0), [enemy])).toEqual(
            [],
        );
        expect(affectedCombatants(caster, TARGET, Affects.HOSTILE, at(ally), [ally])).toEqual([]);
        expect(affectedCombatants(caster, TARGET, Affects.ALLIED, at(ally), [ally])).toEqual([
            ally,
        ]);
    });
});

describe("affectedCombatants: CONE", () => {
    const caster = makeCombatant(0, 0, Faction.PLAYER, { rotation: directionToRotation(0, 1) });

    it("includes hostile combatants inside the arc and reach, never the caster", () => {
        const ahead = makeCombatant(0, 200, Faction.ENEMY);
        const behind = makeCombatant(0, -200, Faction.ENEMY);
        const aside = makeCombatant(200, 0, Faction.ENEMY);
        const tooFar = makeCombatant(0, 400, Faction.ENEMY);
        expect(
            affectedCombatants(caster, CONE, Affects.HOSTILE, point(0, 200), [
                caster,
                ahead,
                behind,
                aside,
                tooFar,
            ]),
        ).toEqual([ahead]);
    });

    it("hits the cone regardless of the aim target itself", () => {
        const ahead = makeCombatant(0, 200, Faction.ENEMY);
        expect(affectedCombatants(caster, CONE, Affects.HOSTILE, point(0, -500), [ahead])).toEqual([
            ahead,
        ]);
    });

    it("filters by faction relative to the caster", () => {
        const ally = makeCombatant(0, 200, Faction.PLAYER);
        const enemy = makeCombatant(0, 220, Faction.ENEMY);
        expect(
            affectedCombatants(caster, CONE, Affects.ALLIED, point(0, 200), [ally, enemy]),
        ).toEqual([ally]);
    });
});

describe("affectedCombatants: CIRCLE", () => {
    const caster = makeCombatant(0, 0, Faction.ENEMY);

    it("centres on the aimed combatant or point for a TARGET-centred circle", () => {
        const aimed = makeCombatant(1000, 0, Faction.PLAYER);
        const nextToAimed = makeCombatant(1100, 0, Faction.PLAYER);
        const nextToCaster = makeCombatant(50, 0, Faction.PLAYER);
        const combatants = [caster, aimed, nextToAimed, nextToCaster];
        expect(
            affectedCombatants(caster, CIRCLE_AT_TARGET, Affects.HOSTILE, at(aimed), combatants),
        ).toEqual([aimed, nextToAimed]);
        expect(
            affectedCombatants(
                caster,
                CIRCLE_AT_TARGET,
                Affects.HOSTILE,
                point(1000, 0),
                combatants,
            ),
        ).toEqual([aimed, nextToAimed]);
    });

    it("centres on the caster for a CASTER-centred circle, whatever the aim", () => {
        const nearAlly = makeCombatant(100, 0, Faction.ENEMY);
        const farAlly = makeCombatant(1000, 0, Faction.ENEMY);
        const nearEnemy = makeCombatant(-100, 0, Faction.PLAYER);
        const combatants = [caster, nearAlly, farAlly, nearEnemy];
        expect(
            affectedCombatants(
                caster,
                CIRCLE_AT_CASTER,
                Affects.ALLIED,
                point(1000, 0),
                combatants,
            ),
        ).toEqual([caster, nearAlly]);
        expect(
            affectedCombatants(caster, CIRCLE_AT_CASTER, Affects.SELF, point(1000, 0), combatants),
        ).toEqual([caster]);
        expect(
            affectedCombatants(
                caster,
                CIRCLE_AT_CASTER,
                Affects.HOSTILE,
                point(1000, 0),
                combatants,
            ),
        ).toEqual([nearEnemy]);
    });

    it("hits the same combatants whichever side casts it, filtered by the caster's faction", () => {
        const player = makeCombatant(0, 0, Faction.PLAYER);
        const enemy = makeCombatant(50, 0, Faction.ENEMY);
        const otherEnemy = makeCombatant(-50, 0, Faction.ENEMY);
        const combatants = [player, enemy, otherEnemy];
        expect(
            affectedCombatants(player, CIRCLE_AT_CASTER, Affects.HOSTILE, point(0, 0), combatants),
        ).toEqual([enemy, otherEnemy]);
        expect(
            affectedCombatants(enemy, CIRCLE_AT_CASTER, Affects.HOSTILE, point(0, 0), combatants),
        ).toEqual([player]);
    });
});

describe("coneTileSpawns", () => {
    const facingNorth = directionToRotation(0, 1);
    const wideCone: ConeDelivery = {
        kind: DeliveryKind.CONE,
        angleRadians: (2 * Math.PI) / 3,
        reach: 3 * TILE_SIZE,
    };
    const casterX = 0.5 * TILE_SIZE;
    const casterY = 0.5 * TILE_SIZE;
    const noJitter = () => 0;

    function tileOf(spawn: { x: number; y: number }): [number, number] {
        return [Math.floor(spawn.x / TILE_SIZE), Math.floor(spawn.y / TILE_SIZE)];
    }

    it("covers exactly the tiles whose centres lie within the arc and reach", () => {
        const tiles = coneTileSpawns(casterX, casterY, facingNorth, wideCone, noJitter).map(tileOf);
        expect(new Set(tiles.map(String))).toEqual(
            new Set(
                [
                    [0, 1],
                    [-1, 1],
                    [1, 1],
                    [0, 2],
                    [-1, 2],
                    [1, 2],
                    [-2, 2],
                    [2, 2],
                    [0, 3],
                ].map(String),
            ),
        );
    });

    it("never includes the caster's own tile", () => {
        const spawns = coneTileSpawns(casterX, casterY, facingNorth, wideCone, noJitter);
        expect(spawns.map(tileOf)).not.toContainEqual([0, 0]);
        expect(spawns.length).toBeGreaterThan(0);
    });

    it("follows the facing rotation", () => {
        const facingEast = directionToRotation(1, 0);
        const tiles = coneTileSpawns(casterX, casterY, facingEast, wideCone, noJitter).map(tileOf);
        expect(tiles).toContainEqual([3, 0]);
        expect(tiles).not.toContainEqual([0, 3]);
    });

    it("orders nearest first with a delay that grows with distance in tiles", () => {
        const spawns = coneTileSpawns(casterX, casterY, facingNorth, wideCone, noJitter);
        const delays = spawns.map((spawn) => spawn.delaySeconds);
        expect(delays).toEqual([...delays].sort((a, b) => a - b));
        expect(delays[0]).toBeCloseTo(1 * CONE_TILE_STAGGER_SECONDS);
        expect(delays[delays.length - 1]).toBeCloseTo(3 * CONE_TILE_STAGGER_SECONDS);
        expect(spawns[1].delaySeconds).toBeCloseTo(Math.SQRT2 * CONE_TILE_STAGGER_SECONDS);
    });

    it("lands on the exact tile centre without jitter", () => {
        const [nearest] = coneTileSpawns(casterX, casterY, facingNorth, wideCone, noJitter);
        expect(nearest).toEqual({
            x: 0.5 * TILE_SIZE,
            y: 1.5 * TILE_SIZE,
            delaySeconds: CONE_TILE_STAGGER_SECONDS,
        });
    });

    it("jitters each spawn off its tile centre by at most the jitter bound, deterministically", () => {
        const lcg = () => {
            let seed = 12345;
            return () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
        };
        const first = coneTileSpawns(casterX, casterY, facingNorth, wideCone, lcg());
        const second = coneTileSpawns(casterX, casterY, facingNorth, wideCone, lcg());
        expect(second).toEqual(first);
        for (const spawn of first) {
            const [tileX, tileY] = tileOf(spawn);
            const offset = Math.hypot(
                spawn.x - (tileX + 0.5) * TILE_SIZE,
                spawn.y - (tileY + 0.5) * TILE_SIZE,
            );
            expect(offset).toBeLessThanOrEqual(CONE_TILE_MAX_JITTER);
        }
        expect(first.some((spawn) => spawn.x % TILE_SIZE !== 0.5 * TILE_SIZE)).toBe(true);
    });
});
