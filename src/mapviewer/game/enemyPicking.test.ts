import { EnemyScreenCandidate, distanceToRect, pickEnemyNear } from "./enemyPicking";

const rect = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
});

describe("distanceToRect", () => {
    it("is zero for a point inside the rect", () => {
        expect(distanceToRect({ x: 5, y: 5 }, rect(0, 0, 10, 10))).toBe(0);
    });

    it("is zero for a point on the rect boundary", () => {
        expect(distanceToRect({ x: 0, y: 5 }, rect(0, 0, 10, 10))).toBe(0);
    });

    it("measures straight distance from an edge", () => {
        expect(distanceToRect({ x: 5, y: -4 }, rect(0, 0, 10, 10))).toBe(4);
    });

    it("measures diagonal distance from a corner", () => {
        expect(distanceToRect({ x: 13, y: 14 }, rect(0, 0, 10, 10))).toBe(5);
    });
});

describe("pickEnemyNear", () => {
    it("returns undefined when there are no candidates", () => {
        expect(pickEnemyNear({ x: 0, y: 0 }, [], 40)).toBeUndefined();
    });

    it("picks the enemy whose rect contains the cursor", () => {
        const candidates: EnemyScreenCandidate[] = [
            { id: 1, rect: rect(0, 0, 10, 10) },
            { id: 2, rect: rect(100, 100, 110, 110) },
        ];
        expect(pickEnemyNear({ x: 5, y: 5 }, candidates, 40)).toBe(1);
    });

    it("picks the nearest enemy within radius when the cursor is over no rect", () => {
        const candidates: EnemyScreenCandidate[] = [
            { id: 1, rect: rect(0, 0, 10, 10) },
            { id: 2, rect: rect(20, 0, 30, 10) },
        ];
        expect(pickEnemyNear({ x: 18, y: 5 }, candidates, 40)).toBe(2);
    });

    it("ignores candidates outside the radius", () => {
        const candidates: EnemyScreenCandidate[] = [{ id: 1, rect: rect(0, 0, 10, 10) }];
        expect(pickEnemyNear({ x: 100, y: 100 }, candidates, 40)).toBeUndefined();
    });

    it("breaks ties by candidate order", () => {
        const candidates: EnemyScreenCandidate[] = [
            { id: 1, rect: rect(0, 0, 10, 10) },
            { id: 2, rect: rect(20, 0, 30, 10) },
        ];
        expect(pickEnemyNear({ x: 15, y: 5 }, candidates, 40)).toBe(1);
    });
});
