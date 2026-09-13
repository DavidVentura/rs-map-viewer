import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    pullWardenP3ArenaTiles,
    wardenP3PullableTiles,
} from "./WardenP3Arena";
import {
    WardenP3Command,
    WardenP3Intermission,
    WardenP3Phase,
    WardenP3Snapshot,
    WardenP3StartPhase,
    WardenP3State,
    WardenPhantom,
    WardenSiphonStatus,
    WardenSlamTarget,
    WardenStance,
    ZebakPhantomStyle,
    beginWardenP3,
    initialWardenP3State,
    parseWardenP3StartPhase,
    parseWardenP3Timing,
    stepWardenP3,
    wardenP3HealthFloorFraction,
} from "./WardenP3Director";

const timing = parseWardenP3Timing({
    slams: {
        [WardenSlamTarget.RIGHT]: { impactSeconds: 1.25, durationSeconds: 3 },
        [WardenSlamTarget.LEFT]: { impactSeconds: 1.5, durationSeconds: 3 },
        [WardenSlamTarget.CENTRE]: { impactSeconds: 1.75, durationSeconds: 3 },
    },
    stances: {
        [WardenStance.CHARGING]: { transitionSeconds: 4 },
        [WardenStance.STANDING]: { transitionSeconds: 2 },
        [WardenStance.ENRAGED]: { transitionSeconds: 1 },
    },
    phantomAttacks: {
        [WardenPhantom.ZEBAK]: { releaseSeconds: 1.25, durationSeconds: 2 },
        [WardenPhantom.BABA]: { releaseSeconds: 0.5, durationSeconds: 1 },
    },
    siphonLaunchSeconds: 1.5,
    phantomAttackRestSeconds: 3,
    lightningIntervalSeconds: 1,
    tilePulls: { chunksPerRow: 4, chunkIntervalSeconds: 0.5, rowPauseSeconds: 0.75 },
});

function snapshot(
    timeSeconds: number,
    currentHealth = 100,
    siphonStatus = WardenSiphonStatus.NONE,
    arenaFloor = WARDEN_P3_INITIAL_ARENA_FLOOR,
): WardenP3Snapshot {
    return {
        timeSeconds,
        wardenHealth: { current: currentHealth, maximum: 100 },
        siphonStatus,
        arenaFloor,
    };
}

function step(
    state: WardenP3State,
    timeSeconds: number,
    currentHealth = 100,
    siphonStatus = WardenSiphonStatus.NONE,
    arenaFloor = WARDEN_P3_INITIAL_ARENA_FLOOR,
) {
    return stepWardenP3(
        state,
        snapshot(timeSeconds, currentHealth, siphonStatus, arenaFloor),
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

// Clears the four siphon intermissions, leaving the Warden releasing its last charge at 7s.
function clearIntermissions(): WardenP3State {
    let state: WardenP3State = initialWardenP3State(0);
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
    return state;
}

// Drops the Warden into enrage at enteredAtSeconds, once the intermissions are cleared.
function enterEnrage(enteredAtSeconds: number) {
    return step(clearIntermissions(), enteredAtSeconds, 5);
}

describe("Wardens P3 director", () => {
    it("lands each slam at its own sequence's impact", () => {
        let state: WardenP3State = initialWardenP3State(0);
        let beganAtSeconds = 0;
        for (const target of SLAM_CYCLE) {
            const slam = timing.slams[target];
            const begun = step(state, beganAtSeconds);
            expect(commandOfKind(begun.commands, "BEGIN_SLAM")).toEqual({
                kind: "BEGIN_SLAM",
                target,
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
        const slam = timing.slams[WardenSlamTarget.RIGHT];
        const begun = step(initialWardenP3State(0), 0);
        const landed = step(begun.nextState, slam.impactSeconds);

        const stillPlaying = step(landed.nextState, slam.durationSeconds - 0.01);
        expect(hasCommand(stillPlaying.commands, "BEGIN_SLAM")).toBe(false);

        const next = step(landed.nextState, slam.durationSeconds);
        expect(commandOfKind(next.commands, "BEGIN_SLAM")).toEqual({
            kind: "BEGIN_SLAM",
            target: WardenSlamTarget.LEFT,
        });
    });

    it.skip("drops a slam cut short by an intermission and retries it once the release has played out", () => {
        const begun = step(initialWardenP3State(0), 0);
        const interrupted = step(begun.nextState, 0.5, 80);
        expect(interrupted.nextState.phase).toBe(WardenP3Phase.SIPHONS);

        const resolved = step(interrupted.nextState, 1, 80, WardenSiphonStatus.ALL_REVERSED);
        const releaseEndsAtSeconds = 1 + timing.stances[WardenStance.STANDING].transitionSeconds;
        const releasing = step(resolved.nextState, releaseEndsAtSeconds - 0.01, 80);
        expect(releasing.commands).toEqual([]);

        const retried = step(resolved.nextState, releaseEndsAtSeconds, 80);
        expect(commandOfKind(retried.commands, "BEGIN_SLAM").target).toBe(WardenSlamTarget.RIGHT);
    });

    it.skip("charges through a siphon intermission while invulnerable and releases once it resolves", () => {
        const opened = step(initialWardenP3State(0), 0, 80);
        expect(opened.nextState.phase).toBe(WardenP3Phase.SIPHONS);
        expect(opened.commands).toEqual([
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: false },
            { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.CHARGING },
        ]);

        const charging = step(opened.nextState, timing.siphonLaunchSeconds - 0.01, 80);
        expect(charging.commands).toEqual([]);
        const thrown = step(opened.nextState, timing.siphonLaunchSeconds, 80);
        expect(thrown.commands).toEqual([
            { kind: "SPAWN_ENERGY_SIPHONS", intermission: WardenP3Intermission.FIRST },
        ]);
        const thrownOnce = step(thrown.nextState, timing.siphonLaunchSeconds + 1, 80);
        expect(thrownOnce.commands).toEqual([]);

        const resolved = step(thrownOnce.nextState, 3, 80, WardenSiphonStatus.ALL_REVERSED);
        expect(resolved.nextState.phase).toBe(WardenP3Phase.NORMAL);
        expect(resolved.commands).toEqual([
            {
                kind: "RESOLVE_ENERGY_SIPHONS",
                intermission: WardenP3Intermission.FIRST,
                status: WardenSiphonStatus.ALL_REVERSED,
                reversalDamage: 5,
            },
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: true },
            { kind: "CHANGE_WARDEN_STANCE", stance: WardenStance.STANDING },
        ]);
    });

    it("activates Zebak then Ba-Ba during the second and third siphon intermissions", () => {
        let state: WardenP3State = initialWardenP3State(0);

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

    // Opens the second intermission at 2s, which activates Zebak's phantom.
    function activateZebak() {
        const first = step(initialWardenP3State(0), 0, 80);
        const resumed = step(first.nextState, 1, 80, WardenSiphonStatus.ALL_REVERSED).nextState;
        return step(resumed, 2, 60);
    }

    it("schedules active phantom attacks while siphons are unresolved", () => {
        const result = activateZebak();

        const beforeAttack = step(result.nextState, 4.99, 60);
        expect(hasCommand(beforeAttack.commands, "BEGIN_PHANTOM_ATTACK")).toBe(false);

        const attack = step(result.nextState, 5, 60);
        expect(commandOfKind(attack.commands, "BEGIN_PHANTOM_ATTACK").phantom).toBe(
            WardenPhantom.ZEBAK,
        );
    });

    it("never attacks with a phantom before its intermission activates it or once the fight is over", () => {
        let state: WardenP3State = initialWardenP3State(0);
        const first = step(state, 0, 80);
        state = step(first.nextState, 1, 80, WardenSiphonStatus.ALL_REVERSED).nextState;
        for (let timeSeconds = 1; timeSeconds < 60; timeSeconds += 0.5) {
            const result = step(state, timeSeconds, 80);
            expect(hasCommand(result.commands, "BEGIN_PHANTOM_ATTACK")).toBe(false);
            expect(hasCommand(result.commands, "RELEASE_PHANTOM_ATTACK")).toBe(false);
            state = result.nextState;
        }

        const resumed = step(activateZebak().nextState, 3, 60, WardenSiphonStatus.ALL_REVERSED);
        const completed = step(resumed.nextState, 4, 0);
        expect(completed.nextState.phase).toBe(WardenP3Phase.COMPLETE);
        const afterCompletion = step(completed.nextState, 30, 0);
        expect(afterCompletion.commands).toEqual([]);
    });

    it.skip("releases each phantom attack on its release frame and rests after the whole sequence, alternating Zebak's styles", () => {
        const zebak = timing.phantomAttacks[WardenPhantom.ZEBAK];
        const firstBeginsAt = 2 + timing.phantomAttackRestSeconds;
        const begun = step(activateZebak().nextState, firstBeginsAt, 60);
        expect(hasCommand(begun.commands, "BEGIN_PHANTOM_ATTACK")).toBe(true);

        const windingUp = step(begun.nextState, firstBeginsAt + zebak.releaseSeconds - 0.01, 60);
        expect(windingUp.commands).toEqual([]);

        const released = step(begun.nextState, firstBeginsAt + zebak.releaseSeconds, 60);
        expect(commandOfKind(released.commands, "RELEASE_PHANTOM_ATTACK").release).toEqual({
            phantom: WardenPhantom.ZEBAK,
            style: ZebakPhantomStyle.MAGIC,
        });

        const secondBeginsAt =
            firstBeginsAt + zebak.durationSeconds + timing.phantomAttackRestSeconds;
        const resting = step(released.nextState, secondBeginsAt - 0.01, 60);
        expect(resting.commands).toEqual([]);

        const secondBegun = step(released.nextState, secondBeginsAt, 60);
        expect(hasCommand(secondBegun.commands, "BEGIN_PHANTOM_ATTACK")).toBe(true);
        const secondReleased = step(
            secondBegun.nextState,
            secondBeginsAt + zebak.releaseSeconds,
            60,
        );
        expect(commandOfKind(secondReleased.commands, "RELEASE_PHANTOM_ATTACK").release).toEqual({
            phantom: WardenPhantom.ZEBAK,
            style: ZebakPhantomStyle.RANGED,
        });
    });

    it("enters enrage after all siphon thresholds and heals 20% of the Warden's maximum health", () => {
        const entered = enterEnrage(8);
        expect(entered.nextState.phase).toBe(WardenP3Phase.ENRAGE);
        expect(commandOfKind(entered.commands, "ENTER_ENRAGE")).toEqual({
            kind: "ENTER_ENRAGE",
            healAmount: 20,
        });
        expect(commandOfKind(entered.commands, "CHANGE_WARDEN_STANCE").stance).toBe(
            WardenStance.ENRAGED,
        );
    });

    it("calls lightning volleys on their own cadence through enrage", () => {
        let state = enterEnrage(8).nextState;
        let volleys = 0;
        for (let timeSeconds = 8; timeSeconds <= 12.001; timeSeconds += 0.125) {
            const result = step(state, timeSeconds, 25);
            volleys += result.commands.filter(
                (command) => command.kind === "CALL_LIGHTNING",
            ).length;
            state = result.nextState;
        }

        expect(volleys).toBe(4 / timing.lightningIntervalSeconds);
    });

    it("pulls each row in even chunks a chunk interval apart, pausing before the next row", () => {
        const { chunkIntervalSeconds, rowPauseSeconds } = timing.tilePulls;
        let state = enterEnrage(8).nextState;
        let floor: WardenP3ArenaFloor = WARDEN_P3_INITIAL_ARENA_FLOOR;
        const pulls: { readonly atSeconds: number; readonly count: number }[] = [];
        for (let timeSeconds = 8; pulls.length < 8; timeSeconds += 0.125) {
            const result = step(state, timeSeconds, 25, WardenSiphonStatus.NONE, floor);
            for (const command of result.commands) {
                if (command.kind === "PULL_ARENA_TILES") {
                    pulls.push({ atSeconds: timeSeconds, count: command.count });
                    floor = pullWardenP3ArenaTiles(floor, command.count, () => 0.5).floor;
                }
            }
            state = result.nextState;
        }

        expect(pulls.map((pull) => pull.count)).toEqual([6, 5, 5, 5, 6, 5, 5, 5]);
        const gaps = pulls.slice(1).map((pull, index) => pull.atSeconds - pulls[index].atSeconds);
        const chunkGap = chunkIntervalSeconds;
        const rowGap = chunkIntervalSeconds + rowPauseSeconds;
        expect(gaps).toEqual([chunkGap, chunkGap, chunkGap, rowGap, chunkGap, chunkGap, chunkGap]);
        expect(pulls[0].atSeconds).toBe(8 + chunkIntervalSeconds);
    });

    it("stops pulling tiles once only the Warden-adjacent row is left", () => {
        let floor: WardenP3ArenaFloor = WARDEN_P3_INITIAL_ARENA_FLOOR;
        while (wardenP3PullableTiles(floor).length > 0) {
            floor = pullWardenP3ArenaTiles(
                floor,
                wardenP3PullableTiles(floor).length,
                () => 0,
            ).floor;
        }
        let state = enterEnrage(8).nextState;
        for (let timeSeconds = 8; timeSeconds < 20; timeSeconds += 0.125) {
            const result = step(state, timeSeconds, 25, WardenSiphonStatus.NONE, floor);
            expect(hasCommand(result.commands, "PULL_ARENA_TILES")).toBe(false);
            state = result.nextState;
        }
    });

    it.skip("never slams once enraged, dropping the slam it was swinging as it enraged", () => {
        const released = clearIntermissions();
        const slamBeginsAtSeconds = 7 + timing.stances[WardenStance.STANDING].transitionSeconds;
        const swinging = step(released, slamBeginsAtSeconds, 20);
        expect(commandOfKind(swinging.commands, "BEGIN_SLAM").target).toBe(WardenSlamTarget.RIGHT);

        const enraged = step(swinging.nextState, slamBeginsAtSeconds + 0.5, 5);
        expect(enraged.nextState.phase).toBe(WardenP3Phase.ENRAGE);
        let state = enraged.nextState;
        for (let timeSeconds = slamBeginsAtSeconds + 0.5; timeSeconds < 40; timeSeconds += 0.125) {
            const result = step(state, timeSeconds, 25);
            expect(hasCommand(result.commands, "BEGIN_SLAM")).toBe(false);
            expect(hasCommand(result.commands, "RESOLVE_FLOOR_SLAM")).toBe(false);
            state = result.nextState;
        }
    });

    it("reports a failed siphon deadline distinctly from successful reversals", () => {
        const opened = step(initialWardenP3State(0), 0, 80);
        const failed = step(opened.nextState, 1, 80, WardenSiphonStatus.DEADLINE_EXPIRED);

        expect(commandOfKind(failed.commands, "RESOLVE_ENERGY_SIPHONS")).toMatchObject({
            status: WardenSiphonStatus.DEADLINE_EXPIRED,
            reversalDamage: 5,
        });
        expect(commandOfKind(failed.commands, "RESOLVE_FLOOR_SLAM").target).toBe(
            WardenSlamTarget.CENTRE,
        );
        expect(failed.nextState.phase).toBe(WardenP3Phase.NORMAL);
    });
});

function activatedPhantoms(commands: readonly WardenP3Command[]): readonly WardenPhantom[] {
    return commands.flatMap((command) =>
        command.kind === "ACTIVATE_PHANTOM" ? [command.phantom] : [],
    );
}

describe("Wardens P3 start phases", () => {
    it("parses each start phase, opens at the start without one and rejects an unknown one", () => {
        expect(parseWardenP3StartPhase(null)).toBe(WardenP3StartPhase.OPENING);
        expect(parseWardenP3StartPhase("siphon3")).toBe(WardenP3StartPhase.SIPHON_3);
        expect(parseWardenP3StartPhase("enrage")).toBe(WardenP3StartPhase.ENRAGE);
        expect(() => parseWardenP3StartPhase("siphon5")).toThrow(/siphon5/);
    });

    it("opens at the start at full health with nothing awake", () => {
        expect(beginWardenP3(WardenP3StartPhase.OPENING, 5, 100, timing)).toEqual({
            nextState: initialWardenP3State(5),
            commands: [],
            wardenHealthFraction: 1,
        });
    });

    it.skip.each([
        [WardenP3StartPhase.SIPHON_1, WardenP3Intermission.FIRST, []],
        [WardenP3StartPhase.SIPHON_2, WardenP3Intermission.SECOND, [WardenPhantom.ZEBAK]],
        [
            WardenP3StartPhase.SIPHON_3,
            WardenP3Intermission.THIRD,
            [WardenPhantom.ZEBAK, WardenPhantom.BABA],
        ],
        [
            WardenP3StartPhase.SIPHON_4,
            WardenP3Intermission.FOURTH,
            [WardenPhantom.ZEBAK, WardenPhantom.BABA],
        ],
    ])(
        "%s opens charging through its intermission with every phantom woken by then",
        (startPhase, intermission, phantoms) => {
            const opening = beginWardenP3(startPhase, 5, 100, timing);
            expect(opening.nextState).toMatchObject({ phase: WardenP3Phase.SIPHONS, intermission });
            expect(activatedPhantoms(opening.commands)).toEqual(phantoms);
            expect(opening.commands).toContainEqual({
                kind: "SET_WARDEN_VULNERABILITY",
                vulnerable: false,
            });
            expect(opening.commands).toContainEqual({
                kind: "CHANGE_WARDEN_STANCE",
                stance: WardenStance.CHARGING,
            });
            expect(opening.wardenHealthFraction).toBeGreaterThan(
                wardenP3HealthFloorFraction(opening.nextState),
            );

            const health = opening.wardenHealthFraction * 100;
            const resumed = step(opening.nextState, 6, health, WardenSiphonStatus.ALL_REVERSED);
            const afterwards = step(resumed.nextState, 7, health);
            expect(afterwards.nextState.phase).toBe(WardenP3Phase.NORMAL);
        },
    );

    it("opens enraged at the enrage threshold with both phantoms awake and attacking", () => {
        const opening = beginWardenP3(WardenP3StartPhase.ENRAGE, 5, 100, timing);
        expect(opening.nextState.phase).toBe(WardenP3Phase.ENRAGE);
        expect(activatedPhantoms(opening.commands)).toEqual([
            WardenPhantom.ZEBAK,
            WardenPhantom.BABA,
        ]);
        expect(commandOfKind(opening.commands, "ENTER_ENRAGE").healAmount).toBeGreaterThan(0);
        expect(commandOfKind(opening.commands, "CHANGE_WARDEN_STANCE").stance).toBe(
            WardenStance.ENRAGED,
        );

        const health = opening.wardenHealthFraction * 100;
        const rested = step(opening.nextState, 5 + timing.phantomAttackRestSeconds, health);
        expect(
            rested.commands.flatMap((command) =>
                command.kind === "BEGIN_PHANTOM_ATTACK" ? [command.phantom] : [],
            ),
        ).toEqual([WardenPhantom.ZEBAK, WardenPhantom.BABA]);
    });
});
