import {
    canonicalMapSpawns,
    mapSpawnsJson,
    parseMapSpawns,
    parseNpcSpawnList,
    parseObjSpawnList,
} from "./MapSpawns";

describe("MapSpawns", () => {
    it("puts the spawns of any list in one order", () => {
        const a = { id: 1, name: "Man", x: 3200, y: 3200, level: 0 };
        const b = { id: 1, name: "Man", x: 3200, y: 3201, level: 0 };
        const c = { id: 2, name: "Woman", x: 3199, y: 3300, level: 1 };
        expect(canonicalMapSpawns([b, c, a], []).npcSpawns).toEqual([c, a, b]);
        expect(canonicalMapSpawns([a, b, c], []).npcSpawns).toEqual([c, a, b]);
    });

    it.each([
        ["a missing name", [{ id: 1, x: 3200, y: 3200, level: 0 }], /name undefined/],
        [
            "an extra field",
            [{ id: 1, name: "Man", x: 3200, y: 3200, level: 0, plane: 0 }],
            /Unexpected npc spawn field plane/,
        ],
        [
            "a level above the top plane",
            [{ id: 1, name: "Man", x: 3200, y: 3200, level: 4 }],
            /Invalid npc spawn level 4/,
        ],
        [
            "a fractional coordinate",
            [{ id: 1, name: "Man", x: 3200.5, y: 3200, level: 0 }],
            /Invalid npc spawn x 3200.5/,
        ],
    ])("refuses an npc spawn with %s", (_, json, reason) => {
        const parsed = parseNpcSpawnList("npcs", json);
        expect(parsed.kind === "INVALID" && parsed.reason).toMatch(reason);
    });

    it("refuses an obj spawn with a negative count, naming the record", () => {
        const parsed = parseObjSpawnList("objs", [
            { id: 995, count: 1, x: 3200, y: 3200, plane: 0 },
            { id: 995, count: -1, x: 3200, y: 3200, plane: 0 },
        ]);
        expect(parsed.kind === "INVALID" && parsed.reason).toBe(
            "objs[1]: Invalid obj spawn count -1",
        );
    });

    it("round-trips through the JSON a pack carries it in", () => {
        const spawns = canonicalMapSpawns(
            [{ id: 1, name: "Man", x: 3200, y: 3200, level: 0 }],
            [{ id: 995, count: 0, x: 3201, y: 3202, plane: 3 }],
        );
        expect(parseMapSpawns(JSON.parse(mapSpawnsJson(spawns)))).toEqual({
            kind: "PARSED",
            value: spawns,
        });
    });
});
