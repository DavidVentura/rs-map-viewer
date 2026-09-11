import { deflateSync } from "zlib";

export type RgbImage = {
    readonly width: number;
    readonly height: number;
    readonly pixels: Int32Array;
};

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function buildCrcTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
}

const CRC_TABLE = buildCrcTable();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) {
        out[4 + i] = type.charCodeAt(i);
    }
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

function ihdr(width: number, height: number): Uint8Array {
    const data = new Uint8Array(13);
    const view = new DataView(data.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    data[8] = 8;
    data[9] = 2;
    return data;
}

function scanlines(image: RgbImage): Uint8Array {
    const stride = 1 + image.width * 3;
    const raw = new Uint8Array(stride * image.height);
    for (let y = 0; y < image.height; y++) {
        const rowStart = y * stride;
        for (let x = 0; x < image.width; x++) {
            const rgb = image.pixels[y * image.width + x];
            const offset = rowStart + 1 + x * 3;
            raw[offset] = (rgb >> 16) & 0xff;
            raw[offset + 1] = (rgb >> 8) & 0xff;
            raw[offset + 2] = rgb & 0xff;
        }
    }
    return raw;
}

export function encodeRgbPng(image: RgbImage): Buffer {
    if (image.pixels.length !== image.width * image.height) {
        throw new Error(
            `Pixel buffer has ${image.pixels.length} entries for ${image.width}x${image.height}`,
        );
    }
    return Buffer.concat([
        PNG_SIGNATURE,
        chunk("IHDR", ihdr(image.width, image.height)),
        chunk("IDAT", deflateSync(scanlines(image))),
        chunk("IEND", new Uint8Array(0)),
    ]);
}

export function concatHorizontally(images: readonly RgbImage[]): RgbImage {
    if (images.length === 0) {
        throw new Error("Cannot concatenate zero images");
    }
    const height = images[0].height;
    if (images.some((image) => image.height !== height)) {
        throw new Error("All images in a strip must share a height");
    }
    const width = images.reduce((sum, image) => sum + image.width, 0);
    const pixels = new Int32Array(width * height);
    let xOffset = 0;
    for (const image of images) {
        for (let y = 0; y < height; y++) {
            pixels.set(
                image.pixels.subarray(y * image.width, (y + 1) * image.width),
                y * width + xOffset,
            );
        }
        xOffset += image.width;
    }
    return { width, height, pixels };
}
