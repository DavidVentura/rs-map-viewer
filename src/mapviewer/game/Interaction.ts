import { PhaseId } from "./Phase";
import { TILE_SIZE } from "./Terrain";
import { directionToRotation } from "./projectileMath";

declare const interactionIdBrand: unique symbol;

export type InteractionId = string & { readonly [interactionIdBrand]: true };

export type WorldPosition = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type InteractionPose = {
    readonly position: WorldPosition;
    // Client rotation units, the same convention as Player.rotation.
    readonly facingRotation: number;
};

declare const worldObjectIdBrand: unique symbol;

// Small and numeric (rather than a string brand like every other id here) because it doubles as
// the actor buffer's packed interactId (see ActorInstanceData.encodeActorInfo): one lever and one
// chest per encounter never come close to that field's range.
export type WorldObjectId = number & { readonly [worldObjectIdBrand]: true };

export enum WorldObjectKind {
    LEVER = "LEVER",
    CHEST = "CHEST",
}

// A quarter turn in the client's rotation space (see projectileMath.directionToRotation): the same
// units LocModelLoader.getRestModel takes and ActorInstance.rotation renders with.
export type ObjectOrientation = 0 | 1 | 2 | 3;

// A real OSRS loc standing in the world (a lever, a chest): baked into the actor buffer as a
// skinned rest mesh (see assets/ActorAssets.ts) and driven entirely by its position/orientation,
// never a fake per-interaction pose.
export type WorldObject = {
    readonly id: WorldObjectId;
    readonly kind: WorldObjectKind;
    readonly position: WorldPosition;
    readonly orientation: ObjectOrientation;
};

const ORIENTATION_ROTATION_UNITS: Readonly<Record<ObjectOrientation, number>> = {
    0: 0,
    1: 512,
    2: 1024,
    3: 1536,
};

// The tile one step in front of the object, in the direction its orientation faces.
const ORIENTATION_TILE_OFFSET: Readonly<Record<ObjectOrientation, { dx: number; dy: number }>> = {
    0: { dx: 0, dy: 1 },
    1: { dx: 1, dy: 0 },
    2: { dx: 0, dy: -1 },
    3: { dx: -1, dy: 0 },
};

// The client rotation the object itself renders at (see ActorInstance.rotation).
export function worldObjectRotationUnits(object: WorldObject): number {
    return ORIENTATION_ROTATION_UNITS[object.orientation];
}

// Where the player stands and which way they face to operate this object: one tile in front of
// it, looking at it. An object's orientation is authored to face the tile the player approaches
// from. The facing comes from the direction to the object because a loc's orientation units and
// an actor's rotation units don't share a zero.
export function worldObjectApproachPose(object: WorldObject): InteractionPose {
    const offset = ORIENTATION_TILE_OFFSET[object.orientation];
    return {
        position: {
            x: object.position.x + offset.dx * TILE_SIZE,
            y: object.position.y + offset.dy * TILE_SIZE,
            level: object.position.level,
        },
        facingRotation: directionToRotation(-offset.dx, -offset.dy),
    };
}

// Starts at 1 because the actor shader's highlight uniform uses 0 for "nothing highlighted".
export function createWorldObjectId(value: number): WorldObjectId {
    if (!Number.isInteger(value) || value < 1) {
        throw new TypeError(`Invalid world object id: ${value}`);
    }
    return value as WorldObjectId;
}

export function createWorldObject(
    id: WorldObjectId,
    kind: WorldObjectKind,
    position: WorldPosition,
    orientation: ObjectOrientation,
): WorldObject {
    return { id, kind, position, orientation };
}

export type WorldAction =
    | { readonly kind: "START_PHASE"; readonly phaseId: PhaseId }
    | { readonly kind: "ACTIVATE_PHASE_REWARDS"; readonly phaseId: PhaseId };

// An interaction operates a shared WorldObject rather than owning its own position: several
// interactions (one per phase) can and do target the same lever or chest.
export type Interaction = {
    readonly id: InteractionId;
    readonly objectId: WorldObjectId;
    // A short OSRS-style action label shown on hover, e.g. "Pull Lever" / "Open Chest".
    readonly label: string;
    readonly action: WorldAction;
    readonly animationSeqId: number;
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

export function createInteraction(
    id: InteractionId,
    objectId: WorldObjectId,
    label: string,
    action: WorldAction,
    animationSeqId: number,
): Interaction {
    if (label.trim().length === 0) {
        throw new TypeError("An interaction requires a label");
    }
    if (!Number.isInteger(animationSeqId) || animationSeqId < 0) {
        throw new RangeError("An interaction animation sequence id must be a non-negative integer");
    }
    return { id, objectId, label, action, animationSeqId };
}

export function beginInteraction(
    state: InteractionState,
    interaction: Interaction,
    approachPose: InteractionPose,
): ApproachingInteractionState {
    if (state.kind !== "IDLE") {
        throw new Error(`Cannot begin an interaction while ${state.kind}`);
    }
    return { kind: "APPROACHING", interaction, pose: approachPose };
}

export function beginExecution(
    state: InteractionState,
    playerPosition: WorldPosition,
    nowSeconds: number,
    durationSeconds: number,
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
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new RangeError("An interaction duration must be positive and finite");
    }
    return {
        kind: "EXECUTING",
        interaction: state.interaction,
        pose: state.pose,
        completesAtSeconds: nowSeconds + durationSeconds,
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

export enum WorldObjectVariant {
    REST = "REST",
    ACTIVATED = "ACTIVATED",
}

export type WorldObjectVisual = {
    readonly object: WorldObject;
    readonly visible: boolean;
    readonly variant: WorldObjectVariant;
};

function isExecutingObject(interactionState: InteractionState, objectId: WorldObjectId): boolean {
    return (
        interactionState.kind === "EXECUTING" && interactionState.interaction.objectId === objectId
    );
}

// The lever is always up except for the moment its pull animation plays. The chest stays closed
// until it is actually opened (its interaction's execution completes), and stays open for the rest
// of its reward's granting so it doesn't flicker shut mid-claim.
export function worldObjectVariant(
    object: WorldObject,
    interactionState: InteractionState,
    rewardsBeingClaimed: boolean,
): WorldObjectVariant {
    if (object.kind === WorldObjectKind.LEVER) {
        return isExecutingObject(interactionState, object.id)
            ? WorldObjectVariant.ACTIVATED
            : WorldObjectVariant.REST;
    }
    return isExecutingObject(interactionState, object.id) || rewardsBeingClaimed
        ? WorldObjectVariant.ACTIVATED
        : WorldObjectVariant.REST;
}

// The lever is always in the world. The chest only appears while its phase's reward interaction is
// active (waiting to be claimed) or in the middle of being claimed - it disappears again once the
// phase moves on.
export function isWorldObjectVisible(
    object: WorldObject,
    activeInteractions: readonly Interaction[],
    interactionState: InteractionState,
    rewardsBeingClaimed: boolean,
): boolean {
    if (object.kind === WorldObjectKind.LEVER) {
        return true;
    }
    if (rewardsBeingClaimed || isExecutingObject(interactionState, object.id)) {
        return true;
    }
    if (
        interactionState.kind === "APPROACHING" &&
        interactionState.interaction.objectId === object.id
    ) {
        return true;
    }
    return activeInteractions.some(
        (interaction) =>
            interaction.objectId === object.id &&
            interaction.action.kind === "ACTIVATE_PHASE_REWARDS",
    );
}
