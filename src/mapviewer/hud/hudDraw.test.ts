import { WeaponStyle } from "../game/Ability";
import { HudRegionKind, computeHudLayout, hitTestHud } from "./hudDraw";

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

    it("produces exactly one style icon per weapon style, centred on screen", () => {
        const width = 1280;
        for (const slotCount of [3, 4]) {
            const layout = computeHudLayout(width, 720, slotCount);
            expect(layout.styleIcons).toHaveLength(3);
            expect(layout.styleIcons.map((icon) => icon.style).sort()).toEqual(
                [WeaponStyle.MELEE, WeaponStyle.RANGED, WeaponStyle.MAGIC].sort(),
            );
            const first = layout.styleIcons[0];
            const last = layout.styleIcons[layout.styleIcons.length - 1];
            const rowCenter = (first.x + last.x + last.size) / 2;
            expect(rowCenter).toBeCloseTo(width / 2, 5);
        }
    });

    it("sits the style row above the ability bar regardless of slot count", () => {
        for (const slotCount of [3, 4]) {
            const layout = computeHudLayout(1280, 720, slotCount);
            const styleIconBottom = layout.styleIcons[0].y + layout.styleIcons[0].size;
            expect(styleIconBottom).toBeLessThanOrEqual(layout.slots[0].y);
        }
    });
});

describe("hitTestHud", () => {
    const layout = computeHudLayout(1280, 720, 4);

    it("reports a PANEL region for a hit inside the bottom panel", () => {
        const x = layout.panelX + layout.panelWidth / 2;
        const y = layout.panelY + layout.panelHeight / 2;
        expect(hitTestHud(layout, x, y)).toEqual({ kind: HudRegionKind.PANEL });
    });

    it("reports an ORB region for a hit inside an orb even where it pokes out above the panel", () => {
        const { x, y } = layout.healthGlobe;
        expect(hitTestHud(layout, x, y - layout.healthGlobe.radius + 1)).toEqual({
            kind: HudRegionKind.ORB,
        });
    });

    it("reports a SLOT region with the slot index for a hit inside an ability slot", () => {
        const slot = layout.slots[2];
        expect(hitTestHud(layout, slot.x + slot.size / 2, slot.y + slot.size / 2)).toEqual({
            kind: HudRegionKind.SLOT,
            slot: 2,
        });
    });

    it("reports a STYLE region with the style for a hit inside a style icon", () => {
        for (const icon of layout.styleIcons) {
            expect(hitTestHud(layout, icon.x + icon.size / 2, icon.y + icon.size / 2)).toEqual({
                kind: HudRegionKind.STYLE,
                style: icon.style,
            });
        }
    });

    it("reports no region for points away from the panel, orbs, slots and style icons", () => {
        expect(hitTestHud(layout, 10, 10)).toBeUndefined();
        expect(hitTestHud(layout, 640, 0)).toBeUndefined();
    });
});
