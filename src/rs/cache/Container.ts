// import { Xtea } from "../util/Xtea";
import { Bzip2 } from "../compression/Bzip2";
import { CompressionType } from "../compression/CompressionType";
import { Gzip } from "../compression/Gzip";
import { Xtea } from "../crypto/Xtea";
import { ByteBuffer } from "../io/ByteBuffer";
import { ByteWriter } from "../io/ByteWriter";

export class Container {
    static decode(buffer: ByteBuffer, key?: number[]): Container {
        if (buffer.remaining === 0) {
            throw new Error("Empty container");
        }
        const compression: CompressionType = buffer.readUnsignedByte();
        const size = buffer.readInt();
        if (Xtea.isValidKey(key)) {
            // Decrypt a copy: stores hand out views into a shared pack or bundle buffer, which a
            // later read of the same archive must see still encrypted.
            const offset = buffer.offset;
            buffer = new ByteBuffer(buffer.data.slice());
            buffer.offset = offset;
            Xtea.decrypt(buffer, buffer.offset, buffer.offset + 4 + size, key);
        }
        switch (compression) {
            case CompressionType.None:
                return new Container(compression, buffer.readBytes(size));
            case CompressionType.Bzip2:
            case CompressionType.Gzip:
                const actualSize = buffer.readInt() & 0xffffffff;

                const data = buffer.readUnsignedBytes(size);

                let decompressed: Int8Array;

                if (compression === CompressionType.Bzip2) {
                    decompressed = Bzip2.decompress(data, actualSize);
                } else {
                    decompressed = Gzip.decompress(data);
                }

                if (decompressed.length !== actualSize) {
                    throw new Error(
                        "Container: Size mismatch. Compressed: " +
                            actualSize +
                            ", Decompressed: " +
                            decompressed.length +
                            ", Type: " +
                            CompressionType[compression],
                    );
                }
                return new Container(compression, decompressed);
            default:
                throw new Error("Container: Unsupported compression: " + compression);
        }
    }

    static encodeUncompressed(data: Int8Array): Int8Array {
        const writer = new ByteWriter(data.length + 5);
        writer.writeByte(CompressionType.None);
        writer.writeInt(data.length);
        writer.writeBytes(data);
        return writer.toBytes();
    }

    constructor(
        readonly compression: CompressionType,
        readonly data: Int8Array,
    ) {}
}
