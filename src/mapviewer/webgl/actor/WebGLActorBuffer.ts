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
    // Fed to bufferSubData one slice per frame (see uploadNextChunk) so a multi-megabyte actor
    // buffer never blocks the main thread for more than a few milliseconds at a time.
    static readonly UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

    // Allocates the GPU buffers and vertex array/draw call up front (cheap: no data copy yet) but
    // leaves the actual vertex/index bytes zero-filled. Callers must drive uploadNextChunk() every
    // frame until isFullyUploaded is true before treating this buffer as renderable.
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
        const interleavedBuffer = app.createInterleavedBuffer(
            SKINNED_VERTEX_STRIDE,
            data.vertices.byteLength,
        );
        // picogl's own type declarations only accept an ArrayBufferView here, but the
        // implementation also accepts an element count to allocate an empty (zero-filled) buffer
        // without copying any data - the fast path uploadNextChunk then fills incrementally.
        const indexBuffer = (app.createIndexBuffer as any)(
            PicoGL.UNSIGNED_INT,
            3,
            data.indices.length,
        );

        const vertexArray = createSkinnedVertexArray(app, interleavedBuffer, indexBuffer);
        const skinTables = SkinTables.create(app, data.influences, data.matrixTable);

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
            new Uint8Array(
                data.vertices.buffer,
                data.vertices.byteOffset,
                data.vertices.byteLength,
            ),
            new Uint8Array(data.indices.buffer, data.indices.byteOffset, data.indices.byteLength),
        );
    }

    private uploadedVertexBytes: number = 0;
    private uploadedIndexBytes: number = 0;

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

        private readonly pendingVertexBytes: Uint8Array,
        private readonly pendingIndexBytes: Uint8Array,
    ) {}

    get isFullyUploaded(): boolean {
        return (
            this.uploadedVertexBytes >= this.pendingVertexBytes.byteLength &&
            this.uploadedIndexBytes >= this.pendingIndexBytes.byteLength
        );
    }

    // Uploads up to maxBytes of whichever buffer still has data pending, vertices before indices.
    // Call once per frame until isFullyUploaded so no single call blocks the main thread for long.
    uploadNextChunk(maxBytes: number): void {
        if (this.uploadedVertexBytes < this.pendingVertexBytes.byteLength) {
            const end = Math.min(
                this.uploadedVertexBytes + maxBytes,
                this.pendingVertexBytes.byteLength,
            );
            this.interleavedBuffer.data(
                this.pendingVertexBytes.subarray(this.uploadedVertexBytes, end),
                this.uploadedVertexBytes,
            );
            this.uploadedVertexBytes = end;
            return;
        }
        if (this.uploadedIndexBytes < this.pendingIndexBytes.byteLength) {
            const end = Math.min(
                this.uploadedIndexBytes + maxBytes,
                this.pendingIndexBytes.byteLength,
            );
            this.indexBuffer.data(
                this.pendingIndexBytes.subarray(this.uploadedIndexBytes, end),
                this.uploadedIndexBytes,
            );
            this.uploadedIndexBytes = end;
        }
    }

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
