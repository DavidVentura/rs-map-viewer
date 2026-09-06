import { Faction } from "./Combatant";
import {
    ARROW_SPEC,
    FIRE_BOLT_HIT_SEQ_ID,
    FIRE_BOLT_TRAVEL_SEQ_ID,
    MAGIC_SPEC,
    POWER_SHOT_SPEC,
    Projectile,
    ProjectileKind,
    ProjectileOutcome,
    ProjectileSpec,
} from "./Projectile";
import { VisualEffectKind } from "./VisualEffect";

class FakeCombatant {
    readonly hitRadius = 32;
    readonly maxHealth = 100;
    health = 100;

    constructor(
        public x: number,
        public y: number,
        readonly level: number,
        readonly faction: Faction,
    ) {}
}

const seqTypeLoader = { load: () => ({ frameIds: undefined }) } as any;
const seqFrameLoader = {} as any;

function update(
    projectile: Projectile,
    dtSeconds: number,
    combatants: any[] = [],
    events: any[] = [],
) {
    return projectile.update(dtSeconds, combatants, events, seqTypeLoader, seqFrameLoader);
}

describe("Projectile specs", () => {
    it("gives arrows an arc and magic a flat trajectory", () => {
        expect(ARROW_SPEC.kind).toBe(ProjectileKind.ARROW);
        expect(ARROW_SPEC.arc.maxHeight).toBeGreaterThan(0);
        expect(MAGIC_SPEC.kind).toBe(ProjectileKind.MAGIC);
        expect(MAGIC_SPEC.arc.maxHeight).toBe(0);
    });

    it("gives the arrow no real travel sequence and magic a real one", () => {
        expect(ARROW_SPEC.travelSeqId).toBe(-1);
        expect(MAGIC_SPEC.travelSeqId).toBe(FIRE_BOLT_TRAVEL_SEQ_ID);
    });

    it("gives only magic bolts an on-hit visual effect", () => {
        expect(ARROW_SPEC.hitEffect).toBeUndefined();
        expect(MAGIC_SPEC.hitEffect).toEqual({
            kind: VisualEffectKind.MAGIC_HIT,
            seqId: FIRE_BOLT_HIT_SEQ_ID,
            height: 124,
        });
    });
});

describe("Projectile animation", () => {
    it("keeps the arrow's animation on frame 0", () => {
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        update(projectile, 0.5);
        expect(projectile.animation.frame).toBe(0);
    });
});

describe("Projectile travel", () => {
    it("moves along its direction at the spec's speed", () => {
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1000, 0, 1000);
        update(projectile, 0.1);
        expect(projectile.x).toBeCloseTo(ARROW_SPEC.speed * 0.1);
        expect(projectile.y).toBeCloseTo(0);
    });

    it("normalizes the supplied direction", () => {
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 10, 0, 1000);
        update(projectile, 0.1);
        expect(projectile.x).toBeCloseTo(ARROW_SPEC.speed * 0.1);
    });

    it("arcs upward mid-flight for arrows", () => {
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        update(projectile, 1000 / ARROW_SPEC.speed / 2);
        expect(projectile.height).toBeGreaterThan(Projectile.START_HEIGHT);
    });

    it("stays at a flat height for magic projectiles", () => {
        const projectile = new Projectile(MAGIC_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        update(projectile, 1000 / MAGIC_SPEC.speed / 2);
        expect(projectile.height).toBe(Projectile.START_HEIGHT);
    });

    it("expires once it travels beyond its max range", () => {
        const shortSpec: ProjectileSpec = { ...ARROW_SPEC, range: 100 };
        const projectile = new Projectile(shortSpec, Faction.PLAYER, 0, 0, 0, 1, 0, 100);
        expect(update(projectile, 200 / shortSpec.speed)).toBe(ProjectileOutcome.EXPIRED);
    });

    it("keeps flying while under its max range", () => {
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        expect(update(projectile, 0.01)).toBe(ProjectileOutcome.ALIVE);
    });
});

describe("Projectile collision", () => {
    it("hits a hostile combatant it sweeps through and applies damage", () => {
        const enemy = new FakeCombatant(500, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 500);
        const outcome = update(projectile, 500 / ARROW_SPEC.speed, [enemy], []);
        expect(outcome).toBe(ProjectileOutcome.HIT);
        expect(enemy.health).toBe(100 - ARROW_SPEC.damage);
    });

    it("stops at the point of impact rather than passing through", () => {
        const enemy = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        update(projectile, 1000 / ARROW_SPEC.speed, [enemy], []);
        expect(projectile.x).toBeLessThan(200);
    });

    it("does not hit combatants sharing the projectile's faction", () => {
        const ally = new FakeCombatant(200, 0, 0, Faction.PLAYER);
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        const outcome = update(projectile, 1000 / ARROW_SPEC.speed, [ally], []);
        expect(outcome).toBe(ProjectileOutcome.ALIVE);
        expect(ally.health).toBe(100);
    });

    it("does not hit combatants on a different level", () => {
        const enemy = new FakeCombatant(200, 0, 1, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        const outcome = update(projectile, 1000 / ARROW_SPEC.speed, [enemy], []);
        expect(outcome).toBe(ProjectileOutcome.ALIVE);
        expect(enemy.health).toBe(100);
    });
});

describe("Projectile piercing", () => {
    it("gives power shot piercing and the basic arrow non-piercing", () => {
        expect(ARROW_SPEC.piercing).toBe(false);
        expect(POWER_SHOT_SPEC.piercing).toBe(true);
    });

    it("stops at the first hit for a non-piercing projectile", () => {
        const near = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const far = new FakeCombatant(400, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        const outcome = update(projectile, 400 / ARROW_SPEC.speed, [near, far], []);
        expect(outcome).toBe(ProjectileOutcome.HIT);
        expect(near.health).toBeLessThan(100);
        expect(far.health).toBe(100);
    });

    it("continues through multiple hostile combatants for a piercing projectile", () => {
        const near = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const far = new FakeCombatant(400, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(POWER_SHOT_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        // Hits register one sweep-step at a time, so advance in small increments
        // to let the projectile reach and pass through both combatants in turn.
        let outcome = ProjectileOutcome.ALIVE;
        for (let i = 0; i < 50 && outcome === ProjectileOutcome.ALIVE; i++) {
            outcome = update(projectile, 0.01, [near, far], []);
        }
        expect(near.health).toBe(100 - POWER_SHOT_SPEC.damage);
        expect(far.health).toBe(100 - POWER_SHOT_SPEC.damage);
    });

    it("does not damage the same combatant twice while still overlapping it", () => {
        const enemy = new FakeCombatant(200, 0, 0, Faction.ENEMY);
        const projectile = new Projectile(POWER_SHOT_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000);
        update(projectile, 250 / POWER_SHOT_SPEC.speed, [enemy], []);
        const healthAfterFirstHit = enemy.health;
        update(projectile, 0.001, [enemy], []);
        expect(enemy.health).toBe(healthAfterFirstHit);
    });
});

describe("Projectile homing", () => {
    const homingSpec: ProjectileSpec = { ...MAGIC_SPEC, homing: true };

    it("re-aims toward its target each step when the spec is homing", () => {
        const target = new FakeCombatant(1000, 1000, 0, Faction.ENEMY);
        const projectile = new Projectile(homingSpec, Faction.PLAYER, 0, 0, 0, 1, 0, 1000, target);
        update(projectile, 0.001);
        expect(projectile.y).toBeGreaterThan(0);
    });

    it("does not re-aim when the spec is not homing", () => {
        const target = new FakeCombatant(1000, 1000, 0, Faction.ENEMY);
        const projectile = new Projectile(ARROW_SPEC, Faction.PLAYER, 0, 0, 0, 1, 0, 1000, target);
        update(projectile, 0.001);
        expect(projectile.y).toBe(0);
    });
});
