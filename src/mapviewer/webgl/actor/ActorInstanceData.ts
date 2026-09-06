import { InteractType } from "../InteractType";

export type ActorInstance = {
    worldX: number;
    worldY: number;
    groundHeight: number;
    rotation: number;
    level: number;
    interactType: InteractType;
    interactId: number;
};

export const ACTOR_INSTANCE_TEXELS = 1;
export const ACTOR_INSTANCE_COMPONENTS = 4;

export function encodeActorInfo(instance: ActorInstance): [number, number, number, number] {
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
    ];
}

export function decodeActorInfo(r: number, g: number, b: number, a: number): ActorInstance {
    return {
        worldX: r >>> 0,
        worldY: g >>> 0,
        groundHeight: b | 0,
        interactType: (a & 0x7) as InteractType,
        level: (a >> 3) & 0x3,
        rotation: (a >> 5) & 0x7ff,
        interactId: a >>> 16,
    };
}

export function writeActorInstance(
    data: Uint32Array,
    instanceIndex: number,
    instance: ActorInstance,
): void {
    const offset = instanceIndex * ACTOR_INSTANCE_COMPONENTS;
    const [r, g, b, a] = encodeActorInfo(instance);
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = a;
}
