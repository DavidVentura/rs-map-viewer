import { Wave } from "./Encounter";
import { Reward, createRewards } from "./Reward";

declare const phaseIdBrand: unique symbol;

export type PhaseId = string & { readonly [phaseIdBrand]: true };

export type PhaseCompletion = {
    readonly kind: "ALL_WAVES_CLEARED";
};

export type Phase = {
    readonly id: PhaseId;
    readonly label: string;
    readonly waves: readonly Wave[];
    readonly completion: PhaseCompletion;
    readonly rewards: readonly Reward[];
};

type InProgressPhaseLifecycle = {
    readonly phases: readonly [Phase, ...Phase[]];
    readonly phaseIndex: number;
};

export type ReadyPhaseLifecycle = InProgressPhaseLifecycle & {
    readonly kind: "READY";
};

export type ActivePhaseLifecycle = InProgressPhaseLifecycle & {
    readonly kind: "ACTIVE";
};

export type RewardsPhaseLifecycle = InProgressPhaseLifecycle & {
    readonly kind: "REWARDS";
};

export type CompletePhaseLifecycle = InProgressPhaseLifecycle & {
    readonly kind: "COMPLETE";
};

export type PhaseLifecycle =
    | ReadyPhaseLifecycle
    | ActivePhaseLifecycle
    | RewardsPhaseLifecycle
    | CompletePhaseLifecycle;

export type PhaseTransition =
    | { readonly kind: "START_PHASE" }
    | { readonly kind: "PHASE_CLEARED" }
    | { readonly kind: "REWARDS_CLAIMED" };

export function createPhaseId(value: string): PhaseId {
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
        throw new TypeError(`Invalid phase id: ${value}`);
    }
    return value as PhaseId;
}

export function createPhase(
    id: PhaseId,
    label: string,
    waves: readonly Wave[],
    completion: PhaseCompletion,
    rewards: readonly Reward[],
): Phase {
    if (label.trim().length === 0) {
        throw new TypeError("A phase label cannot be empty");
    }
    if (waves.length === 0) {
        throw new RangeError("A phase requires at least one wave");
    }
    return { id, label, waves: [...waves], completion, rewards: createRewards(rewards) };
}

function nonEmptyPhases(phases: readonly Phase[]): readonly [Phase, ...Phase[]] {
    if (phases.length === 0) {
        throw new RangeError("A phase lifecycle requires at least one phase");
    }
    if (new Set(phases.map((phase) => phase.id)).size !== phases.length) {
        throw new RangeError("A phase lifecycle cannot contain duplicate phase ids");
    }
    return [phases[0], ...phases.slice(1)];
}

export function initialPhaseLifecycle(phases: readonly Phase[]): ReadyPhaseLifecycle {
    return { kind: "READY", phases: nonEmptyPhases(phases), phaseIndex: 0 };
}

export function currentPhase(lifecycle: PhaseLifecycle): Phase {
    return lifecycle.phases[lifecycle.phaseIndex];
}

function advancePhase(lifecycle: ActivePhaseLifecycle | RewardsPhaseLifecycle): PhaseLifecycle {
    const nextPhaseIndex = lifecycle.phaseIndex + 1;
    if (nextPhaseIndex === lifecycle.phases.length) {
        return { kind: "COMPLETE", phases: lifecycle.phases, phaseIndex: lifecycle.phaseIndex };
    }
    return { kind: "READY", phases: lifecycle.phases, phaseIndex: nextPhaseIndex };
}

export function transitionPhase(
    lifecycle: PhaseLifecycle,
    transition: PhaseTransition,
): PhaseLifecycle {
    switch (transition.kind) {
        case "START_PHASE":
            if (lifecycle.kind !== "READY") {
                throw new Error(`Cannot start a phase while it is ${lifecycle.kind}`);
            }
            return {
                kind: "ACTIVE",
                phases: lifecycle.phases,
                phaseIndex: lifecycle.phaseIndex,
            };
        case "PHASE_CLEARED":
            if (lifecycle.kind !== "ACTIVE") {
                throw new Error(`Cannot clear a phase while it is ${lifecycle.kind}`);
            }
            return currentPhase(lifecycle).rewards.length === 0
                ? advancePhase(lifecycle)
                : {
                      kind: "REWARDS",
                      phases: lifecycle.phases,
                      phaseIndex: lifecycle.phaseIndex,
                  };
        case "REWARDS_CLAIMED":
            if (lifecycle.kind !== "REWARDS") {
                throw new Error(`Cannot claim rewards while a phase is ${lifecycle.kind}`);
            }
            return advancePhase(lifecycle);
    }
}
