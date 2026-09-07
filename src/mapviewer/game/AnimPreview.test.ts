import {
    buildPreviewEnemyType,
    parseAnimPreviewParams,
    parseSeqRange,
    stepSeqId,
} from "./AnimPreview";
import { EnemyBehaviour, EnemyTypeId } from "./EnemyType";

describe("parseSeqRange", () => {
    it("parses a well-formed from-to range", () => {
        expect(parseSeqRange("2636-2641")).toEqual({ from: 2636, to: 2641 });
    });

    it("accepts a single-seq range where from equals to", () => {
        expect(parseSeqRange("2636-2636")).toEqual({ from: 2636, to: 2636 });
    });

    it("returns undefined for null", () => {
        expect(parseSeqRange(null)).toBeUndefined();
    });

    it("returns undefined for an empty string", () => {
        expect(parseSeqRange("")).toBeUndefined();
    });

    it("returns undefined when to is less than from", () => {
        expect(parseSeqRange("2641-2636")).toBeUndefined();
    });

    it("returns undefined for malformed input", () => {
        expect(parseSeqRange("abc")).toBeUndefined();
        expect(parseSeqRange("2636")).toBeUndefined();
        expect(parseSeqRange("2636-")).toBeUndefined();
        expect(parseSeqRange("-2636")).toBeUndefined();
        expect(parseSeqRange("2636-2641-2642")).toBeUndefined();
    });
});

describe("parseAnimPreviewParams", () => {
    it("parses a valid anim + seqs pair", () => {
        const params = parseAnimPreviewParams(new URLSearchParams("anim=3123&seqs=2636-2641"));
        expect(params).toEqual({ npcTypeId: 3123, seqRange: { from: 2636, to: 2641 } });
    });

    it("returns undefined when anim is missing", () => {
        expect(parseAnimPreviewParams(new URLSearchParams("seqs=2636-2641"))).toBeUndefined();
    });

    it("returns undefined when seqs is missing", () => {
        expect(parseAnimPreviewParams(new URLSearchParams("anim=3123"))).toBeUndefined();
    });

    it("returns undefined when anim is not a number", () => {
        expect(
            parseAnimPreviewParams(new URLSearchParams("anim=abc&seqs=2636-2641")),
        ).toBeUndefined();
    });

    it("returns undefined when seqs is malformed", () => {
        expect(parseAnimPreviewParams(new URLSearchParams("anim=3123&seqs=bad"))).toBeUndefined();
    });
});

describe("stepSeqId", () => {
    const range = { from: 2636, to: 2641 };

    it("steps forward within range", () => {
        expect(stepSeqId(2636, range, 1)).toBe(2637);
    });

    it("steps backward within range", () => {
        expect(stepSeqId(2637, range, -1)).toBe(2636);
    });

    it("wraps from the top of the range back to the bottom going forward", () => {
        expect(stepSeqId(2641, range, 1)).toBe(2636);
    });

    it("wraps from the bottom of the range back to the top going backward", () => {
        expect(stepSeqId(2636, range, -1)).toBe(2641);
    });

    it("stays put on a single-seq range", () => {
        const singleton = { from: 2636, to: 2636 };
        expect(stepSeqId(2636, singleton, 1)).toBe(2636);
        expect(stepSeqId(2636, singleton, -1)).toBe(2636);
    });
});

describe("buildPreviewEnemyType", () => {
    it("builds a rusher with no abilities, reusing the npc's idle seq for death/attack", () => {
        const type = buildPreviewEnemyType({
            npcTypeId: 3123,
            idleSeqId: 2636,
            walkSeqId: 2634,
            size: 3,
        });
        expect(type).toMatchObject({
            id: EnemyTypeId.PREVIEW,
            npcTypeId: 3123,
            idleSeqId: 2636,
            walkSeqId: 2634,
            deathSeqId: 2636,
            attackSeqId: 2636,
            behaviour: EnemyBehaviour.RUSHER,
            abilities: [],
        });
    });
});
