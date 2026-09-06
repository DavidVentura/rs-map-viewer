import { SteeringBody, computeSeparation, steerChase } from "./steering";

describe("computeSeparation", () => {
    it("separates two enemies occupying the exact same spot, symmetrically", () => {
        const a: SteeringBody = { id: 1, x: 100, y: 100, hitRadius: 64 };
        const b: SteeringBody = { id: 2, x: 100, y: 100, hitRadius: 64 };

        const pushA = computeSeparation(a, [b], 32);
        const pushB = computeSeparation(b, [a], 32);

        expect(Math.hypot(pushA.x, pushA.y)).toBeCloseTo(1);
        expect(Math.hypot(pushB.x, pushB.y)).toBeCloseTo(1);
        expect(pushA.x).toBeCloseTo(-pushB.x);
        expect(pushA.y).toBeCloseTo(-pushB.y);
    });

    it("pushes away from an overlapping neighbour", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };
        const neighbour: SteeringBody = { id: 2, x: 50, y: 0, hitRadius: 64 };

        const push = computeSeparation(self, [neighbour], 32);

        expect(push.x).toBeLessThan(0);
        expect(push.y).toBeCloseTo(0);
    });

    it("has no effect from a neighbour beyond the combined hit radii plus margin", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };
        const farNeighbour: SteeringBody = { id: 2, x: 1000, y: 0, hitRadius: 64 };

        const push = computeSeparation(self, [farNeighbour], 32);

        expect(push).toEqual({ x: 0, y: 0 });
    });

    it("ignores an entry in the neighbour list that is the self body", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };

        const push = computeSeparation(self, [self], 32);

        expect(push).toEqual({ x: 0, y: 0 });
    });
});

describe("steerChase", () => {
    it("keeps overall approach when blended with a light side separation", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };
        const neighbour: SteeringBody = { id: 2, x: 0, y: 50, hitRadius: 64 };

        const result = steerChase(1, 0, false, self, [neighbour], 32);

        expect(result.x).toBeGreaterThan(0);
    });

    it("returns the pure chase direction when there are no nearby neighbours", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };

        const result = steerChase(1, 0, false, self, [], 32);

        expect(result).toEqual({ x: 1, y: 0 });
    });

    it("stops pushing toward the player once touching, cancelling a directly-behind push", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };
        const neighbourBehind: SteeringBody = { id: 2, x: -50, y: 0, hitRadius: 64 };

        const result = steerChase(1, 0, true, self, [neighbourBehind], 32);

        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(0);
    });

    it("still lets a touching enemy fan out sideways from lateral pressure", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };
        const neighbourSide: SteeringBody = { id: 2, x: 0, y: 50, hitRadius: 64 };

        const result = steerChase(1, 0, true, self, [neighbourSide], 32);

        expect(result.y).toBeLessThan(0);
    });

    it("returns zero when touching the player with no neighbours to separate from", () => {
        const self: SteeringBody = { id: 1, x: 0, y: 0, hitRadius: 64 };

        const result = steerChase(1, 0, true, self, [], 32);

        expect(result).toEqual({ x: 0, y: 0 });
    });
});
