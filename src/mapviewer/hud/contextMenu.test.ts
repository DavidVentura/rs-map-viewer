import { createInteractionId, createWorldObjectId } from "../game/Interaction";
import {
    MenuActionKind,
    MenuEntryKind,
    MenuStateKind,
    MenuTargetKind,
    buildMenuEntries,
    clickMenuAt,
    computeMenuLayout,
    hitTestMenu,
    isWithinMenuBounds,
    openMenuAt,
    tooltipTextRuns,
    updateMenuHover,
} from "./contextMenu";

const measureText = (text: string): number => text.length * 6;
const viewport = { width: 800, height: 600 };

const leverTarget = {
    kind: MenuTargetKind.WORLD_OBJECT as const,
    objectId: createWorldObjectId(1),
    interactionId: createInteractionId("start_phase_1"),
    verb: "Pull",
    name: "Lever",
};

const itemTarget = {
    kind: MenuTargetKind.GROUND_ITEM as const,
    groundItemId: 7,
    name: "Bronze platebody",
};

const enemyTarget = {
    kind: MenuTargetKind.ENEMY as const,
    enemyId: 3,
    name: "Tz-Kih",
    combatLevel: 22,
};

describe("buildMenuEntries", () => {
    it("returns one entry per target, in the given order, with Cancel appended last", () => {
        const entries = buildMenuEntries([enemyTarget, leverTarget, itemTarget]);

        expect(entries).toHaveLength(4);
        expect(entries[0]).toMatchObject({ kind: MenuEntryKind.TARGET, target: enemyTarget });
        expect(entries[1]).toMatchObject({ kind: MenuEntryKind.TARGET, target: leverTarget });
        expect(entries[2]).toMatchObject({ kind: MenuEntryKind.TARGET, target: itemTarget });
        expect(entries[3].kind).toBe(MenuEntryKind.CANCEL);
    });

    it("still appends Cancel when there are no targets", () => {
        const entries = buildMenuEntries([]);
        expect(entries).toHaveLength(1);
        expect(entries[0].kind).toBe(MenuEntryKind.CANCEL);
    });

    it("derives the dispatchable action from each target's kind", () => {
        const [enemyEntry, leverEntry, itemEntry] = buildMenuEntries([
            enemyTarget,
            leverTarget,
            itemTarget,
        ]);
        expect(enemyEntry.action).toEqual({ kind: MenuActionKind.ATTACK_ENEMY, enemyId: 3 });
        expect(leverEntry.action).toEqual({
            kind: MenuActionKind.START_INTERACTION,
            interactionId: leverTarget.interactionId,
        });
        expect(itemEntry.action).toEqual({
            kind: MenuActionKind.PICK_UP_GROUND_ITEM,
            groundItemId: 7,
        });
    });
});

describe("tooltipTextRuns", () => {
    it("is undefined for an empty target list (just Cancel)", () => {
        expect(tooltipTextRuns(buildMenuEntries([]))).toBeUndefined();
    });

    it("shows only the first entry's text with no suffix when it's the only option", () => {
        const runs = tooltipTextRuns(buildMenuEntries([leverTarget]));
        expect(runs?.map((run) => run.text).join("")).toBe("Pull Lever");
    });

    it("appends a singular '1 more option' suffix for exactly one extra target", () => {
        const runs = tooltipTextRuns(buildMenuEntries([leverTarget, itemTarget]));
        expect(runs?.map((run) => run.text).join("")).toBe("Pull Lever / 1 more option");
    });

    it("appends a plural 'N more options' suffix for multiple extra targets", () => {
        const runs = tooltipTextRuns(buildMenuEntries([enemyTarget, leverTarget, itemTarget]));
        expect(runs?.map((run) => run.text).join("")).toBe(
            "Attack Tz-Kih (level-22) / 2 more options",
        );
    });
});

describe("computeMenuLayout", () => {
    it("centres the box horizontally on the anchor with the title at the anchor's y", () => {
        const entries = buildMenuEntries([leverTarget]);
        const anchor = { x: 400, y: 300 };
        const layout = computeMenuLayout(entries, anchor, viewport, measureText);

        expect(layout.box.x + layout.box.width / 2).toBeCloseTo(anchor.x, 5);
        expect(layout.box.y).toBeCloseTo(anchor.y, 5);
    });

    it("produces one entry rect per entry, stacked below the title", () => {
        const entries = buildMenuEntries([leverTarget, itemTarget, enemyTarget]);
        const layout = computeMenuLayout(entries, { x: 400, y: 300 }, viewport, measureText);

        expect(layout.entryRects).toHaveLength(entries.length);
        for (let i = 0; i < entries.length; i++) {
            expect(layout.entryRects[i].y).toBeCloseTo(
                layout.box.y + layout.titleHeight + i * layout.entryRects[i].height,
                5,
            );
        }
        const lastRect = layout.entryRects[layout.entryRects.length - 1];
        expect(lastRect.y + lastRect.height).toBeCloseTo(layout.box.y + layout.box.height, 5);
    });

    it("clamps the box so it never spills past the left/top viewport edge", () => {
        const entries = buildMenuEntries([leverTarget]);
        const layout = computeMenuLayout(entries, { x: 2, y: 2 }, viewport, measureText);

        expect(layout.box.x).toBeGreaterThanOrEqual(0);
        expect(layout.box.y).toBeGreaterThanOrEqual(0);
    });

    it("clamps the box so it never spills past the right/bottom viewport edge", () => {
        const entries = buildMenuEntries([leverTarget, itemTarget, enemyTarget]);
        const layout = computeMenuLayout(
            entries,
            { x: viewport.width - 2, y: viewport.height - 2 },
            viewport,
            measureText,
        );

        expect(layout.box.x + layout.box.width).toBeLessThanOrEqual(viewport.width);
        expect(layout.box.y + layout.box.height).toBeLessThanOrEqual(viewport.height);
    });
});

describe("hitTestMenu", () => {
    const entries = buildMenuEntries([leverTarget, itemTarget, enemyTarget]);
    const layout = computeMenuLayout(entries, { x: 400, y: 300 }, viewport, measureText);

    it("resolves a point inside an entry rect to that entry's index", () => {
        for (let i = 0; i < layout.entryRects.length; i++) {
            const rect = layout.entryRects[i];
            expect(hitTestMenu(layout, rect.x + rect.width / 2, rect.y + rect.height / 2)).toBe(i);
        }
    });

    it("returns undefined for a point in the title area", () => {
        expect(hitTestMenu(layout, layout.box.x + 5, layout.box.y + 2)).toBeUndefined();
    });

    it("returns undefined for a point outside the box entirely", () => {
        expect(hitTestMenu(layout, layout.box.x - 50, layout.box.y - 50)).toBeUndefined();
    });
});

describe("isWithinMenuBounds", () => {
    const box = { x: 100, y: 100, width: 120, height: 80 };

    it("is true just inside the margin", () => {
        expect(isWithinMenuBounds(box, box.x - 9, box.y - 9)).toBe(true);
        expect(isWithinMenuBounds(box, box.x + box.width + 9, box.y + box.height + 9)).toBe(true);
    });

    it("is false once past the margin", () => {
        expect(isWithinMenuBounds(box, box.x - 11, box.y)).toBe(false);
        expect(isWithinMenuBounds(box, box.x, box.y + box.height + 11)).toBe(false);
    });
});

describe("menu state transitions", () => {
    it("openMenuAt opens with the built entries when there is at least one target", () => {
        const state = openMenuAt({ x: 10, y: 10 }, [leverTarget]);
        expect(state).toMatchObject({
            kind: MenuStateKind.OPEN,
            entries: buildMenuEntries([leverTarget]),
            anchor: { x: 10, y: 10 },
        });
    });

    it("openMenuAt with no targets stays closed - right-click over nothing opens no menu", () => {
        expect(openMenuAt({ x: 10, y: 10 }, [])).toEqual({ kind: MenuStateKind.CLOSED });
    });

    it("updateMenuHover resolves the hovered entry while inside the box", () => {
        const entries = buildMenuEntries([leverTarget, itemTarget]);
        const anchor = { x: 400, y: 300 };
        const state = openMenuAt(anchor, [leverTarget, itemTarget]);
        const layout = computeMenuLayout(entries, anchor, viewport, measureText);
        const targetRect = layout.entryRects[1];

        const hovered = updateMenuHover(state, layout, {
            x: targetRect.x + 1,
            y: targetRect.y + 1,
        });
        expect(hovered).toMatchObject({ kind: MenuStateKind.OPEN, hoveredIndex: 1 });
    });

    it("updateMenuHover closes the menu once the cursor leaves its bounds", () => {
        const entries = buildMenuEntries([leverTarget]);
        const anchor = { x: 400, y: 300 };
        const state = openMenuAt(anchor, [leverTarget]);
        const layout = computeMenuLayout(entries, anchor, viewport, measureText);

        const farAway = updateMenuHover(state, layout, { x: 0, y: 0 });
        expect(farAway).toEqual({ kind: MenuStateKind.CLOSED });
    });

    it("updateMenuHover is a no-op while already closed", () => {
        const entries = buildMenuEntries([leverTarget]);
        const layout = computeMenuLayout(entries, { x: 400, y: 300 }, viewport, measureText);
        expect(updateMenuHover({ kind: MenuStateKind.CLOSED }, layout, { x: 400, y: 300 })).toEqual(
            {
                kind: MenuStateKind.CLOSED,
            },
        );
    });

    it("clickMenuAt on a target entry yields its action and closes", () => {
        const entries = buildMenuEntries([leverTarget, itemTarget]);
        const anchor = { x: 400, y: 300 };
        const state = openMenuAt(anchor, [leverTarget, itemTarget]);
        const layout = computeMenuLayout(entries, anchor, viewport, measureText);
        const itemRect = layout.entryRects[1];

        const result = clickMenuAt(state, layout, itemRect.x + 1, itemRect.y + 1);
        expect(result.state).toEqual({ kind: MenuStateKind.CLOSED });
        expect(result.action).toEqual({
            kind: MenuActionKind.PICK_UP_GROUND_ITEM,
            groundItemId: 7,
        });
    });

    it("clickMenuAt on Cancel yields a CANCEL action and closes", () => {
        const entries = buildMenuEntries([leverTarget]);
        const anchor = { x: 400, y: 300 };
        const state = openMenuAt(anchor, [leverTarget]);
        const layout = computeMenuLayout(entries, anchor, viewport, measureText);
        const cancelRect = layout.entryRects[layout.entryRects.length - 1];

        const result = clickMenuAt(state, layout, cancelRect.x + 1, cancelRect.y + 1);
        expect(result.state).toEqual({ kind: MenuStateKind.CLOSED });
        expect(result.action).toEqual({ kind: MenuActionKind.CANCEL });
    });

    it("clickMenuAt outside every entry closes without an action", () => {
        const entries = buildMenuEntries([leverTarget]);
        const anchor = { x: 400, y: 300 };
        const state = openMenuAt(anchor, [leverTarget]);
        const layout = computeMenuLayout(entries, anchor, viewport, measureText);

        const result = clickMenuAt(state, layout, layout.box.x + 2, layout.box.y + 2);
        expect(result.state).toEqual({ kind: MenuStateKind.CLOSED });
        expect(result.action).toBeUndefined();
    });

    it("clickMenuAt is a no-op while already closed", () => {
        const entries = buildMenuEntries([leverTarget]);
        const layout = computeMenuLayout(entries, { x: 400, y: 300 }, viewport, measureText);
        const result = clickMenuAt({ kind: MenuStateKind.CLOSED }, layout, 400, 300);
        expect(result).toEqual({ state: { kind: MenuStateKind.CLOSED } });
    });
});
