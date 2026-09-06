import { EnemySpawnPoint, Wave } from "./Encounter";
import { EnemyStatsOverride, EnemyTypeId } from "./EnemyType";

export const MAX_LIVE_WAVE_ENEMIES = 150;

export type WaveDirectorState = {
    readonly nextWaveIndex: number;
    readonly waveStartedAtSeconds: readonly (number | undefined)[];
    readonly cleared: boolean;
};

export type WaveSpawn = {
    readonly waveIndex: number;
    readonly enemyTypeId: EnemyTypeId;
    readonly statsOverride: EnemyStatsOverride;
};

export type WaveDirectorResult = {
    readonly nextState: WaveDirectorState;
    readonly spawns: readonly WaveSpawn[];
};

export function initialWaveDirectorState(waveCount: number): WaveDirectorState {
    return {
        nextWaveIndex: 0,
        waveStartedAtSeconds: new Array(waveCount).fill(undefined),
        cleared: false,
    };
}

export function totalGroupCount(wave: Wave): number {
    return wave.groups.reduce((sum, group) => sum + group.count, 0);
}

function flattenSpawnPlan(wave: Wave): readonly EnemyTypeId[] {
    return wave.groups.flatMap((group) => new Array(group.count).fill(group.enemyTypeId));
}

function resolveModifiers(wave: Wave): EnemyStatsOverride {
    return {
        healthMultiplier: wave.modifiers?.healthMultiplier ?? 1,
        speedMultiplier: wave.modifiers?.speedMultiplier ?? 1,
    };
}

function shouldStartWave(
    table: readonly Wave[],
    waveIndex: number,
    timeSeconds: number,
    waveStartedAtSeconds: readonly (number | undefined)[],
    aliveByWave: readonly number[],
): boolean {
    if (waveIndex === 0) {
        return true;
    }
    const previousStartedAt = waveStartedAtSeconds[waveIndex - 1];
    if (previousStartedAt === undefined) {
        return false;
    }
    const previousTotal = totalGroupCount(table[waveIndex - 1]);
    const previousAliveFraction =
        previousTotal === 0 ? 0 : (aliveByWave[waveIndex - 1] ?? 0) / previousTotal;
    const elapsedSeconds = timeSeconds - previousStartedAt;
    const condition = table[waveIndex].startCondition;
    return (
        previousAliveFraction <= condition.maxPreviousAliveFraction ||
        elapsedSeconds >= condition.maxElapsedSeconds
    );
}

// Pure step of the wave director: given how many of each wave's enemies are currently alive and
// how many have died so far, decide whether the next wave should start and which enemies to spawn
// this step. Spawning a wave is throttled by MAX_LIVE_WAVE_ENEMIES rather than done all at once, so
// a wave capped out this step simply finishes spawning on a later one once room frees up.
export function stepWaveDirector(
    state: WaveDirectorState,
    table: readonly Wave[],
    timeSeconds: number,
    aliveByWave: readonly number[],
    killsByWave: readonly number[],
): WaveDirectorResult {
    if (state.cleared) {
        return { nextState: state, spawns: [] };
    }

    const spawnedSoFarByWave = table.map(
        (_, index) => (aliveByWave[index] ?? 0) + (killsByWave[index] ?? 0),
    );

    let nextWaveIndex = state.nextWaveIndex;
    let waveStartedAtSeconds = state.waveStartedAtSeconds;
    if (
        nextWaveIndex < table.length &&
        shouldStartWave(table, nextWaveIndex, timeSeconds, waveStartedAtSeconds, aliveByWave)
    ) {
        waveStartedAtSeconds = waveStartedAtSeconds.map((startedAt, index) =>
            index === nextWaveIndex ? timeSeconds : startedAt,
        );
        nextWaveIndex += 1;
    }

    const totalAlive = aliveByWave.reduce((sum, count) => sum + count, 0);
    let remainingRoom = MAX_LIVE_WAVE_ENEMIES - totalAlive;
    const spawns: WaveSpawn[] = [];
    for (let waveIndex = 0; waveIndex < table.length && remainingRoom > 0; waveIndex++) {
        if (waveStartedAtSeconds[waveIndex] === undefined) {
            continue;
        }
        const wave = table[waveIndex];
        const plan = flattenSpawnPlan(wave);
        const alreadySpawned = spawnedSoFarByWave[waveIndex];
        const statsOverride = resolveModifiers(wave);
        for (let planIndex = alreadySpawned; planIndex < plan.length; planIndex++) {
            if (remainingRoom <= 0) {
                break;
            }
            spawns.push({ waveIndex, enemyTypeId: plan[planIndex], statsOverride });
            remainingRoom--;
        }
    }

    const allWavesStarted = nextWaveIndex >= table.length;
    const allWavesCleared =
        allWavesStarted &&
        spawns.length === 0 &&
        table.every(
            (wave, index) =>
                (aliveByWave[index] ?? 0) === 0 &&
                spawnedSoFarByWave[index] >= totalGroupCount(wave),
        );

    return {
        nextState: { nextWaveIndex, waveStartedAtSeconds, cleared: allWavesCleared },
        spawns,
    };
}

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

// Farthest-from-player point in the encounter's spawn pool, so newly spawned enemies don't pop in
// on top of the player. Deterministic tie-break on pool order for pure/testable behavior.
export function pickFarthestSpawnPoint(
    pool: readonly EnemySpawnPoint[],
    playerX: number,
    playerY: number,
): EnemySpawnPoint {
    if (pool.length === 0) {
        throw new Error("Cannot pick a spawn point from an empty pool");
    }
    let farthest = pool[0];
    let farthestDistanceSquared = distanceSquared(farthest.x, farthest.y, playerX, playerY);
    for (let i = 1; i < pool.length; i++) {
        const candidate = pool[i];
        const candidateDistanceSquared = distanceSquared(
            candidate.x,
            candidate.y,
            playerX,
            playerY,
        );
        if (candidateDistanceSquared > farthestDistanceSquared) {
            farthest = candidate;
            farthestDistanceSquared = candidateDistanceSquared;
        }
    }
    return farthest;
}
