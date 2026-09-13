import { actorAssets } from "../assets/ActorAssets";
import { resolveEncounterAnimations } from "../assets/encounterAnimations";
import { SeqTiming } from "./Animation";
import { EncounterId, getEncounter } from "./Encounter";
import { EncounterAnimations } from "./EncounterAnimations";
import { getEnemyType, resolveEnemyType } from "./EnemyType";
import { SeqCatalog } from "./SeqCatalog";

export const STUB_FRAME_COUNT = 20;
export const STUB_TICKS_PER_FRAME = 4;
export const STUB_FRAME_SECONDS = STUB_TICKS_PER_FRAME * 0.02;

// Wardens P3 lands its slams deep into its sequences, past STUB_FRAME_COUNT.
export const WARDENS_STUB_FRAME_COUNT = 160;

export function stubSeqTiming(seqId: number, frameCount: number = STUB_FRAME_COUNT): SeqTiming {
    return { seqId, frameTicks: new Array<number>(frameCount).fill(STUB_TICKS_PER_FRAME) };
}

// Test stand-in for the encounter's seq catalog: every sequence id has frameCount frames of
// STUB_TICKS_PER_FRAME ticks each, so a contact frame N resolves at N * STUB_FRAME_SECONDS at
// castSpeed 1 and every sequence lasts frameCount * STUB_FRAME_SECONDS.
export function stubSeqCatalog(frameCount: number = STUB_FRAME_COUNT): SeqCatalog {
    return { get: (seqId) => stubSeqTiming(seqId, frameCount) };
}

// The real composition over the stub catalog, answering any enemy type or interaction so one set
// of animations serves every encounter a test starts.
export function stubEncounterAnimations(): EncounterAnimations {
    const catalog = stubSeqCatalog();
    const encounter = getEncounter(EncounterId.FIGHT_CAVES);
    const wardens = getEncounter(EncounterId.WARDENS_P3);
    return {
        ...resolveEncounterAnimations(encounter, actorAssets(encounter), catalog),
        enemyType: (id) => resolveEnemyType(getEnemyType(id), catalog),
        interactionSeq: () => stubSeqTiming(0),
        wardenP3: resolveEncounterAnimations(
            wardens,
            actorAssets(wardens),
            stubSeqCatalog(WARDENS_STUB_FRAME_COUNT),
        ).wardenP3,
    };
}
