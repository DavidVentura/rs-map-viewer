import { InteractType } from "../InteractType";
import {
    ACTOR_INSTANCE_COMPONENTS,
    ActorInstance,
    decodeActorInfo,
    encodeActorInfo,
    writeActorInstance,
} from "./ActorInstanceData";

describe("actor instance encoding", () => {
    it("round-trips a typical enemy instance", () => {
        const instance: ActorInstance = {
            worldX: 414336,
            worldY: 413056,
            groundHeight: -1024,
            rotation: 1536,
            level: 2,
            interactType: InteractType.ENEMY,
            interactId: 4242,
            pitch: 0,
        };
        const [r, g, b, a, pitchR] = encodeActorInfo(instance);
        expect(decodeActorInfo(r, g, b, a, pitchR)).toEqual(instance);
    });

    it("round-trips zero and max field values", () => {
        const instance: ActorInstance = {
            worldX: 0,
            worldY: 0,
            groundHeight: 0,
            rotation: 0,
            level: 0,
            interactType: InteractType.NONE,
            interactId: 0,
            pitch: 0,
        };
        const [r, g, b, a, pitchR] = encodeActorInfo(instance);
        expect(decodeActorInfo(r, g, b, a, pitchR)).toEqual(instance);

        const maxInstance: ActorInstance = {
            worldX: 0x7fffffff,
            worldY: 0xffffffff,
            groundHeight: 2147483647,
            rotation: 2047,
            level: 3,
            interactType: InteractType.ENEMY,
            interactId: 65535,
            pitch: 2047,
        };
        const [r2, g2, b2, a2, pitchR2] = encodeActorInfo(maxInstance);
        expect(decodeActorInfo(r2, g2, b2, a2, pitchR2)).toEqual(maxInstance);
    });

    it("round-trips a negative ground height", () => {
        const instance: ActorInstance = {
            worldX: 100,
            worldY: 200,
            groundHeight: -2147483648,
            rotation: 512,
            level: 1,
            interactType: InteractType.LOC,
            interactId: 12,
            pitch: 0,
        };
        const [r, g, b, a, pitchR] = encodeActorInfo(instance);
        expect(decodeActorInfo(r, g, b, a, pitchR)).toEqual(instance);
    });

    it("wraps a pitch already outside the 11-bit range rather than throwing", () => {
        const instance: ActorInstance = {
            worldX: 0,
            worldY: 0,
            groundHeight: 0,
            rotation: 0,
            level: 0,
            interactType: InteractType.NONE,
            interactId: 0,
            pitch: -300,
        };
        const [r, g, b, a, pitchR] = encodeActorInfo(instance);
        expect(decodeActorInfo(r, g, b, a, pitchR).pitch).toBe(2048 - 300);
    });

    it("writeActorInstance writes at the correct offset into a shared buffer", () => {
        const data = new Uint32Array(ACTOR_INSTANCE_COMPONENTS * 3);
        const instance: ActorInstance = {
            worldX: 10,
            worldY: 20,
            groundHeight: -5,
            rotation: 100,
            level: 1,
            interactType: InteractType.NPC,
            interactId: 7,
            pitch: 42,
        };
        writeActorInstance(data, 1, instance);
        expect(data.slice(0, ACTOR_INSTANCE_COMPONENTS)).toEqual(
            new Uint32Array(ACTOR_INSTANCE_COMPONENTS),
        );
        const texel = data.slice(ACTOR_INSTANCE_COMPONENTS, ACTOR_INSTANCE_COMPONENTS * 2);
        expect(decodeActorInfo(texel[0], texel[1], texel[2], texel[3], texel[4])).toEqual(instance);
        expect(data.slice(ACTOR_INSTANCE_COMPONENTS * 2)).toEqual(
            new Uint32Array(ACTOR_INSTANCE_COMPONENTS),
        );
    });
});
