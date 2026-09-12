import { InteractionId } from "../game/Interaction";

export type InteractionScreenCandidate = {
    readonly interactionId: InteractionId;
    readonly x: number;
    readonly y: number;
};

export function pickInteractionNear(
    point: { readonly x: number; readonly y: number },
    candidates: readonly InteractionScreenCandidate[],
    radius: number,
): InteractionId | undefined {
    const radiusSquared = radius * radius;
    let nearest:
        | { readonly interactionId: InteractionId; readonly distanceSquared: number }
        | undefined;
    for (const candidate of candidates) {
        const x = candidate.x - point.x;
        const y = candidate.y - point.y;
        const distanceSquared = x * x + y * y;
        if (distanceSquared > radiusSquared) {
            continue;
        }
        if (!nearest || distanceSquared < nearest.distanceSquared) {
            nearest = { interactionId: candidate.interactionId, distanceSquared };
        }
    }
    return nearest?.interactionId;
}
