import { clamp } from "../../util/MathUtil";
import { InteractionId, WorldObjectId } from "../game/Interaction";

// ---------------------------------------------------------------------------
// Targets: everything that can sit under the cursor, with the display data the
// renderer has already resolved from the cache (no cache lookups happen here).
// ---------------------------------------------------------------------------

export enum MenuTargetKind {
    WORLD_OBJECT = "WORLD_OBJECT",
    GROUND_ITEM = "GROUND_ITEM",
    ENEMY = "ENEMY",
    ENERGY_SIPHON = "ENERGY_SIPHON",
}

// A lever/chest with an active interaction. verb/name come from the loc's own LocType (see
// assets/ActorAssets.WORLD_OBJECT_BAKES) - "Pull"/"Lever", "Open"/"Chest".
export type WorldObjectMenuTarget = {
    readonly kind: MenuTargetKind.WORLD_OBJECT;
    readonly objectId: WorldObjectId;
    readonly interactionId: InteractionId;
    readonly verb: string;
    readonly name: string;
};

export type GroundItemMenuTarget = {
    readonly kind: MenuTargetKind.GROUND_ITEM;
    readonly groundItemId: number;
    readonly name: string;
};

export type EnemyMenuTarget = {
    readonly kind: MenuTargetKind.ENEMY;
    readonly enemyId: number;
    readonly name: string;
    readonly combatLevel: number;
};

// A hostile energy siphon under the cursor - a non-combat encounter actor (see EncounterActor.ts),
// not an enemy, so it carries no combat level.
export type EnergySiphonMenuTarget = {
    readonly kind: MenuTargetKind.ENERGY_SIPHON;
    readonly siphonId: number;
    readonly name: string;
};

export type MenuTarget =
    | WorldObjectMenuTarget
    | GroundItemMenuTarget
    | EnemyMenuTarget
    | EnergySiphonMenuTarget;

export const TAKE_VERB = "Take";
export const ATTACK_VERB = "Attack";

// ---------------------------------------------------------------------------
// Actions: what selecting an entry dispatches, through the same input builders
// a left-click already uses.
// ---------------------------------------------------------------------------

export enum MenuActionKind {
    START_INTERACTION = "START_INTERACTION",
    PICK_UP_GROUND_ITEM = "PICK_UP_GROUND_ITEM",
    ATTACK_ENEMY = "ATTACK_ENEMY",
    ATTACK_ENERGY_SIPHON = "ATTACK_ENERGY_SIPHON",
    CANCEL = "CANCEL",
}

export type MenuAction =
    | { readonly kind: MenuActionKind.START_INTERACTION; readonly interactionId: InteractionId }
    | { readonly kind: MenuActionKind.PICK_UP_GROUND_ITEM; readonly groundItemId: number }
    | { readonly kind: MenuActionKind.ATTACK_ENEMY; readonly enemyId: number }
    | { readonly kind: MenuActionKind.ATTACK_ENERGY_SIPHON; readonly siphonId: number }
    | { readonly kind: MenuActionKind.CANCEL };

export type TargetMenuAction = Exclude<MenuAction, { readonly kind: MenuActionKind.CANCEL }>;

// Also what a left click on the target does: OSRS runs the top menu entry on a left click.
export function actionForTarget(target: MenuTarget): TargetMenuAction {
    switch (target.kind) {
        case MenuTargetKind.WORLD_OBJECT:
            return {
                kind: MenuActionKind.START_INTERACTION,
                interactionId: target.interactionId,
            };
        case MenuTargetKind.GROUND_ITEM:
            return { kind: MenuActionKind.PICK_UP_GROUND_ITEM, groundItemId: target.groundItemId };
        case MenuTargetKind.ENEMY:
            return { kind: MenuActionKind.ATTACK_ENEMY, enemyId: target.enemyId };
        case MenuTargetKind.ENERGY_SIPHON:
            return { kind: MenuActionKind.ATTACK_ENERGY_SIPHON, siphonId: target.siphonId };
    }
}

// ---------------------------------------------------------------------------
// Entries: one per target plus a trailing Cancel, in menu-display order.
// ---------------------------------------------------------------------------

export enum MenuEntryKind {
    TARGET = "TARGET",
    CANCEL = "CANCEL",
}

export type TargetMenuEntry = {
    readonly kind: MenuEntryKind.TARGET;
    readonly target: MenuTarget;
    readonly action: TargetMenuAction;
};

export type CancelMenuEntry = {
    readonly kind: MenuEntryKind.CANCEL;
    readonly action: { readonly kind: MenuActionKind.CANCEL };
};

export type MenuEntry = TargetMenuEntry | CancelMenuEntry;

export const CANCEL_MENU_ENTRY: CancelMenuEntry = {
    kind: MenuEntryKind.CANCEL,
    action: { kind: MenuActionKind.CANCEL },
};

// One entry per target, in the given (nearest/topmost first) order, then Cancel last. Whether to
// open a menu at all for an empty target list is the state layer's call (see openMenuAt) - this
// stays a straight one-to-one mapping.
export function buildMenuEntries(targets: readonly MenuTarget[]): readonly MenuEntry[] {
    const targetEntries: readonly TargetMenuEntry[] = targets.map((target) => ({
        kind: MenuEntryKind.TARGET,
        target,
        action: actionForTarget(target),
    }));
    return [...targetEntries, CANCEL_MENU_ENTRY];
}

function isTargetEntry(entry: MenuEntry): entry is TargetMenuEntry {
    return entry.kind === MenuEntryKind.TARGET;
}

// ---------------------------------------------------------------------------
// Display text: colour-free content, broken into runs so the renderer can pick
// a colour per run (object/npc/item/level colours, verb turning yellow on hover).
// ---------------------------------------------------------------------------

export type MenuTextRunRole =
    | "verb"
    | "objectName"
    | "npcName"
    | "npcLevel"
    | "itemName"
    | "cancel"
    | "suffix";

export type MenuTextRun = {
    readonly text: string;
    readonly role: MenuTextRunRole;
};

export function menuEntryTextRuns(entry: MenuEntry): readonly MenuTextRun[] {
    if (entry.kind === MenuEntryKind.CANCEL) {
        return [{ text: "Cancel", role: "cancel" }];
    }
    const target = entry.target;
    switch (target.kind) {
        case MenuTargetKind.WORLD_OBJECT:
            return [
                { text: `${target.verb} `, role: "verb" },
                { text: target.name, role: "objectName" },
            ];
        case MenuTargetKind.GROUND_ITEM:
            return [
                { text: `${TAKE_VERB} `, role: "verb" },
                { text: target.name, role: "itemName" },
            ];
        case MenuTargetKind.ENEMY:
            return [
                { text: `${ATTACK_VERB} `, role: "verb" },
                { text: target.name, role: "npcName" },
                { text: ` (level-${target.combatLevel})`, role: "npcLevel" },
            ];
        case MenuTargetKind.ENERGY_SIPHON:
            return [
                { text: `${ATTACK_VERB} `, role: "verb" },
                { text: target.name, role: "npcName" },
            ];
    }
}

export function menuEntryLineText(entry: MenuEntry): string {
    return menuEntryTextRuns(entry)
        .map((run) => run.text)
        .join("");
}

// The default (nearest) option shown near the cursor while the menu is closed, OSRS-style: "Pull
// Lever / 2 more options" when other non-Cancel options are available underneath. undefined when
// there is nothing under the cursor at all.
export function tooltipTextRuns(entries: readonly MenuEntry[]): readonly MenuTextRun[] | undefined {
    const targetEntries = entries.filter(isTargetEntry);
    if (targetEntries.length === 0) {
        return undefined;
    }
    const runs = [...menuEntryTextRuns(targetEntries[0])];
    const othersCount = targetEntries.length - 1;
    if (othersCount > 0) {
        runs.push({
            text: ` / ${othersCount} more option${othersCount === 1 ? "" : "s"}`,
            role: "suffix",
        });
    }
    return runs;
}

// ---------------------------------------------------------------------------
// Layout: pure geometry from entries + anchor + viewport + a text measurer the
// caller supplies (the renderer for hit-testing, the HUD canvas for drawing).
// ---------------------------------------------------------------------------

export type Point = { readonly x: number; readonly y: number };
export type Size = { readonly width: number; readonly height: number };
export type MenuRect = {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
};
export type TextMeasurer = (text: string) => number;

export const MENU_TITLE_TEXT = "Choose Option";
const HORIZONTAL_PADDING_PX = 8;
export const MENU_ENTRY_HEIGHT_PX = 18;
export const MENU_TITLE_HEIGHT_PX = 18;
const TOOLTIP_ANCHOR_OFFSET_Y_PX = 20;

function clampBoxToViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    viewport: Size,
): Point {
    return {
        x: clamp(x, 0, Math.max(0, viewport.width - width)),
        y: clamp(y, 0, Math.max(0, viewport.height - height)),
    };
}

export type MenuLayout = {
    readonly box: MenuRect;
    readonly titleHeight: number;
    // Parallel to the entries array the layout was computed from.
    readonly entryRects: readonly MenuRect[];
};

// Centred horizontally on the cursor with the title at the cursor, clamped inside the viewport -
// the same placement the deleted React OsrsMenu component used (see git history, a3acd2f^).
export function computeMenuLayout(
    entries: readonly MenuEntry[],
    anchor: Point,
    viewport: Size,
    measureText: TextMeasurer,
): MenuLayout {
    const lineWidths = entries.map((entry) => measureText(menuEntryLineText(entry)));
    const width = Math.max(measureText(MENU_TITLE_TEXT), ...lineWidths) + HORIZONTAL_PADDING_PX;
    const height = MENU_TITLE_HEIGHT_PX + entries.length * MENU_ENTRY_HEIGHT_PX;

    const { x, y } = clampBoxToViewport(anchor.x - width / 2, anchor.y, width, height, viewport);

    const entryRects = entries.map((_, index) => ({
        x,
        y: y + MENU_TITLE_HEIGHT_PX + index * MENU_ENTRY_HEIGHT_PX,
        width,
        height: MENU_ENTRY_HEIGHT_PX,
    }));

    return { box: { x, y, width, height }, titleHeight: MENU_TITLE_HEIGHT_PX, entryRects };
}

export type TooltipLayout = {
    readonly box: MenuRect;
    readonly runs: readonly MenuTextRun[];
};

// Below-and-right of the cursor rather than centred on it, like the old tooltip mode; also
// clamped inside the viewport.
export function computeTooltipLayout(
    entries: readonly MenuEntry[],
    anchor: Point,
    viewport: Size,
    measureText: TextMeasurer,
): TooltipLayout | undefined {
    const runs = tooltipTextRuns(entries);
    if (!runs) {
        return undefined;
    }
    const text = runs.map((run) => run.text).join("");
    const width = measureText(text) + HORIZONTAL_PADDING_PX;
    const { x, y } = clampBoxToViewport(
        anchor.x,
        anchor.y + TOOLTIP_ANCHOR_OFFSET_Y_PX,
        width,
        MENU_ENTRY_HEIGHT_PX,
        viewport,
    );
    return { box: { x, y, width, height: MENU_ENTRY_HEIGHT_PX }, runs };
}

function isInsideMenuRect(rect: MenuRect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function hitTestMenu(layout: MenuLayout, x: number, y: number): number | undefined {
    const index = layout.entryRects.findIndex((rect) => isInsideMenuRect(rect, x, y));
    return index === -1 ? undefined : index;
}

export const MENU_CLOSE_MARGIN_PX = 10;

// OSRS closes the menu once the cursor strays this far outside its box.
export function isWithinMenuBounds(
    box: MenuRect,
    x: number,
    y: number,
    marginPx: number = MENU_CLOSE_MARGIN_PX,
): boolean {
    return (
        x >= box.x - marginPx &&
        x <= box.x + box.width + marginPx &&
        y >= box.y - marginPx &&
        y <= box.y + box.height + marginPx
    );
}

// ---------------------------------------------------------------------------
// State: pure transitions the renderer drives with real input events.
// ---------------------------------------------------------------------------

export enum MenuStateKind {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
}

export type ClosedMenuState = { readonly kind: MenuStateKind.CLOSED };

export type OpenMenuState = {
    readonly kind: MenuStateKind.OPEN;
    readonly anchor: Point;
    readonly entries: readonly MenuEntry[];
    readonly hoveredIndex?: number;
};

export type MenuState = ClosedMenuState | OpenMenuState;

export const CLOSED_MENU_STATE: ClosedMenuState = { kind: MenuStateKind.CLOSED };

// Right-click over nothing opens no menu.
export function openMenuAt(anchor: Point, targets: readonly MenuTarget[]): MenuState {
    if (targets.length === 0) {
        return CLOSED_MENU_STATE;
    }
    return { kind: MenuStateKind.OPEN, anchor, entries: buildMenuEntries(targets) };
}

// Also closes the menu once the cursor strays MENU_CLOSE_MARGIN_PX outside its box (OSRS
// behaviour).
export function updateMenuHover(state: MenuState, layout: MenuLayout, cursor: Point): MenuState {
    if (state.kind === MenuStateKind.CLOSED) {
        return state;
    }
    if (!isWithinMenuBounds(layout.box, cursor.x, cursor.y)) {
        return CLOSED_MENU_STATE;
    }
    return { ...state, hoveredIndex: hitTestMenu(layout, cursor.x, cursor.y) };
}

export type MenuClickResult = { readonly state: MenuState; readonly action?: MenuAction };

// Clicking an entry yields its action and closes the menu (Cancel's action is MenuActionKind.
// CANCEL, which the caller just ignores); clicking outside every entry also closes, without an
// action.
export function clickMenuAt(
    state: MenuState,
    layout: MenuLayout,
    x: number,
    y: number,
): MenuClickResult {
    if (state.kind === MenuStateKind.CLOSED) {
        return { state };
    }
    const index = hitTestMenu(layout, x, y);
    if (index === undefined) {
        return { state: CLOSED_MENU_STATE };
    }
    return { state: CLOSED_MENU_STATE, action: state.entries[index].action };
}
