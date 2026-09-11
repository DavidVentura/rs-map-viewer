import { InteractType } from "../InteractType";

export type ActorInstance = {
    worldX: number;
    worldY: number;
    groundHeight: number;
    rotation: number;
    level: number;
    interactType: InteractType;
    interactId: number;
    // Local-axis tilt applied before yaw, in the same 11-bit RS rotation units as `rotation`. Only
    // arcing projectiles ever set this away from 0; every other actor renders pitch-level.
    pitch: number;
    matrixOffset: number;
    alphaOffset: number;
};

// The first texel's 4 components (worldX, worldY, groundHeight, packed level/rotation/interactId/
// interactType) already use all 32 bits of their packed component, so pitch spills into a second
// texel rather than stealing bits from an already-full field.
export const ACTOR_INSTANCE_TEXELS = 2;
export const ACTOR_INSTANCE_COMPONENTS = ACTOR_INSTANCE_TEXELS * 4;

export function encodeActorInfo(
    instance: ActorInstance,
): [number, number, number, number, number, number, number, number] {
    const packed =
        ((instance.interactId & 0xffff) << 16) |
        ((instance.rotation & 0x7ff) << 5) |
        ((instance.level & 0x3) << 3) |
        (instance.interactType & 0x7);
    return [
        instance.worldX >>> 0,
        instance.worldY >>> 0,
        instance.groundHeight >>> 0,
        packed >>> 0,
        (Math.round(instance.pitch) & 0x7ff) >>> 0,
        instance.matrixOffset >>> 0,
        instance.alphaOffset >>> 0,
        0,
    ];
}

export function decodeActorInfo(
    r: number,
    g: number,
    b: number,
    a: number,
    pitchR: number,
    matrixOffset: number,
    alphaOffset: number,
): ActorInstance {
    return {
        worldX: r >>> 0,
        worldY: g >>> 0,
        groundHeight: b | 0,
        interactType: (a & 0x7) as InteractType,
        level: (a >> 3) & 0x3,
        rotation: (a >> 5) & 0x7ff,
        interactId: a >>> 16,
        pitch: pitchR & 0x7ff,
        matrixOffset: matrixOffset >>> 0,
        alphaOffset: alphaOffset >>> 0,
    };
}

export function writeActorInstance(
    data: Uint32Array,
    instanceIndex: number,
    instance: ActorInstance,
): void {
    const offset = instanceIndex * ACTOR_INSTANCE_COMPONENTS;
    const encoded = encodeActorInfo(instance);
    for (let i = 0; i < encoded.length; i++) {
        data[offset + i] = encoded[i];
    }
}
