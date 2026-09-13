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
    initialWardenP3State,
    parseWardenP3Arena,
    parseWardenP3Timing,
    stepWardenP3,
} from "./WardenP3Director";

const arena = parseWardenP3Arena({ furthestRowFromWarden: 5 });
const timing = parseWardenP3Timing({
    slamAimToImpactSeconds: 1,
    slamPostImpactRecoverySeconds: 2,
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

describe("Wardens P3 director", () => {
    it("repeats the right, left, centre slam sequence with a rotation windup", () => {
        let state: WardenP3State = initialWardenP3State(0, arena);

        let result = step(state, 0);
        expect(commandOfKind(result.commands, "ROTATE_WARDEN").target).toBe(WardenSlamTarget.RIGHT);
        state = result.nextState;

        result = step(state, 1);
        expect(commandOfKind(result.commands, "RESOLVE_FLOOR_SLAM").target).toBe(
            WardenSlamTarget.RIGHT,
        );
        state = result.nextState;

        result = step(state, 3);
        expect(commandOfKind(result.commands, "ROTATE_WARDEN").target).toBe(WardenSlamTarget.LEFT);
        state = result.nextState;

        result = step(state, 4);
        expect(commandOfKind(result.commands, "RESOLVE_FLOOR_SLAM").target).toBe(
            WardenSlamTarget.LEFT,
        );
        state = result.nextState;

        result = step(state, 6);
        expect(commandOfKind(result.commands, "ROTATE_WARDEN").target).toBe(
            WardenSlamTarget.CENTRE,
        );
    });

    it("holds the Warden invulnerable through a siphon intermission and resumes its pending slam", () => {
        const opened = step(initialWardenP3State(0, arena), 0, 80);
        expect(opened.nextState.phase).toBe(WardenP3Phase.SIPHONS);
        expect(opened.commands).toEqual([
            { kind: "SET_WARDEN_VULNERABILITY", vulnerable: false },
            { kind: "SPAWN_ENERGY_SIPHONS", intermission: WardenP3Intermission.FIRST },
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
        ]);

        const resumed = step(resolved.nextState, 3, 80);
        expect(commandOfKind(resumed.commands, "ROTATE_WARDEN").target).toBe(
            WardenSlamTarget.RIGHT,
        );
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

        const entered = step(state, 8, 5);
        expect(entered.nextState.phase).toBe(WardenP3Phase.ENRAGE);
        expect(commandOfKind(entered.commands, "ENTER_ENRAGE")).toEqual({
            kind: "ENTER_ENRAGE",
            healAmount: 20,
        });

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
