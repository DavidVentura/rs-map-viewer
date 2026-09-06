import PicoGL, {
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { DrawRange, newDrawRange } from "../DrawRange";
import { DrawCallRange } from "../WebGLMapSquare";
import { ActorBufferData } from "../loader/ActorBufferData";
import { ActorRenderData } from "./ActorRenderData";

export class WebGLActorBuffer {
    static load(
        app: PicoApp,
        actorProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        data: ActorBufferData,
        capacity: number,
        time: number,
    ): WebGLActorBuffer {
        const interleavedBuffer = app.createInterleavedBuffer(12, data.vertices);
        const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, data.indices);

        const vertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(0, interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(indexBuffer);

        const drawRanges: DrawRange[] = Array.from({ length: capacity }, () =>
            newDrawRange(0, 0, 1),
        );

        const drawCall = app
            .createDrawCall(actorProgram, vertexArray)
            .uniformBlock("SceneUniforms", sceneUniformBuffer)
            .uniform("u_timeLoaded", time)
            .texture("u_textures", textureArray)
            .texture("u_textureMaterials", textureMaterials)
            .drawRanges(...drawRanges);

        return new WebGLActorBuffer(
            data.cacheName,
            data.encounterId,
            data.actorData,
            interleavedBuffer,
            indexBuffer,
            vertexArray,
            { drawCall, drawRanges },
            capacity,
        );
    }

    constructor(
        readonly cacheName: string,
        readonly encounterId: string,
        readonly actorData: ActorRenderData,

        readonly interleavedBuffer: VertexBuffer,
        readonly indexBuffer: VertexBuffer,
        readonly vertexArray: VertexArray,

        readonly drawCall: DrawCallRange,
        readonly capacity: number,
    ) {}

    delete(): void {
        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();
    }
}
