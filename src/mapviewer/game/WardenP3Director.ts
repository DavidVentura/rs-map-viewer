import { WardenP3ArenaFloor, wardenP3NextPullCount, wardenP3PullableTiles } from "./WardenP3Arena";
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

// What the Warden is doing between slams: channelling through a siphon intermission, standing
// over the floor, or enraged.
export enum WardenStance {
    CHARGING = "charging",
    STANDING = "standing",
    ENRAGED = "enraged",
}

// Where the fight opens: at the start, or (for testing, see MapViewerApp's ?phase=) straight into
// one of the siphon intermissions or the enrage.
export enum WardenP3StartPhase {
    OPENING = "opening",
    SIPHON_1 = "siphon1",
    SIPHON_2 = "siphon2",
    SIPHON_3 = "siphon3",
    SIPHON_4 = "siphon4",
    ENRAGE = "enrage",
}

export enum WardenSiphonStatus {
    NONE = "none",
    ALL_REVERSED = "all_reversed",
    DEADLINE_EXPIRED = "deadline_expired",
    SWARM_CLEARED = "swarm_cleared",
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
    readonly siphonStatus: WardenSiphonStatus;
    readonly arenaFloor: WardenP3ArenaFloor;
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

// The enrage pulls each row away in chunksPerRow chunks of random tiles, then pauses before it
// starts on the next row in.
export type WardenP3TilePullRhythm = {
    readonly chunksPerRow: number;
    // From one chunk to the next within a row.
    readonly chunkIntervalSeconds: number;
    // Added to the chunk interval after the chunk that clears a row.
    readonly rowPauseSeconds: number;
};

export type WardenP3HazardTiming = {
    // From the end of a phantom's attack sequence to the start of its next one, so every attack
    // plays out in full before the phantom winds up again.
    readonly phantomAttackRestSeconds: number;
    // From one enrage lightning volley to the next.
    readonly lightningIntervalSeconds: number;
    readonly tilePulls: WardenP3TilePullRhythm;
};

export type WardenP3Timing = WardenP3HazardTiming & {
    readonly slams: Readonly<Record<WardenSlamTarget, WardenSlamTiming>>;
    readonly stances: Readonly<Record<WardenStance, WardenStanceTiming>>;
    readonly phantomAttacks: Readonly<Record<WardenPhantom, WardenPhantomAttackTiming>>;
    // From the start of the Warden's charge to the frame it throws the siphons out.
    readonly siphonLaunchSeconds: number;
};

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

type ChargingSiphons = {
    readonly kind: "charging";
    readonly launchesAtSeconds: number;
};

type LaunchedSiphons = {
    readonly kind: "launched";
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
    readonly siphons: ChargingSiphons | LaunchedSiphons;
    // The Warden keeps slamming through a skull swarm.
    readonly slam: WardenSlamState;
};

// The Warden stops slamming once enraged; its floor goes and lightning falls instead.
export type WardenP3EnrageState = {
    readonly phase: WardenP3Phase.ENRAGE;
    readonly phantoms: readonly ActivePhantom[];
    readonly nextLightningAtSeconds: number;
    readonly nextTilePullAtSeconds: number;
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
    // What reversing every siphon deals the Warden, shared out between the siphons as they fly back.
    readonly reversalDamage: number;
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

// Which tiles the volley strikes is the world's to pick (see wardenP3LightningTargets).
export type CallLightningCommand = {
    readonly kind: "CALL_LIGHTNING";
};

// Which of the edge row's tiles go is the world's to pick (see pullWardenP3ArenaTiles).
export type PullArenaTilesCommand = {
    readonly kind: "PULL_ARENA_TILES";
    readonly count: number;
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
    | CallLightningCommand
    | PullArenaTilesCommand
    | CompleteEncounterCommand;

export type WardenP3Result = {
    readonly nextState: WardenP3State;
    readonly commands: readonly WardenP3Command[];
};

export type WardenP3Opening = WardenP3Result & {
    // What the Warden's health is set to before the opening commands run.
    readonly wardenHealthFraction: number;
};

const INTERMISSION_HEALTH_FRACTIONS: readonly number[] = [0.8, 0.6, 0.4, 0.2];
const ENRAGE_HEALTH_FRACTION = 0.05;
const ENRAGE_HEAL_FRACTION = 0.2;
const SIPHON_REVERSAL_DAMAGE_FRACTION = 0.05;

export const WARDEN_P3_HAZARD_TIMING: WardenP3HazardTiming = {
    phantomAttackRestSeconds: 2.4,
    lightningIntervalSeconds: 2.4,
    // Two game ticks between chunks, as recordings of the fight show, and three more before the
    // next row so each row reads as its own wave.
    tilePulls: { chunksPerRow: 4, chunkIntervalSeconds: 1.2, rowPauseSeconds: 1.8 },
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
    assertFinitePositive(timing.lightningIntervalSeconds, "lightningIntervalSeconds");
    const { tilePulls } = timing;
    if (!Number.isInteger(tilePulls.chunksPerRow) || tilePulls.chunksPerRow < 1) {
        throw new RangeError("The enrage must pull each row in a positive whole number of chunks");
    }
    assertFinitePositive(tilePulls.chunkIntervalSeconds, "The tile pull chunk interval");
    assertFiniteNonNegative(tilePulls.rowPauseSeconds, "The tile pull row pause");
    for (const [target, slam] of Object.entries(timing.slams)) {
        assertFinitePositive(slam.durationSeconds, `The ${target} slam's duration`);
        assertFiniteNonNegative(slam.impactSeconds, `The ${target} slam's impact`);
        if (slam.impactSeconds >= slam.durationSeconds) {
            throw new RangeError(`The ${target} slam must land before its sequence ends`);
        }
    }
    for (const [stance, { transitionSeconds }] of Object.entries(timing.stances)) {
        assertFiniteNonNegative(transitionSeconds, `The ${stance} stance's transition`);
    }
    assertFiniteNonNegative(timing.siphonLaunchSeconds, "siphonLaunchSeconds");
    if (timing.siphonLaunchSeconds >= timing.stances[WardenStance.CHARGING].transitionSeconds) {
        throw new RangeError("The Warden must throw its siphons before its charge ends");
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

export function parseWardenP3StartPhase(value: string | null): WardenP3StartPhase {
    if (value === null) {
        return WardenP3StartPhase.OPENING;
    }
    const phase = Object.values(WardenP3StartPhase).find((candidate) => candidate === value);
    if (phase === undefined) {
        throw new RangeError(
            `Unknown Wardens P3 phase "${value}", expected one of ${Object.values(
                WardenP3StartPhase,
            ).join(", ")}`,
        );
    }
    return phase;
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
            const slamTiming = timing.slams[slam.target];
            return {
                slam: {
                    kind: "swinging",
                    target: slam.target,
                    landsAtSeconds: timeSeconds + slamTiming.impactSeconds,
                    nextBeginsAtSeconds: timeSeconds + slamTiming.durationSeconds,
                },
                commands: [{ kind: "BEGIN_SLAM", target: slam.target }],
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

// A slam still swinging as the Warden enrages never lands.
function enterEnrage(
    normal: WardenP3NormalState,
    timeSeconds: number,
    wardenMaximumHealth: number,
    timing: WardenP3Timing,
): WardenP3Result {
    return {
        nextState: {
            phase: WardenP3Phase.ENRAGE,
            phantoms: normal.phantoms,
            nextLightningAtSeconds: timeSeconds + timing.lightningIntervalSeconds,
            nextTilePullAtSeconds: timeSeconds + timing.tilePulls.chunkIntervalSeconds,
        },
        commands: [
            { kind: "ENTER_ENRAGE", healAmount: wardenMaximumHealth * ENRAGE_HEAL_FRACTION },
            { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.ENRAGED },
        ],
    };
}

function beginIntermission(
    normal: WardenP3NormalState,
    timeSeconds: number,
    timing: WardenP3Timing,
): WardenP3Result {
    const intermission = normal.nextIntermission;
    if (intermission === undefined) {
        throw new Error("Cannot begin an absent Warden intermission");
    }
    const activation = activateIntermissionPhantom(
        intermission,
        normal.phantoms,
        timeSeconds,
        timing,
    );
    const commands: WardenP3Command[] = [{ kind: "SET_WARDEN_VULNERABILITY", vulnerable: false }];
    if (activation.command !== undefined) {
        commands.push(activation.command);
    }
    // The siphon charge is on hold while the skull swarm is tried in its place.
    // commands.push({ kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.CHARGING });
    return {
        nextState: {
            phase: WardenP3Phase.SIPHONS,
            intermission,
            nextIntermission: nextIntermission(intermission),
            suspendedSlamTarget: activeSlamTarget(normal.slam),
            phantoms: activation.phantoms,
            siphons: {
                kind: "charging",
                // launchesAtSeconds: timeSeconds + timing.siphonLaunchSeconds,
                launchesAtSeconds: timeSeconds,
            },
            slam: normal.slam,
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
    const resolution: ResolveEnergySiphonsCommand = {
        kind: "RESOLVE_ENERGY_SIPHONS",
        intermission: state.intermission,
        status: snapshot.siphonStatus,
        reversalDamage: snapshot.wardenHealth.maximum * SIPHON_REVERSAL_DAMAGE_FRACTION,
    };
    const failurePunishment: readonly WardenP3Command[] =
        snapshot.siphonStatus === WardenSiphonStatus.ALL_REVERSED ||
        snapshot.siphonStatus === WardenSiphonStatus.SWARM_CLEARED
            ? []
            : [{ kind: "RESOLVE_FLOOR_SLAM", target: WardenSlamTarget.CENTRE }];
    return {
        nextState: {
            phase: WardenP3Phase.NORMAL,
            nextIntermission: state.nextIntermission,
            phantoms: state.phantoms,
            // slam: slamAfterStanceChange(
            //     WardenStance.STANDING,
            //     state.suspendedSlamTarget,
            //     snapshot.timeSeconds,
            //     timing,
            // ),
            slam: state.slam,
        },
        commands: [
            resolution,
            ...failurePunishment,
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: true },
            // { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.STANDING },
        ],
    };
}

function stepNormal(
    state: WardenP3NormalState,
    snapshot: WardenP3Snapshot,
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
        const intermission = beginIntermission(workingState, snapshot.timeSeconds, timing);
        return {
            nextState: intermission.nextState,
            commands: [...phantomStep.commands, ...intermission.commands],
        };
    }
    if (
        workingState.nextIntermission === undefined &&
        healthFraction(snapshot.wardenHealth) <= ENRAGE_HEALTH_FRACTION
    ) {
        const enrage = enterEnrage(
            workingState,
            snapshot.timeSeconds,
            snapshot.wardenHealth.maximum,
            timing,
        );
        return {
            nextState: enrage.nextState,
            commands: [...phantomStep.commands, ...enrage.commands],
        };
    }
    const slamStep = stepSlam(workingState.slam, snapshot.timeSeconds, timing);
    return {
        nextState: { ...workingState, slam: slamStep.slam },
        commands: [...phantomStep.commands, ...slamStep.commands],
    };
}

// The siphons exist only once the Warden's charge reaches its throw, so they spawn there rather than
// as the intermission opens.
function launchDueSiphons(state: WardenP3SiphonState, timeSeconds: number): WardenP3Result {
    if (state.siphons.kind === "launched" || timeSeconds < state.siphons.launchesAtSeconds) {
        return { nextState: state, commands: [] };
    }
    return {
        nextState: { ...state, siphons: { kind: "launched" } },
        commands: [{ kind: "SPAWN_ENERGY_SIPHONS", intermission: state.intermission }],
    };
}

function stepSiphons(
    state: WardenP3SiphonState,
    snapshot: WardenP3Snapshot,
    timing: WardenP3Timing,
): WardenP3Result {
    const phantomStep = stepPhantoms(state.phantoms, snapshot.timeSeconds, timing);
    const slamStep = stepSlam(state.slam, snapshot.timeSeconds, timing);
    const workingState = { ...state, phantoms: phantomStep.phantoms, slam: slamStep.slam };
    if (snapshot.siphonStatus === WardenSiphonStatus.NONE) {
        const launch = launchDueSiphons(workingState, snapshot.timeSeconds);
        return {
            nextState: launch.nextState,
            commands: [...phantomStep.commands, ...slamStep.commands, ...launch.commands],
        };
    }
    const resumed = resumeAfterSiphons(workingState, snapshot, timing);
    return {
        nextState: resumed.nextState,
        commands: [...phantomStep.commands, ...slamStep.commands, ...resumed.commands],
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
    const { timeSeconds } = snapshot;
    const phantomStep = stepPhantoms(state.phantoms, timeSeconds, timing);
    const lightningDue = timeSeconds >= state.nextLightningAtSeconds;
    const pull = dueTilePull(state, snapshot.arenaFloor, timeSeconds, timing.tilePulls);
    const hazardCommands: readonly WardenP3Command[] = [
        ...(lightningDue ? [{ kind: "CALL_LIGHTNING" } as const] : []),
        ...(pull.command === undefined ? [] : [pull.command]),
    ];
    return {
        nextState: {
            phase: WardenP3Phase.ENRAGE,
            phantoms: phantomStep.phantoms,
            nextLightningAtSeconds: lightningDue
                ? timeSeconds + timing.lightningIntervalSeconds
                : state.nextLightningAtSeconds,
            nextTilePullAtSeconds: pull.nextTilePullAtSeconds,
        },
        commands: [...phantomStep.commands, ...hazardCommands],
    };
}

// The floor in the snapshot is the one before this step's pull, so whether the chunk clears its row
// is known before the world picks its tiles. Once only the Warden-adjacent row is left the pulls
// stop for good.
function dueTilePull(
    state: WardenP3EnrageState,
    floor: WardenP3ArenaFloor,
    timeSeconds: number,
    rhythm: WardenP3TilePullRhythm,
): {
    readonly command: PullArenaTilesCommand | undefined;
    readonly nextTilePullAtSeconds: number;
} {
    const pullable = wardenP3PullableTiles(floor).length;
    if (timeSeconds < state.nextTilePullAtSeconds || pullable === 0) {
        return { command: undefined, nextTilePullAtSeconds: state.nextTilePullAtSeconds };
    }
    const count = wardenP3NextPullCount(floor, rhythm.chunksPerRow);
    const clearsRow = count === pullable;
    return {
        command: { kind: "PULL_ARENA_TILES", count },
        nextTilePullAtSeconds:
            timeSeconds + rhythm.chunkIntervalSeconds + (clearsRow ? rhythm.rowPauseSeconds : 0),
    };
}

function normalState(
    beginsAtSeconds: number,
    nextIntermission: WardenP3Intermission | undefined,
    phantoms: readonly ActivePhantom[],
): WardenP3NormalState {
    return {
        phase: WardenP3Phase.NORMAL,
        nextIntermission,
        phantoms,
        slam: {
            kind: "ready",
            target: WardenSlamTarget.RIGHT,
            beginsAtSeconds,
        },
    };
}

export function initialWardenP3State(beginsAtSeconds: number): WardenP3NormalState {
    assertFiniteNonNegative(beginsAtSeconds, "beginsAtSeconds");
    return normalState(beginsAtSeconds, WardenP3Intermission.FIRST, []);
}

const ALL_INTERMISSIONS: readonly WardenP3Intermission[] = [
    WardenP3Intermission.FIRST,
    WardenP3Intermission.SECOND,
    WardenP3Intermission.THIRD,
    WardenP3Intermission.FOURTH,
];

// A later start wakes the phantoms of the intermissions it skips just as those intermissions would
// have, so they are all awake and first attack after a rest.
function openAfterSkipping(
    skipped: readonly WardenP3Intermission[],
    nextIntermission: WardenP3Intermission | undefined,
    timeSeconds: number,
    timing: WardenP3Timing,
): WardenP3Result & { readonly nextState: WardenP3NormalState } {
    const woken = skipped.reduce<{
        readonly phantoms: readonly ActivePhantom[];
        readonly commands: readonly ActivatePhantomCommand[];
    }>(
        (awake, intermission) => {
            const activation = activateIntermissionPhantom(
                intermission,
                awake.phantoms,
                timeSeconds,
                timing,
            );
            return {
                phantoms: activation.phantoms,
                commands:
                    activation.command === undefined
                        ? awake.commands
                        : [...awake.commands, activation.command],
            };
        },
        { phantoms: [], commands: [] },
    );
    return {
        nextState: normalState(timeSeconds, nextIntermission, woken.phantoms),
        commands: woken.commands,
    };
}

function openAtIntermission(
    intermission: WardenP3Intermission,
    timeSeconds: number,
    timing: WardenP3Timing,
): WardenP3Opening {
    const skipped = ALL_INTERMISSIONS.filter((candidate) => candidate < intermission);
    const opened = openAfterSkipping(skipped, intermission, timeSeconds, timing);
    const charging = beginIntermission(opened.nextState, timeSeconds, timing);
    return {
        nextState: charging.nextState,
        commands: [...opened.commands, ...charging.commands],
        wardenHealthFraction: INTERMISSION_HEALTH_FRACTIONS[intermission],
    };
}

function openAtEnrage(
    timeSeconds: number,
    wardenMaximumHealth: number,
    timing: WardenP3Timing,
): WardenP3Opening {
    const opened = openAfterSkipping(ALL_INTERMISSIONS, undefined, timeSeconds, timing);
    const enraged = enterEnrage(opened.nextState, timeSeconds, wardenMaximumHealth, timing);
    return {
        nextState: enraged.nextState,
        commands: [...opened.commands, ...enraged.commands],
        wardenHealthFraction: ENRAGE_HEALTH_FRACTION,
    };
}

// The fight's first state and the commands that set the world up for it: a later start drops the
// Warden to that phase's threshold and enters the phase the way crossing it would.
export function beginWardenP3(
    startPhase: WardenP3StartPhase,
    timeSeconds: number,
    wardenMaximumHealth: number,
    timing: ParsedWardenP3Timing,
): WardenP3Opening {
    assertFiniteNonNegative(timeSeconds, "timeSeconds");
    assertFinitePositive(wardenMaximumHealth, "The Warden's maximum health");
    switch (startPhase) {
        case WardenP3StartPhase.OPENING:
            return {
                nextState: initialWardenP3State(timeSeconds),
                commands: [],
                wardenHealthFraction: 1,
            };
        case WardenP3StartPhase.SIPHON_1:
            return openAtIntermission(WardenP3Intermission.FIRST, timeSeconds, timing);
        case WardenP3StartPhase.SIPHON_2:
            return openAtIntermission(WardenP3Intermission.SECOND, timeSeconds, timing);
        case WardenP3StartPhase.SIPHON_3:
            return openAtIntermission(WardenP3Intermission.THIRD, timeSeconds, timing);
        case WardenP3StartPhase.SIPHON_4:
            return openAtIntermission(WardenP3Intermission.FOURTH, timeSeconds, timing);
        case WardenP3StartPhase.ENRAGE:
            return openAtEnrage(timeSeconds, wardenMaximumHealth, timing);
    }
}

// The Warden's health is held at the next threshold until the director has entered that
// intermission or the enrage, so no single hit carries it past a phase.
export function wardenP3HealthFloorFraction(state: WardenP3State): number {
    switch (state.phase) {
        case WardenP3Phase.NORMAL:
        case WardenP3Phase.SIPHONS:
            return state.nextIntermission === undefined
                ? ENRAGE_HEALTH_FRACTION
                : INTERMISSION_HEALTH_FRACTIONS[state.nextIntermission];
        case WardenP3Phase.ENRAGE:
        case WardenP3Phase.COMPLETE:
            return 0;
    }
}

export function stepWardenP3(
    state: WardenP3State,
    snapshot: WardenP3Snapshot,
    timing: ParsedWardenP3Timing,
): WardenP3Result {
    validateSnapshot(snapshot);
    switch (state.phase) {
        case WardenP3Phase.NORMAL:
            return stepNormal(state, snapshot, timing);
        case WardenP3Phase.SIPHONS:
            return stepSiphons(state, snapshot, timing);
        case WardenP3Phase.ENRAGE:
            return stepEnrage(state, snapshot, timing);
        case WardenP3Phase.COMPLETE:
            return { nextState: state, commands: [] };
    }
}
