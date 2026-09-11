import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AbilityDefinition, AbilityEffectKind, resolveAbility, resolveCastTiming } from "./Ability";

const seqFrameLoader = {} as SeqFrameLoader;

// Seq 426 (the bow shot) as it is in the cache: the release frame 5 starts 31 ticks in.
const bowLoader = {
    load: () => ({
        frameIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        getFrameLength: (_loader: SeqFrameLoader, frame: number) =>
            [4, 4, 4, 4, 15, 10, 5, 4, 4, 4][frame],
    }),
} as unknown as SeqTypeLoader;

const BOW_LIKE: AbilityDefinition = {
    id: "bow_like",
    name: "Bow Like",
    castSeqId: 426,
    contactFrame: 5,
    castSpeed: 2,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [],
    locks: [],
    effect: { kind: AbilityEffectKind.MELEE, minDamage: 1, maxDamage: 1, reach: 0 },
};

describe("resolveCastTiming", () => {
    it("lands impact when the contact frame starts and the animation at the sequence end, both at castSpeed", () => {
        const timing = resolveCastTiming(BOW_LIKE, bowLoader, seqFrameLoader);
        expect(timing.impactSeconds).toBeCloseTo(0.62 / 2);
        expect(timing.animationSeconds).toBeCloseTo(1.16 / 2);
    });

    it("plays at natural speed when castSpeed is 1", () => {
        const timing = resolveCastTiming({ ...BOW_LIKE, castSpeed: 1 }, bowLoader, seqFrameLoader);
        expect(timing.impactSeconds).toBeCloseTo(0.62);
        expect(timing.animationSeconds).toBeCloseTo(1.16);
    });

    it("refuses a contact frame the sequence does not have", () => {
        expect(() =>
            resolveCastTiming({ ...BOW_LIKE, contactFrame: 10 }, bowLoader, seqFrameLoader),
        ).toThrow();
    });
});

describe("resolveAbility", () => {
    it("keeps the definition's fields and attaches the resolved timing", () => {
        const resolved = resolveAbility(BOW_LIKE, bowLoader, seqFrameLoader);
        expect(resolved).toMatchObject(BOW_LIKE);
        expect(resolved.timing.impactSeconds).toBeCloseTo(0.31);
    });
});
