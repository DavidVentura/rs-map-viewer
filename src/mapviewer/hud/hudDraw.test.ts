import { computeHudLayout, hitTestHud } from "./hudDraw";

describe("computeHudLayout", () => {
    it("produces one slot per requested slot count", () => {
        expect(computeHudLayout(1280, 720, 4).slots).toHaveLength(4);
        expect(computeHudLayout(1280, 720, 5).slots).toHaveLength(5);
        expect(computeHudLayout(1280, 720, 0).slots).toHaveLength(0);
    });

    it("keeps the ability bar centred on screen regardless of slot count", () => {
        const width = 1280;
        for (const slotCount of [1, 3, 4, 5, 8]) {
            const layout = computeHudLayout(width, 720, slotCount);
            const firstSlot = layout.slots[0];
            const lastSlot = layout.slots[layout.slots.length - 1];
            const barCenter = (firstSlot.x + lastSlot.x + lastSlot.size) / 2;
            expect(barCenter).toBeCloseTo(width / 2, 5);
        }
    });

    it("centres the panel, and the orbs, on the screen", () => {
        const layout = computeHudLayout(1280, 720, 4);
        expect(layout.panelX + layout.panelWidth / 2).toBeCloseTo(640, 5);
        const orbsCenter = (layout.healthGlobe.x + layout.manaGlobe.x) / 2;
        expect(orbsCenter).toBeCloseTo(640, 5);
    });
});

describe("hitTestHud", () => {
    const layout = computeHudLayout(1280, 720, 4);

    it("reports a hit inside the bottom panel", () => {
        const x = layout.panelX + layout.panelWidth / 2;
        const y = layout.panelY + layout.panelHeight / 2;
        expect(hitTestHud(layout, x, y)).toBe(true);
    });

    it("reports a hit inside an orb even where it pokes out above the panel", () => {
        const { x, y } = layout.healthGlobe;
        expect(hitTestHud(layout, x, y - layout.healthGlobe.radius + 1)).toBe(true);
    });

    it("reports a hit inside an ability slot", () => {
        const slot = layout.slots[0];
        expect(hitTestHud(layout, slot.x + slot.size / 2, slot.y + slot.size / 2)).toBe(true);
    });

    it("reports no hit for points away from the panel, orbs and slots", () => {
        expect(hitTestHud(layout, 10, 10)).toBe(false);
        expect(hitTestHud(layout, 640, 0)).toBe(false);
    });
});
