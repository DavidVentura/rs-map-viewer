import PicoGL, { DrawCall, App as PicoApp, Texture, VertexArray, VertexBuffer } from "picogl";

export const SKINNED_VERTEX_STRIDE = 16;

// WebGL2 only guarantees 2048-texel textures; the shader reads the width back with textureSize.
const SKIN_TABLE_WIDTH = 2048;

export function createSkinnedVertexArray(
    app: PicoApp,
    interleavedBuffer: VertexBuffer,
    indexBuffer: VertexBuffer,
): VertexArray {
    return app
        .createVertexArray()
        .vertexAttributeBuffer(0, interleavedBuffer, {
            type: PicoGL.UNSIGNED_INT,
            size: 3,
            stride: SKINNED_VERTEX_STRIDE,
            integer: true as any,
        })
        .vertexAttributeBuffer(1, interleavedBuffer, {
            type: PicoGL.UNSIGNED_INT,
            size: 1,
            stride: SKINNED_VERTEX_STRIDE,
            offset: 12,
            integer: true as any,
        })
        .indexBuffer(indexBuffer);
}

// The influence lists and matrix/alpha table that includes/skinning.glsl reads.
export class SkinTables {
    static create(app: PicoApp, influences: Uint32Array, matrixTable: Float32Array): SkinTables {
        return new SkinTables(createUintTable(app, influences), createFloatTable(app, matrixTable));
    }

    private constructor(
        private readonly influences: Texture,
        private readonly matrices: Texture,
    ) {}

    bind(drawCall: DrawCall): DrawCall {
        return drawCall
            .texture("u_skinInfluences", this.influences)
            .texture("u_skinMatrices", this.matrices);
    }

    delete(): void {
        this.influences.delete();
        this.matrices.delete();
    }
}

function createUintTable(app: PicoApp, source: Uint32Array): Texture {
    const height = Math.max(Math.ceil(source.length / SKIN_TABLE_WIDTH), 1);
    const data = new Uint32Array(SKIN_TABLE_WIDTH * height);
    data.set(source);
    return app.createTexture2D(data, SKIN_TABLE_WIDTH, height, {
        internalFormat: PicoGL.R32UI,
        type: PicoGL.UNSIGNED_INT,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}

function createFloatTable(app: PicoApp, source: Float32Array): Texture {
    const texelCount = Math.ceil(source.length / 4);
    const height = Math.max(Math.ceil(texelCount / SKIN_TABLE_WIDTH), 1);
    const data = new Float32Array(SKIN_TABLE_WIDTH * height * 4);
    data.set(source);
    return app.createTexture2D(data, SKIN_TABLE_WIDTH, height, {
        internalFormat: PicoGL.RGBA32F,
        type: PicoGL.FLOAT,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}
