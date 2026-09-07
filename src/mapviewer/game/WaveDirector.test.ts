import { Wave, WaveStartCondition } from "./Encounter";
import { EnemyTypeId } from "./EnemyType";
import {
    MAX_LIVE_WAVE_ENEMIES,
    initialWaveDirectorState,
    pickFarthestSpawnPoint,
    stepWaveDirector,
} from "./WaveDirector";

function wave(count: number, startCondition: WaveStartCondition, count2 = 0): Wave {
    const groups = [{ enemyTypeId: EnemyTypeId.TZ_KIH, count }];
    if (count2 > 0) {
        groups.push({ enemyTypeId: EnemyTypeId.TZ_KEK, count: count2 });
    }
    return { groups, startCondition };
}

describe("stepWaveDirector", () => {
    it("starts the first wave immediately and spawns its full group", () => {
        const table = [wave(4, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 })];
        const state = initialWaveDirectorState(table.length);

        const result = stepWaveDirector(state, table, 0, [0], [0]);

        expect(result.spawns.length).toBe(4);
        expect(result.spawns.every((spawn) => spawn.waveIndex === 0)).toBe(true);
        expect(result.nextState.waveStartedAtSeconds[0]).toBe(0);
    });

    it("does not start wave 2 until wave 1 drops to the alive threshold or the timer elapses", () => {
        const table = [
            wave(4, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
            wave(6, { maxPreviousAliveFraction: 0.5, maxElapsedSeconds: 10 }),
        ];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0], [0, 0]).nextState;

        // Wave 1 still fully alive (4/4 = 100% > 50%), well before the 10s timer.
        const stillWaiting = stepWaveDirector(state, table, 5, [4, 0], [0, 0]);
        expect(stillWaiting.spawns.length).toBe(0);
        expect(stillWaiting.nextState.nextWaveIndex).toBe(1);

        // Wave 1 down to 2/4 = 50% alive, at or below the threshold: wave 2 should start.
        const dropsBelowThreshold = stepWaveDirector(state, table, 5, [2, 0], [2, 0]);
        expect(dropsBelowThreshold.spawns.length).toBe(6);
        expect(dropsBelowThreshold.nextState.nextWaveIndex).toBe(2);
    });

    it("starts the next wave once its elapsed-time fallback fires, even if the previous wave is still nearly full", () => {
        const table = [
            wave(4, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
            wave(6, { maxPreviousAliveFraction: 0.1, maxElapsedSeconds: 10 }),
        ];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0], [0, 0]).nextState;

        const beforeTimeout = stepWaveDirector(state, table, 9.9, [4, 0], [0, 0]);
        expect(beforeTimeout.spawns.length).toBe(0);

        const afterTimeout = stepWaveDirector(state, table, 10, [4, 0], [0, 0]);
        expect(afterTimeout.spawns.length).toBe(6);
        expect(afterTimeout.nextState.nextWaveIndex).toBe(2);
    });

    it("overlaps waves: the next wave's enemies can be alive at the same time as the previous wave's survivors", () => {
        const table = [
            wave(4, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
            wave(6, { maxPreviousAliveFraction: 0.5, maxElapsedSeconds: 10 }),
        ];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0], [0, 0]).nextState;
        const started = stepWaveDirector(state, table, 5, [2, 0], [2, 0]);
        state = started.nextState;

        // Both wave 1's 2 survivors and wave 2's freshly spawned 6 are alive simultaneously.
        const overlapping = stepWaveDirector(state, table, 5, [2, 6], [2, 0]);
        expect(overlapping.spawns.length).toBe(0);
        expect(state.nextWaveIndex).toBe(2);
    });

    it("reports cleared once every wave has started, fully spawned, and died, and stops emitting spawns", () => {
        const table = [
            wave(4, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
            wave(6, { maxPreviousAliveFraction: 0.5, maxElapsedSeconds: 10 }),
        ];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0], [0, 0]).nextState;
        state = stepWaveDirector(state, table, 5, [2, 0], [2, 0]).nextState;

        const result = stepWaveDirector(state, table, 20, [0, 0], [4, 6]);
        expect(result.nextState.cleared).toBe(true);
        expect(result.spawns.length).toBe(0);

        const afterCleared = stepWaveDirector(result.nextState, table, 21, [0, 0], [4, 6]);
        expect(afterCleared.spawns.length).toBe(0);
        expect(afterCleared.nextState.cleared).toBe(true);
    });

    it("throttles spawns to MAX_LIVE_WAVE_ENEMIES total live enemies, finishing the rest once room frees up", () => {
        const bigCount = MAX_LIVE_WAVE_ENEMIES + 20;
        const table = [wave(bigCount, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 })];
        const state = initialWaveDirectorState(table.length);

        const first = stepWaveDirector(state, table, 0, [0], [0]);
        expect(first.spawns.length).toBe(MAX_LIVE_WAVE_ENEMIES);

        const stillFull = stepWaveDirector(first.nextState, table, 1, [MAX_LIVE_WAVE_ENEMIES], [0]);
        expect(stillFull.spawns.length).toBe(0);

        const someDied = stepWaveDirector(
            first.nextState,
            table,
            2,
            [MAX_LIVE_WAVE_ENEMIES - 5],
            [5],
        );
        expect(someDied.spawns.length).toBe(5);
    });

    it("applies a wave's health/speed modifiers to every spawn it emits", () => {
        const table: Wave[] = [
            {
                groups: [{ enemyTypeId: EnemyTypeId.TZ_KEK, count: 2 }],
                startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 },
                modifiers: { healthMultiplier: 1.15, speedMultiplier: 1.1 },
            },
        ];
        const state = initialWaveDirectorState(table.length);

        const result = stepWaveDirector(state, table, 0, [0], [0]);

        expect(result.spawns).toEqual([
            {
                waveIndex: 0,
                enemyTypeId: EnemyTypeId.TZ_KEK,
                statsOverride: { healthMultiplier: 1.15, speedMultiplier: 1.1 },
            },
            {
                waveIndex: 0,
                enemyTypeId: EnemyTypeId.TZ_KEK,
                statsOverride: { healthMultiplier: 1.15, speedMultiplier: 1.1 },
            },
        ]);
    });

    it("defaults modifiers to 1 when a wave declares none", () => {
        const table = [wave(1, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 })];
        const state = initialWaveDirectorState(table.length);

        const result = stepWaveDirector(state, table, 0, [0], [0]);

        expect(result.spawns[0].statsOverride).toEqual({ healthMultiplier: 1, speedMultiplier: 1 });
    });
});

describe("boss waves", () => {
    function bossWave(
        startCondition: WaveStartCondition = { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 },
    ): Wave {
        return {
            groups: [{ enemyTypeId: EnemyTypeId.KET_ZEK, count: 1 }],
            startCondition,
            boss: true,
        };
    }

    it("does not start until every earlier wave (not just the immediately previous one) has died down to nothing", () => {
        const table = [
            wave(4, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
            wave(6, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
            bossWave(),
        ];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0, 0], [0, 0, 0]).nextState;
        state = stepWaveDirector(state, table, 0, [4, 0, 0], [0, 0, 0]).nextState;
        expect(state.nextWaveIndex).toBe(2);

        // Wave 1 is fully alive, which alone would satisfy maxPreviousAliveFraction: 1, but wave 0
        // still has 2 survivors, so the boss must keep waiting.
        const stillBlocked = stepWaveDirector(state, table, 1, [2, 6, 0], [2, 0, 0]);
        expect(stillBlocked.nextState.nextWaveIndex).toBe(2);
        expect(stillBlocked.spawns.length).toBe(0);

        const allClear = stepWaveDirector(state, table, 1, [0, 0, 0], [4, 6, 0]);
        expect(allClear.nextState.nextWaveIndex).toBe(3);
        expect(allClear.spawns).toEqual([
            {
                waveIndex: 2,
                enemyTypeId: EnemyTypeId.KET_ZEK,
                statsOverride: { healthMultiplier: 1, speedMultiplier: 1 },
            },
        ]);
    });

    it("ignores its own startCondition, using only the all-earlier-waves-dead rule", () => {
        const table = [
            wave(4, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
            bossWave({ maxPreviousAliveFraction: 0, maxElapsedSeconds: 0 }),
        ];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0], [0, 0]).nextState;

        // If the boss's own 0-second elapsed-time fallback were honored it would start here; it
        // must still wait for wave 0 to clear instead.
        const stillAlive = stepWaveDirector(state, table, 5, [4, 0], [0, 0]);
        expect(stillAlive.spawns.length).toBe(0);

        const cleared = stepWaveDirector(state, table, 5, [0, 0], [4, 0]);
        expect(cleared.spawns.length).toBe(1);
    });

    it("blocks the next wave from starting while the boss wave is active, even though its own start condition would normally allow it immediately", () => {
        const table = [bossWave(), wave(6, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 })];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0], [0, 0]).nextState;
        expect(state.nextWaveIndex).toBe(1);

        const bossStillAlive = stepWaveDirector(state, table, 1, [1, 0], [0, 0]);
        expect(bossStillAlive.nextState.nextWaveIndex).toBe(1);
        expect(bossStillAlive.spawns.length).toBe(0);
    });

    it("lets the next wave start once the boss wave is fully cleared", () => {
        const table = [bossWave(), wave(6, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 })];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0], [0, 0]).nextState;

        const bossCleared = stepWaveDirector(state, table, 1, [0, 0], [1, 0]);
        expect(bossCleared.nextState.nextWaveIndex).toBe(2);
        expect(bossCleared.spawns.length).toBe(6);
    });

    it("never overlaps with the waves before or after it", () => {
        const table = [
            wave(4, { maxPreviousAliveFraction: 0.5, maxElapsedSeconds: 12 }),
            bossWave(),
            wave(6, { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0 }),
        ];
        let state = initialWaveDirectorState(table.length);
        state = stepWaveDirector(state, table, 0, [0, 0, 0], [0, 0, 0]).nextState;

        // Wave 0 is only half alive, which would normally be enough to overlap the next wave, but
        // that next wave is the boss, which needs wave 0 fully dead.
        const partial = stepWaveDirector(state, table, 1, [2, 0, 0], [2, 0, 0]);
        expect(partial.spawns.length).toBe(0);
        expect(partial.nextState.nextWaveIndex).toBe(1);

        const bossStarts = stepWaveDirector(state, table, 1, [0, 0, 0], [4, 0, 0]);
        expect(bossStarts.spawns.length).toBe(1);
        expect(bossStarts.nextState.nextWaveIndex).toBe(2);

        const bossActive = stepWaveDirector(bossStarts.nextState, table, 2, [0, 1, 0], [4, 0, 0]);
        expect(bossActive.spawns.length).toBe(0);
        expect(bossActive.nextState.nextWaveIndex).toBe(2);
    });
});

describe("pickFarthestSpawnPoint", () => {
    it("picks the pool point farthest from the player", () => {
        const pool = [
            { x: 0, y: 0, level: 0 },
            { x: 1000, y: 0, level: 0 },
            { x: 0, y: 500, level: 0 },
        ];

        expect(pickFarthestSpawnPoint(pool, 0, 0)).toEqual(pool[1]);
    });

    it("throws on an empty pool rather than silently returning a fallback", () => {
        expect(() => pickFarthestSpawnPoint([], 0, 0)).toThrow();
    });
});
