import { createInteractionId } from "../game/Interaction";
import { pickInteractionNear } from "./interactionPicking";

describe("pickInteractionNear", () => {
    const first = createInteractionId("first");
    const second = createInteractionId("second");
    const candidates = [
        { interactionId: first, x: 100, y: 100 },
        { interactionId: second, x: 120, y: 100 },
    ];

    it("selects the nearest candidate inside the pick radius", () => {
        expect(pickInteractionNear({ x: 114, y: 100 }, candidates, 20)).toBe(second);
    });

    it("preserves authored candidate order when distances tie", () => {
        expect(pickInteractionNear({ x: 110, y: 100 }, candidates, 20)).toBe(first);
    });

    it("does not select a candidate outside the pick radius", () => {
        expect(pickInteractionNear({ x: 80, y: 100 }, candidates, 10)).toBeUndefined();
    });
});
