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
import { SKINNED_VERTEX_STRIDE, SkinTables, createSkinnedVertexArray } from "../skin/SkinGpu";
import { ActorRenderData } from "./ActorRenderData";

export class WebGLActorBuffer {
    static create(
        app: PicoApp,
        actorProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        data: ActorBufferData,
        capacity: number,
        time: number,
    ): WebGLActorBuffer {
        const { skinned } = data;
        const interleavedBuffer = app.createInterleavedBuffer(
            SKINNED_VERTEX_STRIDE,
            skinned.vertices,
        );
        const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, skinned.indices);

        const vertexArray = createSkinnedVertexArray(app, interleavedBuffer, indexBuffer);
        const skinTables = SkinTables.create(app, skinned.influences, skinned.matrixTable);

        const drawRanges: DrawRange[] = Array.from({ length: capacity }, () =>
            newDrawRange(0, 0, 1),
        );

        const drawCall = skinTables
            .bind(app.createDrawCall(actorProgram, vertexArray))
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
            skinTables,
            { drawCall, drawRanges },
            capacity,
        );
    }

    private constructor(
        readonly cacheName: string,
        readonly encounterId: string,
        readonly actorData: ActorRenderData,

        readonly interleavedBuffer: VertexBuffer,
        readonly indexBuffer: VertexBuffer,
        readonly vertexArray: VertexArray,
        private readonly skinTables: SkinTables,

        readonly drawCall: DrawCallRange,
        public capacity: number,
    ) {}

    // Grows the instance draw-range arrays in place so more actors than the encounter's initial
    // spawn count can be rendered (waves ramp well past that). The underlying mesh/vertex data is
    // unaffected; only the per-instance draw range bookkeeping is resized.
    growCapacity(minimumCapacity: number): void {
        if (minimumCapacity <= this.capacity) {
            return;
        }
        const drawRanges: DrawRange[] = Array.from({ length: minimumCapacity }, () =>
            newDrawRange(0, 0, 1),
        );
        this.drawCall.drawCall.drawRanges(...drawRanges);
        this.drawCall.drawRanges = drawRanges;
        this.capacity = minimumCapacity;
    }

    delete(): void {
        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();
        this.skinTables.delete();
    }
}
