import { getMapSquareId } from "../rs/map/MapFileIndex";
import { ADJACENT_RADIUS, computeWantedMapIds, diffResidency, focusMapSquare } from "./MapManager";
import { MapSquareCoord } from "./MapSquareCoord";

const ENCOUNTER_SQUARES: readonly MapSquareCoord[] = [
    { mapX: 36, mapY: 78 },
    { mapX: 37, mapY: 78 },
    { mapX: 37, mapY: 79 },
];

function ids(squares: readonly MapSquareCoord[]): Set<number> {
    return new Set(squares.map(({ mapX, mapY }) => getMapSquareId(mapX, mapY)));
}

function ring(centre: MapSquareCoord): MapSquareCoord[] {
    const squares: MapSquareCoord[] = [];
    for (let dx = -ADJACENT_RADIUS; dx <= ADJACENT_RADIUS; dx++) {
        for (let dy = -ADJACENT_RADIUS; dy <= ADJACENT_RADIUS; dy++) {
            squares.push({ mapX: centre.mapX + dx, mapY: centre.mapY + dy });
        }
    }
    return squares;
}

describe("focusMapSquare", () => {
    it("maps a tile to the map square containing it", () => {
        expect(focusMapSquare({ tileX: 2398, tileY: 5078 })).toEqual({ mapX: 37, mapY: 79 });
    });

    it("stays in the same square while the tile moves inside it", () => {
        expect(focusMapSquare({ tileX: 37 * 64, tileY: 79 * 64 })).toEqual(
            focusMapSquare({ tileX: 37 * 64 + 63, tileY: 79 * 64 + 63 }),
        );
    });
});

describe("computeWantedMapIds", () => {
    it("wants the encounter squares plus the ring around the focus square at init", () => {
        const focus = { mapX: 37, mapY: 79 };

        const wanted = computeWantedMapIds(ENCOUNTER_SQUARES, focus, new Set());

        expect(wanted).toEqual(ids([...ENCOUNTER_SQUARES, ...ring(focus)]));
    });

    it("is unchanged while the focus tile stays inside the same square", () => {
        const before = computeWantedMapIds(
            ENCOUNTER_SQUARES,
            focusMapSquare({ tileX: 37 * 64, tileY: 79 * 64 }),
            new Set(),
        );
        const after = computeWantedMapIds(
            ENCOUNTER_SQUARES,
            focusMapSquare({ tileX: 37 * 64 + 63, tileY: 79 * 64 + 20 }),
            new Set(),
        );

        expect(after).toEqual(before);
    });

    it("excludes invalid squares", () => {
        const focus = { mapX: 37, mapY: 79 };
        const invalid = new Set([getMapSquareId(38, 80), getMapSquareId(36, 78)]);

        const wanted = computeWantedMapIds(ENCOUNTER_SQUARES, focus, invalid);

        expect(wanted.has(getMapSquareId(38, 80))).toBe(false);
        expect(wanted.has(getMapSquareId(36, 78))).toBe(false);
        expect(wanted.size).toBe(ids([...ENCOUNTER_SQUARES, ...ring(focus)]).size - 2);
    });

    it("clips the ring to the map bounds", () => {
        const wanted = computeWantedMapIds([], { mapX: 0, mapY: 0 }, new Set());

        expect(wanted).toEqual(
            ids([
                { mapX: 0, mapY: 0 },
                { mapX: 1, mapY: 0 },
                { mapX: 0, mapY: 1 },
                { mapX: 1, mapY: 1 },
            ]),
        );
    });
});

describe("diffResidency", () => {
    it("loads everything when nothing is resident", () => {
        const wanted = computeWantedMapIds(ENCOUNTER_SQUARES, { mapX: 37, mapY: 79 }, new Set());

        const diff = diffResidency(wanted, new Set());

        expect(new Set(diff.toLoad)).toEqual(wanted);
        expect(diff.toUnload).toEqual([]);
    });

    it("moving to a neighbouring square loads the new column and unloads the old one", () => {
        const before = computeWantedMapIds(ENCOUNTER_SQUARES, { mapX: 37, mapY: 79 }, new Set());
        const after = computeWantedMapIds(ENCOUNTER_SQUARES, { mapX: 38, mapY: 79 }, new Set());

        const diff = diffResidency(after, before);

        expect(new Set(diff.toLoad)).toEqual(
            ids([
                { mapX: 39, mapY: 78 },
                { mapX: 39, mapY: 79 },
                { mapX: 39, mapY: 80 },
            ]),
        );
        expect(new Set(diff.toUnload)).toEqual(
            ids([
                { mapX: 36, mapY: 79 },
                { mapX: 36, mapY: 80 },
            ]),
        );
    });

    it("never unloads an encounter square, even far from the focus", () => {
        const wanted = computeWantedMapIds(ENCOUNTER_SQUARES, { mapX: 60, mapY: 90 }, new Set());
        const resident = ids([
            ...ENCOUNTER_SQUARES,
            { mapX: 59, mapY: 90 },
            { mapX: 50, mapY: 50 },
        ]);

        const diff = diffResidency(wanted, resident);

        expect(new Set(diff.toUnload)).toEqual(ids([{ mapX: 50, mapY: 50 }]));
        for (const { mapX, mapY } of ENCOUNTER_SQUARES) {
            expect(diff.toLoad).not.toContain(getMapSquareId(mapX, mapY));
        }
    });
});
