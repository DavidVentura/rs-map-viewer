import { PhaseId } from "./Phase";

declare const interactionIdBrand: unique symbol;

export type InteractionId = string & { readonly [interactionIdBrand]: true };

export type WorldPosition = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type InteractionPose = {
    readonly position: WorldPosition;
    readonly facingRadians: number;
};

export type AuthoredLocationTarget = {
    readonly kind: "AUTHORED_LOCATION";
    readonly label: string;
    readonly poses: readonly [InteractionPose, ...InteractionPose[]];
};

export type InteractionTarget = AuthoredLocationTarget;

export type WorldAction =
    | { readonly kind: "START_PHASE"; readonly phaseId: PhaseId }
    | { readonly kind: "ACTIVATE_PHASE_REWARDS"; readonly phaseId: PhaseId };

export type Interaction = {
    readonly id: InteractionId;
    readonly target: InteractionTarget;
    readonly action: WorldAction;
    readonly animationSeqId: number;
    readonly durationSeconds: number;
};

export type IdleInteractionState = {
    readonly kind: "IDLE";
};

export type ApproachingInteractionState = {
    readonly kind: "APPROACHING";
    readonly interaction: Interaction;
    readonly pose: InteractionPose;
};

export type ExecutingInteractionState = {
    readonly kind: "EXECUTING";
    readonly interaction: Interaction;
    readonly pose: InteractionPose;
    readonly completesAtSeconds: number;
};

export type InteractionState =
    | IdleInteractionState
    | ApproachingInteractionState
    | ExecutingInteractionState;

export type CompletedInteraction = {
    readonly state: IdleInteractionState;
    readonly action: WorldAction;
};

export const IDLE_INTERACTION: IdleInteractionState = { kind: "IDLE" };

function nonEmptyPoses(
    poses: readonly InteractionPose[],
): readonly [InteractionPose, ...InteractionPose[]] {
    if (poses.length === 0) {
        throw new RangeError("An authored location target requires at least one pose");
    }
    return [poses[0], ...poses.slice(1)];
}

export function createInteractionId(value: string): InteractionId {
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
        throw new TypeError(`Invalid interaction id: ${value}`);
    }
    return value as InteractionId;
}

export function createWorldPosition(x: number, y: number, level: number): WorldPosition {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(level)) {
        throw new TypeError(
            "Interaction positions require finite coordinates and an integer level",
        );
    }
    return { x, y, level };
}

export function createInteractionPose(
    position: WorldPosition,
    facingRadians: number,
): InteractionPose {
    if (!Number.isFinite(facingRadians)) {
        throw new TypeError("An interaction pose requires a finite facing angle");
    }
    return { position, facingRadians };
}

export function createAuthoredLocationTarget(
    label: string,
    poses: readonly InteractionPose[],
): AuthoredLocationTarget {
    if (label.trim().length === 0) {
        throw new TypeError("An authored location target requires a label");
    }
    return {
        kind: "AUTHORED_LOCATION",
        label,
        poses: nonEmptyPoses(poses),
    };
}

export function createInteraction(
    id: InteractionId,
    target: InteractionTarget,
    action: WorldAction,
    animationSeqId: number,
    durationSeconds: number,
): Interaction {
    if (!Number.isInteger(animationSeqId) || animationSeqId < 0) {
        throw new RangeError("An interaction animation sequence id must be a non-negative integer");
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new RangeError("An interaction duration must be positive and finite");
    }
    return { id, target, action, animationSeqId, durationSeconds };
}

function squaredDistance(a: WorldPosition, b: WorldPosition): number {
    const x = a.x - b.x;
    const y = a.y - b.y;
    return x * x + y * y;
}

export function selectApproachPose(
    target: InteractionTarget,
    playerPosition: WorldPosition,
): InteractionPose {
    const sameLevelPoses = target.poses.filter(
        (pose) => pose.position.level === playerPosition.level,
    );
    if (sameLevelPoses.length === 0) {
        throw new RangeError("An interaction has no approach pose on the player's level");
    }
    return sameLevelPoses.reduce((nearest, candidate) =>
        squaredDistance(candidate.position, playerPosition) <
        squaredDistance(nearest.position, playerPosition)
            ? candidate
            : nearest,
    );
}

export function beginInteraction(
    state: InteractionState,
    interaction: Interaction,
    playerPosition: WorldPosition,
): ApproachingInteractionState {
    if (state.kind !== "IDLE") {
        throw new Error(`Cannot begin an interaction while ${state.kind}`);
    }
    return {
        kind: "APPROACHING",
        interaction,
        pose: selectApproachPose(interaction.target, playerPosition),
    };
}

export function beginExecution(
    state: InteractionState,
    playerPosition: WorldPosition,
    nowSeconds: number,
): ExecutingInteractionState {
    if (state.kind !== "APPROACHING") {
        throw new Error(`Cannot execute an interaction while ${state.kind}`);
    }
    if (
        state.pose.position.x !== playerPosition.x ||
        state.pose.position.y !== playerPosition.y ||
        state.pose.position.level !== playerPosition.level
    ) {
        throw new RangeError(
            "The player must reach the selected interaction pose before executing",
        );
    }
    if (!Number.isFinite(nowSeconds)) {
        throw new TypeError("Interaction execution time must be finite");
    }
    return {
        kind: "EXECUTING",
        interaction: state.interaction,
        pose: state.pose,
        completesAtSeconds: nowSeconds + state.interaction.durationSeconds,
    };
}

export function cancelInteraction(state: InteractionState): IdleInteractionState {
    if (state.kind === "IDLE") {
        throw new Error("Cannot cancel an idle interaction");
    }
    return IDLE_INTERACTION;
}

export function completeInteraction(
    state: InteractionState,
    nowSeconds: number,
): CompletedInteraction {
    if (state.kind !== "EXECUTING") {
        throw new Error(`Cannot complete an interaction while ${state.kind}`);
    }
    if (!Number.isFinite(nowSeconds)) {
        throw new TypeError("Interaction completion time must be finite");
    }
    if (nowSeconds < state.completesAtSeconds) {
        throw new RangeError("An interaction cannot complete before its duration elapses");
    }
    return { state: IDLE_INTERACTION, action: state.interaction.action };
}
