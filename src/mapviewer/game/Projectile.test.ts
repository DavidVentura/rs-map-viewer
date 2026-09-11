import { Combatant, Faction } from "./Combatant";
import { Affects, PayloadKind, damagePayload } from "./Effect";
import {
    ARROW_SPEC,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    JAD_RANGED_ROCK_SPEC,
    MAGIC_SPEC,
    POWER_SHOT_SPEC,
    Projectile,
    ProjectileImpact,
    ProjectileKind,
    ProjectileOutcome,
    ProjectileSpec,
    ProjectileTarget,
    VOLLEY_ARROW_SPEC,
    travelSeconds,
} from "./Projectile";
import { VisualEffectKind } from "./VisualEffect";

class FakeCombatant implements Combatant {
    readonly hitRadius = 32;
    readonly projectileLaunchHeight = 40;
    readonly maxHealth = 100;
    health = 100;
    rotation = 0;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly faction: Faction,
    ) {}
}

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;
const seqFrameLoader = {} as any;
const START = { x: 0, y: 0, height: 40 };
const flatTerrain = { getHeight: () => 0 } as any;
const DAMAGE = 7;

function impact(faction: Faction, affects: Affects = Affects.HOSTILE): ProjectileImpact {
    return {
        caster: new FakeCombatant(0, 0, 0, faction),
        affects,
        payloads: [damagePayload(DAMAGE)],
    };
}

const PLAYER_SHOT = impact(Faction.PLAYER);
const ENEMY_SHOT = impact(Faction.ENEMY);

function update(
    projectile: Projectile,
    dtSeconds: number,
    combatants: any[] = [],
    events: any[] = [],
): ProjectileOutcome {
    return projectile.update(
        dtSeconds,
        0,
        combatants,
        events,
        () => 0,
        flatTerrain,
        seqTypeLoader,
        seqFrameLoader,
    );
}

function fly(projectile: Projectile, seconds: number, combatants: any[] = []): ProjectileOutcome {
    const dt = 1 / 120;
    let outcome: ProjectileOutcome = { kind: "ALIVE" };
    for (let elapsed = 0; elapsed < seconds && outcome.kind === "ALIVE"; elapsed += dt) {
        outcome = update(projectile, dt, combatants, []);
    }
    return outcome;
}

function point(x: number, y: number): ProjectileTarget {
    return { kind: "POINT", x, y };
}

function tracked(combatant: FakeCombatant): ProjectileTarget {
    return { kind: "COMBATANT", combatant };
}

describe("Projectile specs", () => {
    it("lobs the aimed arrow at its tracked target and flies the magic bolt flat at it", () => {
        expect(ARROW_SPEC.kind).toBe(ProjectileKind.ARROW);
        expect(ARROW_SPEC.landing.kind).toBe("TRACKED_COMBATANT");
        expect(ARROW_SPEC.launchAngleRadians).toBeGreaterThan(0);
        expect(MAGIC_SPEC.kind).toBe(ProjectileKind.MAGIC);
        expect(MAGIC_SPEC.landing.kind).toBe("TRACKED_COMBATANT");
        expect(MAGIC_SPEC.launchAngleRadians).toBe(0);
    });

    it("gives volley's arrows a free flight unlike the single aimed shot", () => {
        expect(VOLLEY_ARROW_SPEC.landing).toEqual({
            kind: "FREE_FLIGHT",
            hitRadius: 16,
            piercing: false,
        });
        expect(POWER_SHOT_SPEC.landing).toEqual({
            kind: "FREE_FLIGHT",
            hitRadius: 24,
            piercing: true,
        });
    });

    it("drops Jad's rock from above its landing point over a fixed time", () => {
        expect(JAD_RANGED_ROCK_SPEC.landing.kind).toBe("FIXED_POINT");
        if (JAD_RANGED_ROCK_SPEC.landing.kind !== "FIXED_POINT") {
            throw new Error("expected the rock to land at a fixed point");
        }
        expect(JAD_RANGED_ROCK_SPEC.landing.origin).toEqual({ kind: "AT_TARGET", height: 0 });
        expect(JAD_RANGED_ROCK_SPEC.travelTime.secondsPerTile).toBe(0);
        expect(JAD_RANGED_ROCK_SPEC.landing.telegraph?.kind).toBe(VisualEffectKind.FALLING_SHADOW);
    });

    it("gives the arrow no real travel sequence and magic a real one", () => {
        expect(ARROW_SPEC.travelSeqId).toBe(-1);
        expect(MAGIC_SPEC.travelSeqId).toBe(FIRE_BOLT_TRAVEL_SEQ_ID);
    });
});

describe("travelSeconds", () => {
    it("adds the per-tile time on top of the base time", () => {
        expect(travelSeconds({ baseSeconds: 0.5, secondsPerTile: 0.1 }, 4 * 128)).toBeCloseTo(0.9);
    });
});

describe("Projectile animation", () => {
    it("keeps the arrow's animation on frame 0", () => {
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(0, 1000));
        update(projectile, 0.5);
        expect(projectile.animation.frame).toBe(0);
    });
});

describe("Projectile travel", () => {
    it("starts at its launch point facing the target", () => {
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(0, 1000));
        expect(projectile.x).toBe(0);
        expect(projectile.height).toBe(40);
        expect(projectile.rotation).toBe(1024);
        expect(projectile.pitch).toBeGreaterThan(0);
    });

    it("covers the distance at the spec's travel time", () => {
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(1000, 0));
        const total = travelSeconds(ARROW_SPEC.travelTime, 1000);
        update(projectile, total / 2);
        expect(projectile.x).toBeCloseTo(500);
        expect(projectile.y).toBeCloseTo(0);
    });

    it("arcs upward mid-flight for arrows", () => {
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(0, 1000));
        update(projectile, travelSeconds(ARROW_SPEC.travelTime, 1000) / 2);
        expect(projectile.height).toBeGreaterThan(START.height);
    });

    it("keeps a zero-angle free-flight arrow at its launch height", () => {
        const projectile = new Projectile(VOLLEY_ARROW_SPEC, PLAYER_SHOT, START, point(0, 1000));
        update(projectile, travelSeconds(VOLLEY_ARROW_SPEC.travelTime, 1000) / 2);
        expect(projectile.height).toBeCloseTo(START.height);
        expect(projectile.pitch).toBe(0);
    });

    it("expires once a free-flight projectile reaches its end point", () => {
        const projectile = new Projectile(VOLLEY_ARROW_SPEC, PLAYER_SHOT, START, point(0, 100));
        const outcome = update(projectile, travelSeconds(VOLLEY_ARROW_SPEC.travelTime, 100));
        expect(outcome).toEqual({ kind: "EXPIRED" });
        expect(projectile.y).toBe(100);
    });

    it("keeps flying while short of its end point", () => {
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(0, 1000));
        expect(update(projectile, 0.01)).toEqual({ kind: "ALIVE" });
    });
});

describe("Projectile collision (free flight)", () => {
    it("hits a hostile combatant it sweeps through and applies damage", () => {
        const enemy = new FakeCombatant(500, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(VOLLEY_ARROW_SPEC, PLAYER_SHOT, START, point(1000, 0));
        const outcome = fly(projectile, 2, [enemy]);
        expect(outcome).toEqual({ kind: "HIT_COMBATANT", combatant: enemy });
        expect(enemy.health).toBe(100 - DAMAGE);
    });

    it("stops at the point of impact rather than passing through", () => {
        const enemy = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(VOLLEY_ARROW_SPEC, PLAYER_SHOT, START, point(1000, 0));
        update(projectile, travelSeconds(VOLLEY_ARROW_SPEC.travelTime, 1000), [enemy], []);
        expect(projectile.x).toBeLessThan(200);
    });

    it("does not hit combatants the projectile does not affect", () => {
        const ally = new FakeCombatant(200, 0, 0, Faction.PLAYER);
        const projectile = new Projectile(VOLLEY_ARROW_SPEC, PLAYER_SHOT, START, point(1000, 0));
        expect(update(projectile, 0.1, [ally], [])).toEqual({ kind: "ALIVE" });
        expect(ally.health).toBe(100);
    });

    it("hits allies instead when fired with an ALLIED impact", () => {
        const ally = new FakeCombatant(200, 0, 0, Faction.PLAYER);
        const enemy = new FakeCombatant(100, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(
            VOLLEY_ARROW_SPEC,
            impact(Faction.PLAYER, Affects.ALLIED),
            START,
            point(1000, 0),
        );
        const outcome = fly(projectile, 2, [ally, enemy]);
        expect(outcome).toEqual({ kind: "HIT_COMBATANT", combatant: ally });
        expect(enemy.health).toBe(100);
        expect(ally.health).toBe(100 - DAMAGE);
    });

    it("lands every payload it carries, in order", () => {
        const enemy = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(
            VOLLEY_ARROW_SPEC,
            {
                ...PLAYER_SHOT,
                payloads: [damagePayload(DAMAGE), { kind: PayloadKind.FREEZE, seconds: 2 }],
            },
            START,
            point(1000, 0),
        );
        fly(projectile, 2, [enemy]);
        expect(enemy.health).toBe(100 - DAMAGE);
        expect((enemy as { frozenUntil?: number }).frozenUntil).toBe(2);
    });

    it("does not hit combatants on a different level", () => {
        const enemy = new FakeCombatant(200, 0, 1, Faction.ENEMY);
        const projectile = new Projectile(VOLLEY_ARROW_SPEC, PLAYER_SHOT, START, point(1000, 0));
        expect(update(projectile, 0.1, [enemy], [])).toEqual({ kind: "ALIVE" });
        expect(enemy.health).toBe(100);
    });
});

describe("Projectile piercing", () => {
    it("stops at the first hit for a non-piercing projectile", () => {
        const near = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const far = new FakeCombatant(400, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(VOLLEY_ARROW_SPEC, PLAYER_SHOT, START, point(1000, 0));
        const outcome = fly(projectile, 2, [near, far]);
        expect(outcome.kind).toBe("HIT_COMBATANT");
        expect(near.health).toBeLessThan(100);
        expect(far.health).toBe(100);
    });

    it("continues through multiple hostile combatants for a piercing projectile", () => {
        const near = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const far = new FakeCombatant(400, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(POWER_SHOT_SPEC, PLAYER_SHOT, START, point(1000, 0));
        const outcome = fly(projectile, 2, [near, far]);
        expect(outcome).toEqual({ kind: "EXPIRED" });
        expect(near.health).toBe(100 - DAMAGE);
        expect(far.health).toBe(100 - DAMAGE);
    });

    it("does not damage the same combatant twice while still overlapping it", () => {
        const enemy = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(POWER_SHOT_SPEC, PLAYER_SHOT, START, point(1000, 0));
        update(projectile, travelSeconds(POWER_SHOT_SPEC.travelTime, 1000) / 4, [enemy], []);
        const healthAfterFirstHit = enemy.health;
        expect(healthAfterFirstHit).toBeLessThan(100);
        update(projectile, 0.001, [enemy], []);
        expect(enemy.health).toBe(healthAfterFirstHit);
    });
});

describe("Projectile tracking a combatant", () => {
    it("does not hit an enemy sitting on the path before its target", () => {
        const bystander = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const target = new FakeCombatant(1000, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, tracked(target));
        expect(fly(projectile, 0.2, [bystander, target]).kind).toBe("ALIVE");
        expect(bystander.health).toBe(100);
    });

    it("lands on its target at the travel time and damages only it", () => {
        const target = new FakeCombatant(500, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, tracked(target));
        const outcome = update(projectile, travelSeconds(ARROW_SPEC.travelTime, 500), [target], []);
        expect(outcome).toEqual({ kind: "HIT_COMBATANT", combatant: target });
        expect(projectile.x).toBe(500);
        expect(projectile.height).toBe(60);
        expect(target.health).toBe(100 - DAMAGE);
    });

    it("still lands on a target that moved 2 tiles off the original line mid-flight", () => {
        const target = new FakeCombatant(500, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, tracked(target));
        const total = travelSeconds(ARROW_SPEC.travelTime, 500);
        fly(projectile, total / 2, [target]);
        target.x = 500;
        target.y = 256;
        const outcome = fly(projectile, total, [target]);
        expect(outcome).toEqual({ kind: "HIT_COMBATANT", combatant: target });
        expect(projectile.x).toBe(500);
        expect(projectile.y).toBe(256);
        expect(target.health).toBe(100 - DAMAGE);
    });

    it("flies on to where its target died and expires without damage", () => {
        const target = new FakeCombatant(500, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, tracked(target));
        const total = travelSeconds(ARROW_SPEC.travelTime, 500);
        fly(projectile, total / 2, [target]);
        target.health = 0;
        update(projectile, 1 / 120, [target], []);
        target.x = 2000;
        const outcome = fly(projectile, total, [target]);
        expect(outcome).toEqual({ kind: "EXPIRED" });
        expect(projectile.x).toBe(500);
        expect(target.health).toBe(0);
    });

    it("expires harmlessly at a bare point when fired with no combatant to track", () => {
        const enemy = new FakeCombatant(500, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(500, 0));
        const outcome = update(projectile, travelSeconds(ARROW_SPEC.travelTime, 500), [enemy], []);
        expect(outcome).toEqual({ kind: "EXPIRED" });
        expect(enemy.health).toBe(100);
    });
});

describe("Projectile pitch", () => {
    it("pitches nose up early in a lobbed flight", () => {
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(0, 1000));
        update(projectile, 0.001);
        expect(projectile.pitch).toBeGreaterThan(0);
        expect(projectile.pitch).toBeLessThan(1024);
    });

    it("pitches nose down late in a lobbed flight", () => {
        const projectile = new Projectile(ARROW_SPEC, PLAYER_SHOT, START, point(0, 1000));
        fly(projectile, travelSeconds(ARROW_SPEC.travelTime, 1000) * 0.95);
        expect(projectile.pitch).toBeGreaterThan(1024);
    });

    it("renders level rather than nose-down for a rock falling with no horizontal travel", () => {
        // The rock's spot-anim model is a bare bake with no axis realignment (see
        // ProjectileModelOrientation), so unlike the arrow it must never carry a pitch tilt: doing
        // so would swing its off-origin geometry sideways instead of tilting a nose that was never
        // built to point anywhere in particular.
        const rock = new Projectile(
            JAD_RANGED_ROCK_SPEC,
            ENEMY_SHOT,
            { x: 500, y: 500, height: 3000 },
            point(500, 500),
        );
        update(rock, 0.1);
        expect(rock.pitch).toBe(0);
    });
});

describe("Projectile landing at a fixed point", () => {
    const fixedSpec: ProjectileSpec = {
        ...ARROW_SPEC,
        landing: { kind: "FIXED_POINT", endHeight: 40, hitRadius: 48, origin: { kind: "CASTER" } },
    };

    it("damages every combatant in radius, not just the closest one, on landing", () => {
        const near = new FakeCombatant(500, 0, 0, Faction.ENEMY);
        const far = new FakeCombatant(500, 60, 0, Faction.ENEMY);
        const projectile = new Projectile(fixedSpec, PLAYER_SHOT, START, point(500, 0));
        const outcome = update(
            projectile,
            travelSeconds(fixedSpec.travelTime, 500),
            [near, far],
            [],
        );
        expect(outcome).toEqual({ kind: "LANDED", x: 500, y: 0 });
        expect(near.health).toBe(100 - DAMAGE);
        expect(far.health).toBe(100 - DAMAGE);
    });

    it("lands without damaging anything that moved out of radius", () => {
        const dodged = new FakeCombatant(2000, 2000, 0, Faction.ENEMY);
        const projectile = new Projectile(fixedSpec, PLAYER_SHOT, START, point(500, 0));
        const outcome = update(projectile, travelSeconds(fixedSpec.travelTime, 500), [dodged], []);
        expect(outcome).toEqual({ kind: "LANDED", x: 500, y: 0 });
        expect(dodged.health).toBe(100);
    });

    it("keeps Jad's rock at the landing point while its own sequence plays the fall", () => {
        const player = new FakeCombatant(500, 0, 0, Faction.PLAYER);
        const rock = new Projectile(
            JAD_RANGED_ROCK_SPEC,
            ENEMY_SHOT,
            { x: 500, y: 0, height: 0 },
            point(500, 0),
        );
        expect(update(rock, 0.8, [player], [])).toEqual({ kind: "ALIVE" });
        expect(rock.x).toBe(500);
        expect(rock.y).toBe(0);
        expect(rock.height).toBe(0);
        expect(rock.pitch).toBe(0);
        const outcome = update(rock, 0.5, [player], []);
        expect(outcome).toEqual({ kind: "LANDED", x: 500, y: 0 });
        expect(rock.height).toBe(0);
        expect(player.health).toBe(100 - DAMAGE);
    });
});
