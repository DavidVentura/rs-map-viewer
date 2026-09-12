import { Bzip2 } from "../compression/Bzip2";
import { ByteBuffer } from "../io/ByteBuffer";
import { MapFileLoader } from "./MapFileLoader";

export class LegacyMapFileLoader extends MapFileLoader {
    decompress(data: Int8Array): Int8Array {
        const buffer = new ByteBuffer(data);
        const actualSize = buffer.readInt();
        const compressed = buffer.readUnsignedBytes(buffer.remaining);
        const decompressed = Bzip2.decompress(compressed, actualSize);
        return decompressed;
    }

    override getTerrainData(mapX: number, mapY: number): Int8Array | undefined {
        const data = super.getTerrainData(mapX, mapY);
        if (!data) {
            return undefined;
        }
        try {
            return this.decompress(data);
        } catch (e) {
            console.error("Failed decompressing terrain data", mapX, mapY, data.length, e);
            return undefined;
        }
    }

    override getLocData(mapX: number, mapY: number): Int8Array | undefined {
        const data = super.getLocData(mapX, mapY);
        if (!data) {
            return undefined;
        }
        try {
            return this.decompress(data);
        } catch (e) {
            console.error("Failed decompressing loc data", mapX, mapY, data.length, data, e);
            return undefined;
        }
    }
}
