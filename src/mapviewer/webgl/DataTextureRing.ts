import { App as PicoApp, PicoGL, Texture } from "picogl";

export enum DataTextureFormat {
    RGBA16UI,
    RGBA32UI,
}

export type DataTextureArray = Uint16Array | Uint32Array;

export type DataTextureSlot = {
    readonly index: number;
    readonly texture: Texture;
};

const TEXELS_PER_ROW = 16;
const COMPONENTS_PER_TEXEL = 4;

const INTERNAL_FORMATS: Record<DataTextureFormat, number> = {
    [DataTextureFormat.RGBA16UI]: PicoGL.RGBA16UI,
    [DataTextureFormat.RGBA32UI]: PicoGL.RGBA32UI,
};

// Slots are keyed by frame count so consumers that remember where their data went in a given
// frame (e.g. WebGLMapSquare.npcDataTextureOffsets) can address the same slot again. A slot's
// GPU storage is only reallocated when the data outgrows it; otherwise the upload is a
// texSubImage2D into the existing texture.
export class DataTextureRing {
    private readonly slots: (Texture | undefined)[];
    private readonly internalFormat: number;

    constructor(
        private readonly app: PicoApp,
        slotCount: number,
        format: DataTextureFormat,
    ) {
        this.slots = new Array(slotCount).fill(undefined);
        this.internalFormat = INTERNAL_FORMATS[format];
    }

    upload(frameCount: number, data: DataTextureArray, texelCount: number): DataTextureSlot {
        const index = frameCount % this.slots.length;
        const requiredHeight = Math.max(Math.ceil(texelCount / TEXELS_PER_ROW), 1);
        const texture = this.textureWithCapacity(index, requiredHeight);

        const componentCount = TEXELS_PER_ROW * texture.height * COMPONENTS_PER_TEXEL;
        if (data.length < componentCount) {
            throw new Error(
                `Data texture backing array has ${data.length} components, slot needs ${componentCount}`,
            );
        }
        texture.data(data.subarray(0, componentCount));

        return { index, texture };
    }

    private textureWithCapacity(index: number, requiredHeight: number): Texture {
        const existing = this.slots[index];
        if (existing === undefined) {
            const created = this.app.createTexture2D(TEXELS_PER_ROW, requiredHeight, {
                internalFormat: this.internalFormat,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
            });
            this.slots[index] = created;
            return created;
        }
        if (existing.height < requiredHeight) {
            existing.resize(TEXELS_PER_ROW, requiredHeight);
        }
        return existing;
    }

    delete(): void {
        for (const texture of this.slots) {
            texture?.delete();
        }
        this.slots.fill(undefined);
    }
}
