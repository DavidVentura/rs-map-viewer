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

// Zebak's phantom alternates the two projectile styles Zebak himself throws.
export enum ZebakPhantomStyle {
    MAGIC = "magic",
    RANGED = "ranged",
}

export enum WardenSlamTempo {
    NORMAL = "normal",
    // The enrage phase's quicker slams.
    FAST = "fast",
}

// What the Warden is doing between slams: channelling through a siphon intermission, standing
// over the floor, or enraged.
export enum WardenStance {
    CHARGING = "charging",
    STANDING = "standing",
    ENRAGED = "enraged",
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

export type WardenSlamTiming = {
    readonly impactSeconds: number;
    // Start to start: the next slam begins as this one's sequence ends.
    readonly durationSeconds: number;
};

export type WardenStanceTiming = {
    // The Warden slams again only once its stance transition has played out.
    readonly transitionSeconds: number;
};

export type WardenPhantomAttackTiming = {
    readonly releaseSeconds: number;
    readonly durationSeconds: number;
};

export type WardenP3HazardTiming = {
    // From the end of a phantom's attack sequence to the start of its next one, so every attack
    // plays out in full before the phantom winds up again.
    readonly phantomAttackRestSeconds: number;
    readonly lightningWarningSeconds: number;
    readonly lightningWarningIntervalSeconds: number;
    readonly rowRemovalIntervalSeconds: number;
};

export type WardenP3Timing = WardenP3HazardTiming & {
    readonly slams: Readonly<
        Record<WardenSlamTempo, Readonly<Record<WardenSlamTarget, WardenSlamTiming>>>
    >;
    readonly stances: Readonly<Record<WardenStance, WardenStanceTiming>>;
    readonly phantomAttacks: Readonly<Record<WardenPhantom, WardenPhantomAttackTiming>>;
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

type SwingingSlam = {
    readonly kind: "swinging";
    readonly target: WardenSlamTarget;
    readonly landsAtSeconds: number;
    readonly nextBeginsAtSeconds: number;
};

type WardenSlamState = ReadySlam | SwingingSlam;

type ReadyPhantomAttack = {
    readonly kind: "ready";
    readonly beginsAtSeconds: number;
};

type WindingUpPhantomAttack = {
    readonly kind: "winding_up";
    readonly releasesAtSeconds: number;
    readonly nextBeginsAtSeconds: number;
};

type ActivePhantom = {
    readonly phantom: WardenPhantom;
    readonly attack: ReadyPhantomAttack | WindingUpPhantomAttack;
    readonly releasedAttackCount: number;
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
    readonly slam: WardenSlamState;
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

export type BeginSlamCommand = {
    readonly kind: "BEGIN_SLAM";
    readonly target: WardenSlamTarget;
    readonly tempo: WardenSlamTempo;
};

export type ChangeWardenStanceCommand = {
    readonly kind: "CHANGE_WARDEN_STANCE";
    readonly stance: WardenStance;
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

export type BeginPhantomAttackCommand = {
    readonly kind: "BEGIN_PHANTOM_ATTACK";
    readonly phantom: WardenPhantom;
};

export type PhantomAttackRelease =
    | { readonly phantom: WardenPhantom.ZEBAK; readonly style: ZebakPhantomStyle }
    | { readonly phantom: WardenPhantom.BABA };

export type ReleasePhantomAttackCommand = {
    readonly kind: "RELEASE_PHANTOM_ATTACK";
    readonly release: PhantomAttackRelease;
};

type PhantomAttackCommand = BeginPhantomAttackCommand | ReleasePhantomAttackCommand;

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
    | BeginSlamCommand
    | ResolveFloorSlamCommand
    | ChangeWardenStanceCommand
    | SetWardenVulnerabilityCommand
    | SpawnEnergySiphonsCommand
    | ResolveEnergySiphonsCommand
    | ActivatePhantomCommand
    | BeginPhantomAttackCommand
    | ReleasePhantomAttackCommand
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

export const WARDEN_P3_HAZARD_TIMING: WardenP3HazardTiming = {
    phantomAttackRestSeconds: 2.4,
    lightningWarningSeconds: 0.6,
    lightningWarningIntervalSeconds: 1.2,
    rowRemovalIntervalSeconds: 2.4,
};

function assertFiniteNonNegative(value: number, description: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${description} must be a finite non-negative number`);
    }
}

function assertFinitePositive(value: number, description: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${description} must be a finite positive number`);
    }
}

export function parseWardenP3Timing(timing: WardenP3Timing): ParsedWardenP3Timing {
    assertFinitePositive(timing.phantomAttackRestSeconds, "phantomAttackRestSeconds");
    assertFinitePositive(timing.lightningWarningSeconds, "lightningWarningSeconds");
    assertFinitePositive(timing.lightningWarningIntervalSeconds, "lightningWarningIntervalSeconds");
    assertFinitePositive(timing.rowRemovalIntervalSeconds, "rowRemovalIntervalSeconds");
    if (timing.lightningWarningIntervalSeconds < timing.lightningWarningSeconds) {
        throw new RangeError("lightningWarningIntervalSeconds cannot overlap lightning warnings");
    }
    for (const [tempo, slams] of Object.entries(timing.slams)) {
        for (const [target, slam] of Object.entries(slams)) {
            assertFinitePositive(slam.durationSeconds, `The ${tempo} ${target} slam's duration`);
            assertFiniteNonNegative(slam.impactSeconds, `The ${tempo} ${target} slam's impact`);
            if (slam.impactSeconds >= slam.durationSeconds) {
                throw new RangeError(
                    `The ${tempo} ${target} slam must land before its sequence ends`,
                );
            }
        }
    }
    for (const [stance, { transitionSeconds }] of Object.entries(timing.stances)) {
        assertFiniteNonNegative(transitionSeconds, `The ${stance} stance's transition`);
    }
    for (const [phantom, attack] of Object.entries(timing.phantomAttacks)) {
        assertFinitePositive(attack.durationSeconds, `The ${phantom} phantom attack's duration`);
        assertFiniteNonNegative(attack.releaseSeconds, `The ${phantom} phantom attack's release`);
        if (attack.releaseSeconds >= attack.durationSeconds) {
            throw new RangeError(
                `The ${phantom} phantom attack must release before its sequence ends`,
            );
        }
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

function phantomAttackRelease(
    phantom: WardenPhantom,
    releasedAttackCount: number,
): PhantomAttackRelease {
    switch (phantom) {
        case WardenPhantom.ZEBAK:
            return {
                phantom,
                style:
                    releasedAttackCount % 2 === 0
                        ? ZebakPhantomStyle.MAGIC
                        : ZebakPhantomStyle.RANGED,
            };
        case WardenPhantom.BABA:
            return { phantom };
    }
}

// Like the Warden's slams, an attack releases on its sequence's release frame and the next one
// waits for the whole sequence plus the rest.
function stepPhantom(
    active: ActivePhantom,
    timeSeconds: number,
    timing: WardenP3Timing,
): { readonly phantom: ActivePhantom; readonly command: PhantomAttackCommand | undefined } {
    const { attack } = active;
    switch (attack.kind) {
        case "ready": {
            if (timeSeconds < attack.beginsAtSeconds) {
                return { phantom: active, command: undefined };
            }
            const attackTiming = timing.phantomAttacks[active.phantom];
            return {
                phantom: {
                    ...active,
                    attack: {
                        kind: "winding_up",
                        releasesAtSeconds: timeSeconds + attackTiming.releaseSeconds,
                        nextBeginsAtSeconds:
                            timeSeconds +
                            attackTiming.durationSeconds +
                            timing.phantomAttackRestSeconds,
                    },
                },
                command: { kind: "BEGIN_PHANTOM_ATTACK", phantom: active.phantom },
            };
        }
        case "winding_up":
            if (timeSeconds < attack.releasesAtSeconds) {
                return { phantom: active, command: undefined };
            }
            return {
                phantom: {
                    phantom: active.phantom,
                    attack: { kind: "ready", beginsAtSeconds: attack.nextBeginsAtSeconds },
                    releasedAttackCount: active.releasedAttackCount + 1,
                },
                command: {
                    kind: "RELEASE_PHANTOM_ATTACK",
                    release: phantomAttackRelease(active.phantom, active.releasedAttackCount),
                },
            };
    }
}

function stepPhantoms(
    phantoms: readonly ActivePhantom[],
    timeSeconds: number,
    timing: WardenP3Timing,
): {
    readonly phantoms: readonly ActivePhantom[];
    readonly commands: readonly PhantomAttackCommand[];
} {
    const steps = phantoms.map((phantom) => stepPhantom(phantom, timeSeconds, timing));
    return {
        phantoms: steps.map((step) => step.phantom),
        commands: steps.flatMap((step) => (step.command === undefined ? [] : [step.command])),
    };
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
            {
                phantom,
                attack: {
                    kind: "ready",
                    beginsAtSeconds: timeSeconds + timing.phantomAttackRestSeconds,
                },
                releasedAttackCount: 0,
            },
        ],
        command: { kind: "ACTIVATE_PHANTOM", phantom },
    };
}

// The floor wave sets off at the slam's impact, while the next slam waits for this one's sequence
// to finish so each slam plays out in full.
function stepSlam(
    slam: WardenSlamState,
    timeSeconds: number,
    tempo: WardenSlamTempo,
    timing: WardenP3Timing,
): {
    readonly slam: WardenSlamState;
    readonly commands: readonly (BeginSlamCommand | ResolveFloorSlamCommand)[];
} {
    switch (slam.kind) {
        case "ready": {
            if (timeSeconds < slam.beginsAtSeconds) {
                return { slam, commands: [] };
            }
            const slamTiming = timing.slams[tempo][slam.target];
            return {
                slam: {
                    kind: "swinging",
                    target: slam.target,
                    landsAtSeconds: timeSeconds + slamTiming.impactSeconds,
                    nextBeginsAtSeconds: timeSeconds + slamTiming.durationSeconds,
                },
                commands: [{ kind: "BEGIN_SLAM", target: slam.target, tempo }],
            };
        }
        case "swinging":
            if (timeSeconds < slam.landsAtSeconds) {
                return { slam, commands: [] };
            }
            return {
                slam: {
                    kind: "ready",
                    target: nextSlamTarget(slam.target),
                    beginsAtSeconds: slam.nextBeginsAtSeconds,
                },
                commands: [{ kind: "RESOLVE_FLOOR_SLAM", target: slam.target }],
            };
    }
}

// A slam cut short by a phase change never lands, so its target is the first one slammed once the
// new stance's transition has played out.
function slamAfterStanceChange(
    stance: WardenStance,
    target: WardenSlamTarget,
    timeSeconds: number,
    timing: WardenP3Timing,
): ReadySlam {
    return {
        kind: "ready",
        target,
        beginsAtSeconds: timeSeconds + timing.stances[stance].transitionSeconds,
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
            slam: slamAfterStanceChange(
                WardenStance.ENRAGED,
                activeSlamTarget(normal.slam),
                snapshot.timeSeconds,
                timing,
            ),
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
            { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.ENRAGED },
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
    commands.push({ kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.CHARGING });
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
            slam: slamAfterStanceChange(
                WardenStance.STANDING,
                state.suspendedSlamTarget,
                snapshot.timeSeconds,
                timing,
            ),
        },
        commands: [
            resolution,
            ...failurePunishment,
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: true },
            { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.STANDING },
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
    const slamStep = stepSlam(
        workingState.slam,
        snapshot.timeSeconds,
        WardenSlamTempo.NORMAL,
        timing,
    );
    return {
        nextState: { ...workingState, slam: slamStep.slam },
        commands: [...phantomStep.commands, ...slamStep.commands],
    };
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
    const slamStep = stepSlam(state.slam, snapshot.timeSeconds, WardenSlamTempo.FAST, timing);
    const commands: WardenP3Command[] = [...phantomStep.commands, ...slamStep.commands];
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
            slam: slamStep.slam,
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
    timing: ParsedWardenP3Timing,
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
