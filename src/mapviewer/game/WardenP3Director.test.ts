import {
    WardenP3Command,
    WardenP3Intermission,
    WardenP3Phase,
    WardenP3Snapshot,
    WardenP3State,
    WardenP3Tile,
    WardenPhantom,
    WardenSiphonStatus,
    WardenSlamTarget,
    WardenSlamTempo,
    WardenStance,
    initialWardenP3State,
    parseWardenP3Arena,
    parseWardenP3Timing,
    stepWardenP3,
} from "./WardenP3Director";

const arena = parseWardenP3Arena({ furthestRowFromWarden: 5 });
const timing = parseWardenP3Timing({
    slams: {
        [WardenSlamTempo.NORMAL]: {
            [WardenSlamTarget.RIGHT]: { impactSeconds: 1.25, durationSeconds: 3 },
            [WardenSlamTarget.LEFT]: { impactSeconds: 1.5, durationSeconds: 3 },
            [WardenSlamTarget.CENTRE]: { impactSeconds: 1.75, durationSeconds: 3 },
        },
        [WardenSlamTempo.FAST]: {
            [WardenSlamTarget.RIGHT]: { impactSeconds: 0.5, durationSeconds: 1.75 },
            [WardenSlamTarget.LEFT]: { impactSeconds: 0.625, durationSeconds: 1.75 },
            [WardenSlamTarget.CENTRE]: { impactSeconds: 0.75, durationSeconds: 1.75 },
        },
    },
    stances: {
        [WardenStance.CHARGING]: { transitionSeconds: 4 },
        [WardenStance.STANDING]: { transitionSeconds: 2 },
        [WardenStance.ENRAGED]: { transitionSeconds: 1 },
    },
    phantomAttackIntervalSeconds: 3,
    lightningWarningSeconds: 0.5,
    lightningWarningIntervalSeconds: 1,
    rowRemovalIntervalSeconds: 2,
});
const playerTile: WardenP3Tile = { x: 3200, y: 3201, level: 0 };

function snapshot(
    timeSeconds: number,
    currentHealth = 100,
    siphonStatus = WardenSiphonStatus.NONE,
    targetTile = playerTile,
): WardenP3Snapshot {
    return {
        timeSeconds,
        wardenHealth: { current: currentHealth, maximum: 100 },
        playerTile: targetTile,
        siphonStatus,
    };
}

function step(
    state: WardenP3State,
    timeSeconds: number,
    currentHealth = 100,
    siphonStatus = WardenSiphonStatus.NONE,
    targetTile = playerTile,
) {
    return stepWardenP3(
        state,
        snapshot(timeSeconds, currentHealth, siphonStatus, targetTile),
        arena,
        timing,
    );
}

function commandOfKind<T extends WardenP3Command["kind"]>(
    commands: readonly WardenP3Command[],
    kind: T,
): Extract<WardenP3Command, { readonly kind: T }> {
    const command = commands.find(
        (candidate): candidate is Extract<WardenP3Command, { readonly kind: T }> =>
            candidate.kind === kind,
    );
    if (command === undefined) {
        throw new Error(`Expected ${kind} command`);
    }
    return command;
}

const SLAM_CYCLE = [WardenSlamTarget.RIGHT, WardenSlamTarget.LEFT, WardenSlamTarget.CENTRE];

function hasCommand(commands: readonly WardenP3Command[], kind: WardenP3Command["kind"]): boolean {
    return commands.some((command) => command.kind === kind);
}

// Clears the four siphon intermissions and drops the Warden into enrage at enteredAtSeconds.
function enterEnrage(enteredAtSeconds: number) {
    let state: WardenP3State = initialWardenP3State(0, arena);
    for (const [timeSeconds, health] of [
        [0, 80],
        [2, 60],
        [4, 40],
        [6, 20],
    ]) {
        const intermission = step(state, timeSeconds, health);
        state = step(
            intermission.nextState,
            timeSeconds + 1,
            health,
            WardenSiphonStatus.ALL_REVERSED,
        ).nextState;
    }
    return step(state, enteredAtSeconds, 5);
}

describe("Wardens P3 director", () => {
    it("lands each slam at its own sequence's impact", () => {
        let state: WardenP3State = initialWardenP3State(0, arena);
        let beganAtSeconds = 0;
        for (const target of SLAM_CYCLE) {
            const slam = timing.slams[WardenSlamTempo.NORMAL][target];
            const begun = step(state, beganAtSeconds);
            expect(commandOfKind(begun.commands, "BEGIN_SLAM")).toEqual({
                kind: "BEGIN_SLAM",
                target,
                tempo: WardenSlamTempo.NORMAL,
            });

            const early = step(begun.nextState, beganAtSeconds + slam.impactSeconds - 0.01);
            expect(early.commands).toEqual([]);

            const landed = step(begun.nextState, beganAtSeconds + slam.impactSeconds);
            expect(landed.commands).toEqual([{ kind: "RESOLVE_FLOOR_SLAM", target }]);
            state = landed.nextState;
            beganAtSeconds += slam.durationSeconds;
        }
    });

    it("begins the next normal slam exactly as the previous slam's sequence ends", () => {
        const slam = timing.slams[WardenSlamTempo.NORMAL][WardenSlamTarget.RIGHT];
        const begun = step(initialWardenP3State(0, arena), 0);
        const landed = step(begun.nextState, slam.impactSeconds);

        const stillPlaying = step(landed.nextState, slam.durationSeconds - 0.01);
        expect(hasCommand(stillPlaying.commands, "BEGIN_SLAM")).toBe(false);

        const next = step(landed.nextState, slam.durationSeconds);
        expect(commandOfKind(next.commands, "BEGIN_SLAM")).toEqual({
            kind: "BEGIN_SLAM",
            target: WardenSlamTarget.LEFT,
            tempo: WardenSlamTempo.NORMAL,
        });
    });

    it("drops a slam cut short by an intermission and retries it once the release has played out", () => {
        const begun = step(initialWardenP3State(0, arena), 0);
        const interrupted = step(begun.nextState, 0.5, 80);
        expect(interrupted.nextState.phase).toBe(WardenP3Phase.SIPHONS);

        const resolved = step(interrupted.nextState, 1, 80, WardenSiphonStatus.ALL_REVERSED);
        const releaseEndsAtSeconds = 1 + timing.stances[WardenStance.STANDING].transitionSeconds;
        const releasing = step(resolved.nextState, releaseEndsAtSeconds - 0.01, 80);
        expect(releasing.commands).toEqual([]);

        const retried = step(resolved.nextState, releaseEndsAtSeconds, 80);
        expect(commandOfKind(retried.commands, "BEGIN_SLAM").target).toBe(WardenSlamTarget.RIGHT);
    });

    it("charges through a siphon intermission while invulnerable and releases once it resolves", () => {
        const opened = step(initialWardenP3State(0, arena), 0, 80);
        expect(opened.nextState.phase).toBe(WardenP3Phase.SIPHONS);
        expect(opened.commands).toEqual([
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: false },
            { kind: "SPAWN_ENERGY_SIPHONS", intermission: WardenP3Intermission.FIRST },
            { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.CHARGING },
        ]);

        const resolved = step(opened.nextState, 1, 80, WardenSiphonStatus.ALL_REVERSED);
        expect(resolved.nextState.phase).toBe(WardenP3Phase.NORMAL);
        expect(resolved.commands).toEqual([
            {
                kind: "RESOLVE_ENERGY_SIPHONS",
                intermission: WardenP3Intermission.FIRST,
                status: WardenSiphonStatus.ALL_REVERSED,
                wardenDamage: 5,
            },
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: true },
            { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.STANDING },
        ]);
    });

    it("activates Zebak then Ba-Ba during the second and third siphon intermissions", () => {
        let state: WardenP3State = initialWardenP3State(0, arena);

        let result = step(state, 0, 80);
        state = step(result.nextState, 1, 80, WardenSiphonStatus.ALL_REVERSED).nextState;

        result = step(state, 2, 60);
        expect(commandOfKind(result.commands, "ACTIVATE_PHANTOM").phantom).toBe(
            WardenPhantom.ZEBAK,
        );
        state = step(result.nextState, 3, 60, WardenSiphonStatus.ALL_REVERSED).nextState;

        result = step(state, 4, 40);
        expect(commandOfKind(result.commands, "ACTIVATE_PHANTOM").phantom).toBe(WardenPhantom.BABA);
    });

    it("schedules active phantom attacks while siphons are unresolved", () => {
        let state: WardenP3State = initialWardenP3State(0, arena);
        let result = step(state, 0, 80);
        state = step(result.nextState, 1, 80, WardenSiphonStatus.ALL_REVERSED).nextState;
        result = step(state, 2, 60);

        const beforeAttack = step(result.nextState, 4, 60);
        expect(beforeAttack.commands.some((command) => command.kind === "PHANTOM_ATTACK")).toBe(
            false,
        );

        const attack = step(result.nextState, 5, 60);
        expect(commandOfKind(attack.commands, "PHANTOM_ATTACK").phantom).toBe(WardenPhantom.ZEBAK);
    });

    it("enters enrage after all siphon thresholds, heals 20% maximum health, and removes rows with lightning", () => {
        const entered = enterEnrage(8);
        expect(entered.nextState.phase).toBe(WardenP3Phase.ENRAGE);
        expect(commandOfKind(entered.commands, "ENTER_ENRAGE")).toEqual({
            kind: "ENTER_ENRAGE",
            healAmount: 20,
        });
        expect(commandOfKind(entered.commands, "CHANGE_WARDEN_STANCE").stance).toBe(
            WardenStance.ENRAGED,
        );

        const warning = step(entered.nextState, 9, 25, WardenSiphonStatus.NONE, playerTile);
        expect(commandOfKind(warning.commands, "WARN_LIGHTNING").target).toEqual(playerTile);
        expect(warning.commands.some((command) => command.kind === "STRIKE_LIGHTNING")).toBe(false);

        const movedTile: WardenP3Tile = { x: 3210, y: 3211, level: 0 };
        const strike = step(warning.nextState, 9.5, 25, WardenSiphonStatus.NONE, movedTile);
        expect(commandOfKind(strike.commands, "STRIKE_LIGHTNING").target).toEqual(playerTile);

        const nextWarningAndRow = step(
            strike.nextState,
            10,
            25,
            WardenSiphonStatus.NONE,
            movedTile,
        );
        expect(commandOfKind(nextWarningAndRow.commands, "WARN_LIGHTNING").target).toEqual(
            movedTile,
        );
        expect(
            commandOfKind(nextWarningAndRow.commands, "REMOVE_ARENA_ROW").distanceFromWarden,
        ).toBe(5);
    });

    it("keeps slamming through enrage with the fast sequences alongside lightning and row removal", () => {
        const entered = enterEnrage(8);
        const firstSlamAtSeconds = 8 + timing.stances[WardenStance.ENRAGED].transitionSeconds;
        const fastRight = timing.slams[WardenSlamTempo.FAST][WardenSlamTarget.RIGHT];

        const enraging = step(entered.nextState, firstSlamAtSeconds - 0.01, 25);
        expect(hasCommand(enraging.commands, "BEGIN_SLAM")).toBe(false);

        const first = step(entered.nextState, firstSlamAtSeconds, 25);
        expect(commandOfKind(first.commands, "BEGIN_SLAM")).toEqual({
            kind: "BEGIN_SLAM",
            target: WardenSlamTarget.RIGHT,
            tempo: WardenSlamTempo.FAST,
        });
        expect(hasCommand(first.commands, "WARN_LIGHTNING")).toBe(true);

        const landed = step(first.nextState, firstSlamAtSeconds + fastRight.impactSeconds, 25);
        expect(commandOfKind(landed.commands, "RESOLVE_FLOOR_SLAM").target).toBe(
            WardenSlamTarget.RIGHT,
        );
        expect(hasCommand(landed.commands, "STRIKE_LIGHTNING")).toBe(true);

        const rowRemoved = step(landed.nextState, 10, 25);
        expect(hasCommand(rowRemoved.commands, "REMOVE_ARENA_ROW")).toBe(true);
        expect(hasCommand(rowRemoved.commands, "BEGIN_SLAM")).toBe(false);

        const second = step(
            rowRemoved.nextState,
            firstSlamAtSeconds + fastRight.durationSeconds,
            25,
        );
        expect(commandOfKind(second.commands, "BEGIN_SLAM")).toEqual({
            kind: "BEGIN_SLAM",
            target: WardenSlamTarget.LEFT,
            tempo: WardenSlamTempo.FAST,
        });
    });

    it("reports a failed siphon deadline distinctly from successful reversals", () => {
        const opened = step(initialWardenP3State(0, arena), 0, 80);
        const failed = step(opened.nextState, 1, 80, WardenSiphonStatus.DEADLINE_EXPIRED);

        expect(commandOfKind(failed.commands, "RESOLVE_ENERGY_SIPHONS").status).toBe(
            WardenSiphonStatus.DEADLINE_EXPIRED,
        );
        expect(commandOfKind(failed.commands, "RESOLVE_FLOOR_SLAM").target).toBe(
            WardenSlamTarget.CENTRE,
        );
        expect(failed.nextState.phase).toBe(WardenP3Phase.NORMAL);
    });
});
