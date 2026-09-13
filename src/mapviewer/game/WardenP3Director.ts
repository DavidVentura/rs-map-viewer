import { WardenSlamTarget } from "./WardenP3SlamTarget";

export { WardenSlamTarget } from "./WardenP3SlamTarget";

export enum WardenP3Phase {
    NORMAL = "normal",
    SIPHONS = "siphons",
    ENRAGE = "enrage",
    COMPLETE = "complete",
}

export enum WardenP3Intermission {
    FIRST = 0,
    SECOND = 1,
    THIRD = 2,
    FOURTH = 3,
}

export enum WardenPhantom {
    ZEBAK = "zebak",
    BABA = "baba",
}

export enum WardenSiphonStatus {
    NONE = "none",
    ALL_REVERSED = "all_reversed",
    DEADLINE_EXPIRED = "deadline_expired",
}

export type WardenP3Health = {
    readonly current: number;
    readonly maximum: number;
};

export type WardenP3Tile = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type WardenP3Snapshot = {
    readonly timeSeconds: number;
    readonly wardenHealth: WardenP3Health;
    readonly playerTile: WardenP3Tile;
    readonly siphonStatus: WardenSiphonStatus;
};

export type WardenP3Timing = {
    readonly slamAimToImpactSeconds: number;
    readonly slamPostImpactRecoverySeconds: number;
    readonly phantomAttackIntervalSeconds: number;
    readonly lightningWarningSeconds: number;
    readonly lightningWarningIntervalSeconds: number;
    readonly rowRemovalIntervalSeconds: number;
};

export type WardenP3Arena = {
    readonly furthestRowFromWarden: number;
};

declare const parsedArenaBrand: unique symbol;
export type ParsedWardenP3Arena = WardenP3Arena & { readonly [parsedArenaBrand]: true };

declare const parsedTimingBrand: unique symbol;
export type ParsedWardenP3Timing = WardenP3Timing & { readonly [parsedTimingBrand]: true };

type ReadySlam = {
    readonly kind: "ready";
    readonly target: WardenSlamTarget;
    readonly beginsAtSeconds: number;
};

type AimingSlam = {
    readonly kind: "aiming";
    readonly target: WardenSlamTarget;
    readonly resolvesAtSeconds: number;
};

type WardenSlamState = ReadySlam | AimingSlam;

type ActivePhantom = {
    readonly phantom: WardenPhantom;
    readonly nextAttackAtSeconds: number;
};

type PendingLightning = {
    readonly target: WardenP3Tile;
    readonly strikesAtSeconds: number;
};

type WardenP3CommonState = {
    readonly nextIntermission: WardenP3Intermission | undefined;
    readonly phantoms: readonly ActivePhantom[];
};

export type WardenP3NormalState = WardenP3CommonState & {
    readonly phase: WardenP3Phase.NORMAL;
    readonly slam: WardenSlamState;
};

export type WardenP3SiphonState = WardenP3CommonState & {
    readonly phase: WardenP3Phase.SIPHONS;
    readonly intermission: WardenP3Intermission;
    readonly suspendedSlamTarget: WardenSlamTarget;
};

export type WardenP3EnrageState = {
    readonly phase: WardenP3Phase.ENRAGE;
    readonly phantoms: readonly ActivePhantom[];
    readonly pendingLightning: PendingLightning | undefined;
    readonly nextLightningWarningAtSeconds: number;
    readonly nextRowRemovalAtSeconds: number;
    readonly nextRowToRemove: number;
};

export type WardenP3CompleteState = {
    readonly phase: WardenP3Phase.COMPLETE;
};

export type WardenP3State =
    | WardenP3NormalState
    | WardenP3SiphonState
    | WardenP3EnrageState
    | WardenP3CompleteState;

export type RotateWardenCommand = {
    readonly kind: "ROTATE_WARDEN";
    readonly target: WardenSlamTarget;
};

export type ResolveFloorSlamCommand = {
    readonly kind: "RESOLVE_FLOOR_SLAM";
    readonly target: WardenSlamTarget;
};

export type SetWardenVulnerabilityCommand = {
    readonly kind: "SET_WARDEN_VULNERABILITY";
    readonly vulnerable: boolean;
};

export type SpawnEnergySiphonsCommand = {
    readonly kind: "SPAWN_ENERGY_SIPHONS";
    readonly intermission: WardenP3Intermission;
};

export type ResolveEnergySiphonsCommand = {
    readonly kind: "RESOLVE_ENERGY_SIPHONS";
    readonly intermission: WardenP3Intermission;
    readonly status: Exclude<WardenSiphonStatus, WardenSiphonStatus.NONE>;
    readonly wardenDamage: number;
};

export type ActivatePhantomCommand = {
    readonly kind: "ACTIVATE_PHANTOM";
    readonly phantom: WardenPhantom;
};

export type PhantomAttackCommand = {
    readonly kind: "PHANTOM_ATTACK";
    readonly phantom: WardenPhantom;
};

export type EnterEnrageCommand = {
    readonly kind: "ENTER_ENRAGE";
    readonly healAmount: number;
};

export type StrikeLightningCommand = {
    readonly kind: "STRIKE_LIGHTNING";
    readonly target: WardenP3Tile;
};

export type WarnLightningCommand = {
    readonly kind: "WARN_LIGHTNING";
    readonly target: WardenP3Tile;
};

export type RemoveArenaRowCommand = {
    readonly kind: "REMOVE_ARENA_ROW";
    readonly distanceFromWarden: number;
};

export type CompleteEncounterCommand = {
    readonly kind: "COMPLETE_ENCOUNTER";
};

export type WardenP3Command =
    | RotateWardenCommand
    | ResolveFloorSlamCommand
    | SetWardenVulnerabilityCommand
    | SpawnEnergySiphonsCommand
    | ResolveEnergySiphonsCommand
    | ActivatePhantomCommand
    | PhantomAttackCommand
    | EnterEnrageCommand
    | WarnLightningCommand
    | StrikeLightningCommand
    | RemoveArenaRowCommand
    | CompleteEncounterCommand;

export type WardenP3Result = {
    readonly nextState: WardenP3State;
    readonly commands: readonly WardenP3Command[];
};

const INTERMISSION_HEALTH_FRACTIONS: readonly number[] = [0.8, 0.6, 0.4, 0.2];
const ENRAGE_HEALTH_FRACTION = 0.05;
const ENRAGE_HEAL_FRACTION = 0.2;

// Slams start about 1.9 s apart (start to start) in the real fight; the aim share keeps the
// Warden's rotation telegraph readable.
export const DEFAULT_WARDEN_P3_TIMING: WardenP3Timing = {
    slamAimToImpactSeconds: 0.9,
    slamPostImpactRecoverySeconds: 1.0,
    phantomAttackIntervalSeconds: 2.4,
    lightningWarningSeconds: 0.6,
    lightningWarningIntervalSeconds: 1.2,
    rowRemovalIntervalSeconds: 2.4,
};

const DEFAULT_PARSED_WARDEN_P3_TIMING: ParsedWardenP3Timing =
    parseWardenP3Timing(DEFAULT_WARDEN_P3_TIMING);

function assertFiniteNonNegative(value: number, description: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${description} must be a finite non-negative number`);
    }
}

export function parseWardenP3Timing(timing: WardenP3Timing): ParsedWardenP3Timing {
    const entries = Object.entries(timing) as readonly [string, number][];
    for (const [name, seconds] of entries) {
        if (!Number.isFinite(seconds) || seconds <= 0) {
            throw new RangeError(`${name} must be a finite positive number`);
        }
    }
    if (timing.lightningWarningIntervalSeconds < timing.lightningWarningSeconds) {
        throw new RangeError("lightningWarningIntervalSeconds cannot overlap lightning warnings");
    }
    return timing as ParsedWardenP3Timing;
}

export function parseWardenP3Arena(arena: WardenP3Arena): ParsedWardenP3Arena {
    if (!Number.isInteger(arena.furthestRowFromWarden) || arena.furthestRowFromWarden < 2) {
        throw new RangeError("The arena must have a removable row beyond the Warden-adjacent row");
    }
    return arena as ParsedWardenP3Arena;
}

function validateSnapshot(snapshot: WardenP3Snapshot): void {
    assertFiniteNonNegative(snapshot.timeSeconds, "timeSeconds");
    assertFiniteNonNegative(snapshot.wardenHealth.current, "Warden current health");
    if (
        !Number.isFinite(snapshot.wardenHealth.maximum) ||
        snapshot.wardenHealth.maximum <= 0 ||
        snapshot.wardenHealth.current > snapshot.wardenHealth.maximum
    ) {
        throw new RangeError("Warden health must be within a positive maximum");
    }
    for (const [name, coordinate] of Object.entries(snapshot.playerTile)) {
        if (!Number.isFinite(coordinate)) {
            throw new RangeError(`Player tile ${name} must be finite`);
        }
    }
}

function nextSlamTarget(target: WardenSlamTarget): WardenSlamTarget {
    switch (target) {
        case WardenSlamTarget.RIGHT:
            return WardenSlamTarget.LEFT;
        case WardenSlamTarget.LEFT:
            return WardenSlamTarget.CENTRE;
        case WardenSlamTarget.CENTRE:
            return WardenSlamTarget.RIGHT;
    }
}

function activeSlamTarget(slam: WardenSlamState): WardenSlamTarget {
    return slam.target;
}

function nextIntermission(intermission: WardenP3Intermission): WardenP3Intermission | undefined {
    switch (intermission) {
        case WardenP3Intermission.FIRST:
            return WardenP3Intermission.SECOND;
        case WardenP3Intermission.SECOND:
            return WardenP3Intermission.THIRD;
        case WardenP3Intermission.THIRD:
            return WardenP3Intermission.FOURTH;
        case WardenP3Intermission.FOURTH:
            return undefined;
    }
}

function phantomForIntermission(intermission: WardenP3Intermission): WardenPhantom | undefined {
    switch (intermission) {
        case WardenP3Intermission.SECOND:
            return WardenPhantom.ZEBAK;
        case WardenP3Intermission.THIRD:
            return WardenPhantom.BABA;
        case WardenP3Intermission.FIRST:
        case WardenP3Intermission.FOURTH:
            return undefined;
    }
}

function healthFraction(health: WardenP3Health): number {
    return health.current / health.maximum;
}

function intermissionIsDue(intermission: WardenP3Intermission, health: WardenP3Health): boolean {
    return healthFraction(health) <= INTERMISSION_HEALTH_FRACTIONS[intermission];
}

function stepPhantoms(
    phantoms: readonly ActivePhantom[],
    timeSeconds: number,
    timing: WardenP3Timing,
): {
    readonly phantoms: readonly ActivePhantom[];
    readonly commands: readonly PhantomAttackCommand[];
} {
    const commands: PhantomAttackCommand[] = [];
    const nextPhantoms = phantoms.map((phantom) => {
        if (timeSeconds < phantom.nextAttackAtSeconds) {
            return phantom;
        }
        commands.push({ kind: "PHANTOM_ATTACK", phantom: phantom.phantom });
        return {
            phantom: phantom.phantom,
            nextAttackAtSeconds: timeSeconds + timing.phantomAttackIntervalSeconds,
        };
    });
    return { phantoms: nextPhantoms, commands };
}

function activateIntermissionPhantom(
    intermission: WardenP3Intermission,
    phantoms: readonly ActivePhantom[],
    timeSeconds: number,
    timing: WardenP3Timing,
): {
    readonly phantoms: readonly ActivePhantom[];
    readonly command: ActivatePhantomCommand | undefined;
} {
    const phantom = phantomForIntermission(intermission);
    if (phantom === undefined) {
        return { phantoms, command: undefined };
    }
    return {
        phantoms: [
            ...phantoms,
            { phantom, nextAttackAtSeconds: timeSeconds + timing.phantomAttackIntervalSeconds },
        ],
        command: { kind: "ACTIVATE_PHANTOM", phantom },
    };
}

function completeEncounter(): WardenP3Result {
    return {
        nextState: { phase: WardenP3Phase.COMPLETE },
        commands: [{ kind: "COMPLETE_ENCOUNTER" }],
    };
}

function enterEnrage(
    normal: WardenP3NormalState,
    snapshot: WardenP3Snapshot,
    arena: WardenP3Arena,
    timing: WardenP3Timing,
): WardenP3Result {
    return {
        nextState: {
            phase: WardenP3Phase.ENRAGE,
            phantoms: normal.phantoms,
            pendingLightning: undefined,
            nextLightningWarningAtSeconds:
                snapshot.timeSeconds + timing.lightningWarningIntervalSeconds,
            nextRowRemovalAtSeconds: snapshot.timeSeconds + timing.rowRemovalIntervalSeconds,
            nextRowToRemove: arena.furthestRowFromWarden,
        },
        commands: [
            {
                kind: "ENTER_ENRAGE",
                healAmount: snapshot.wardenHealth.maximum * ENRAGE_HEAL_FRACTION,
            },
        ],
    };
}

function beginIntermission(
    normal: WardenP3NormalState,
    snapshot: WardenP3Snapshot,
    timing: WardenP3Timing,
): WardenP3Result {
    const intermission = normal.nextIntermission;
    if (intermission === undefined) {
        throw new Error("Cannot begin an absent Warden intermission");
    }
    const activation = activateIntermissionPhantom(
        intermission,
        normal.phantoms,
        snapshot.timeSeconds,
        timing,
    );
    const commands: WardenP3Command[] = [{ kind: "SET_WARDEN_VULNERABILITY", vulnerable: false }];
    if (activation.command !== undefined) {
        commands.push(activation.command);
    }
    commands.push({ kind: "SPAWN_ENERGY_SIPHONS", intermission });
    return {
        nextState: {
            phase: WardenP3Phase.SIPHONS,
            intermission,
            nextIntermission: nextIntermission(intermission),
            suspendedSlamTarget: activeSlamTarget(normal.slam),
            phantoms: activation.phantoms,
        },
        commands,
    };
}

function resumeAfterSiphons(
    state: WardenP3SiphonState,
    snapshot: WardenP3Snapshot,
    timing: WardenP3Timing,
): WardenP3Result {
    if (snapshot.siphonStatus === WardenSiphonStatus.NONE) {
        throw new Error("Cannot resolve siphons without a result");
    }
    const reversed = snapshot.siphonStatus === WardenSiphonStatus.ALL_REVERSED;
    const resolution: ResolveEnergySiphonsCommand = {
        kind: "RESOLVE_ENERGY_SIPHONS",
        intermission: state.intermission,
        status: snapshot.siphonStatus,
        wardenDamage: reversed ? snapshot.wardenHealth.maximum * 0.05 : 0,
    };
    const failurePunishment: readonly WardenP3Command[] = reversed
        ? []
        : [{ kind: "RESOLVE_FLOOR_SLAM", target: WardenSlamTarget.CENTRE }];
    return {
        nextState: {
            phase: WardenP3Phase.NORMAL,
            nextIntermission: state.nextIntermission,
            phantoms: state.phantoms,
            slam: {
                kind: "ready",
                target: state.suspendedSlamTarget,
                beginsAtSeconds: snapshot.timeSeconds + timing.slamPostImpactRecoverySeconds,
            },
        },
        commands: [
            resolution,
            ...failurePunishment,
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: true },
        ],
    };
}

function stepNormal(
    state: WardenP3NormalState,
    snapshot: WardenP3Snapshot,
    arena: WardenP3Arena,
    timing: WardenP3Timing,
): WardenP3Result {
    if (snapshot.wardenHealth.current <= 0) {
        return completeEncounter();
    }
    const phantomStep = stepPhantoms(state.phantoms, snapshot.timeSeconds, timing);
    const workingState = { ...state, phantoms: phantomStep.phantoms };
    if (
        workingState.nextIntermission !== undefined &&
        intermissionIsDue(workingState.nextIntermission, snapshot.wardenHealth)
    ) {
        const intermission = beginIntermission(workingState, snapshot, timing);
        return {
            nextState: intermission.nextState,
            commands: [...phantomStep.commands, ...intermission.commands],
        };
    }
    if (
        workingState.nextIntermission === undefined &&
        healthFraction(snapshot.wardenHealth) <= ENRAGE_HEALTH_FRACTION
    ) {
        const enrage = enterEnrage(workingState, snapshot, arena, timing);
        return {
            nextState: enrage.nextState,
            commands: [...phantomStep.commands, ...enrage.commands],
        };
    }
    switch (workingState.slam.kind) {
        case "ready":
            if (snapshot.timeSeconds < workingState.slam.beginsAtSeconds) {
                return { nextState: workingState, commands: phantomStep.commands };
            }
            return {
                nextState: {
                    ...workingState,
                    slam: {
                        kind: "aiming",
                        target: workingState.slam.target,
                        resolvesAtSeconds: snapshot.timeSeconds + timing.slamAimToImpactSeconds,
                    },
                },
                commands: [
                    ...phantomStep.commands,
                    { kind: "ROTATE_WARDEN", target: workingState.slam.target },
                ],
            };
        case "aiming":
            if (snapshot.timeSeconds < workingState.slam.resolvesAtSeconds) {
                return { nextState: workingState, commands: phantomStep.commands };
            }
            return {
                nextState: {
                    ...workingState,
                    slam: {
                        kind: "ready",
                        target: nextSlamTarget(workingState.slam.target),
                        beginsAtSeconds:
                            snapshot.timeSeconds + timing.slamPostImpactRecoverySeconds,
                    },
                },
                commands: [
                    ...phantomStep.commands,
                    { kind: "RESOLVE_FLOOR_SLAM", target: workingState.slam.target },
                ],
            };
    }
}

function stepSiphons(
    state: WardenP3SiphonState,
    snapshot: WardenP3Snapshot,
    timing: WardenP3Timing,
): WardenP3Result {
    const phantomStep = stepPhantoms(state.phantoms, snapshot.timeSeconds, timing);
    const workingState = { ...state, phantoms: phantomStep.phantoms };
    if (snapshot.siphonStatus === WardenSiphonStatus.NONE) {
        return { nextState: workingState, commands: phantomStep.commands };
    }
    const resumed = resumeAfterSiphons(workingState, snapshot, timing);
    return {
        nextState: resumed.nextState,
        commands: [...phantomStep.commands, ...resumed.commands],
    };
}

function stepEnrage(
    state: WardenP3EnrageState,
    snapshot: WardenP3Snapshot,
    timing: WardenP3Timing,
): WardenP3Result {
    if (snapshot.wardenHealth.current <= 0) {
        return completeEncounter();
    }
    const phantomStep = stepPhantoms(state.phantoms, snapshot.timeSeconds, timing);
    const commands: WardenP3Command[] = [...phantomStep.commands];
    const pendingLightningAtStart = state.pendingLightning;
    const lightningStrikes =
        pendingLightningAtStart !== undefined &&
        snapshot.timeSeconds >= pendingLightningAtStart.strikesAtSeconds;
    const pendingLightning = lightningStrikes ? undefined : state.pendingLightning;
    if (lightningStrikes && pendingLightningAtStart !== undefined) {
        commands.push({ kind: "STRIKE_LIGHTNING", target: pendingLightningAtStart.target });
    }
    const lightningWarningDue =
        pendingLightning === undefined &&
        snapshot.timeSeconds >= state.nextLightningWarningAtSeconds;
    const nextPendingLightning = lightningWarningDue
        ? {
              target: snapshot.playerTile,
              strikesAtSeconds: snapshot.timeSeconds + timing.lightningWarningSeconds,
          }
        : pendingLightning;
    if (lightningWarningDue) {
        commands.push({ kind: "WARN_LIGHTNING", target: snapshot.playerTile });
    }
    const rowRemovalDue =
        snapshot.timeSeconds >= state.nextRowRemovalAtSeconds && state.nextRowToRemove > 1;
    if (rowRemovalDue) {
        commands.push({
            kind: "REMOVE_ARENA_ROW",
            distanceFromWarden: state.nextRowToRemove,
        });
    }
    return {
        nextState: {
            phase: WardenP3Phase.ENRAGE,
            phantoms: phantomStep.phantoms,
            pendingLightning: nextPendingLightning,
            nextLightningWarningAtSeconds: lightningWarningDue
                ? snapshot.timeSeconds + timing.lightningWarningIntervalSeconds
                : state.nextLightningWarningAtSeconds,
            nextRowRemovalAtSeconds: rowRemovalDue
                ? snapshot.timeSeconds + timing.rowRemovalIntervalSeconds
                : state.nextRowRemovalAtSeconds,
            nextRowToRemove: rowRemovalDue ? state.nextRowToRemove - 1 : state.nextRowToRemove,
        },
        commands,
    };
}

export function initialWardenP3State(
    beginsAtSeconds: number,
    arena: ParsedWardenP3Arena,
): WardenP3NormalState {
    assertFiniteNonNegative(beginsAtSeconds, "beginsAtSeconds");
    return {
        phase: WardenP3Phase.NORMAL,
        nextIntermission: WardenP3Intermission.FIRST,
        phantoms: [],
        slam: {
            kind: "ready",
            target: WardenSlamTarget.RIGHT,
            beginsAtSeconds,
        },
    };
}

export function stepWardenP3(
    state: WardenP3State,
    snapshot: WardenP3Snapshot,
    arena: ParsedWardenP3Arena,
    timing: ParsedWardenP3Timing = DEFAULT_PARSED_WARDEN_P3_TIMING,
): WardenP3Result {
    validateSnapshot(snapshot);
    switch (state.phase) {
        case WardenP3Phase.NORMAL:
            return stepNormal(state, snapshot, arena, timing);
        case WardenP3Phase.SIPHONS:
            return stepSiphons(state, snapshot, timing);
        case WardenP3Phase.ENRAGE:
            return stepEnrage(state, snapshot, timing);
        case WardenP3Phase.COMPLETE:
            return { nextState: state, commands: [] };
    }
}
