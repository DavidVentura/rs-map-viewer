// Big-endian writer that grows as needed, the encoding counterpart of ByteBuffer's readers.
export class ByteWriter {
    private bytes: Int8Array;
    private length = 0;

    constructor(initialCapacity: number = 256) {
        this.bytes = new Int8Array(Math.max(initialCapacity, 16));
    }

    private reserve(count: number): void {
        const required = this.length + count;
        if (required <= this.bytes.length) {
            return;
        }
        const grown = new Int8Array(Math.max(required, this.bytes.length * 2));
        grown.set(this.bytes.subarray(0, this.length));
        this.bytes = grown;
    }

    writeByte(value: number): void {
        this.reserve(1);
        this.bytes[this.length++] = value;
    }

    writeShort(value: number): void {
        this.reserve(2);
        this.bytes[this.length++] = value >> 8;
        this.bytes[this.length++] = value;
    }

    writeInt(value: number): void {
        this.reserve(4);
        this.bytes[this.length++] = value >> 24;
        this.bytes[this.length++] = value >> 16;
        this.bytes[this.length++] = value >> 8;
        this.bytes[this.length++] = value;
    }

    // Inverse of ByteBuffer.readBigSmart: 32767 as a short is reserved for -1, so it and anything
    // larger take the int form with the top bit set.
    writeBigSmart(value: number): void {
        if (value === -1) {
            this.writeShort(0x7fff);
        } else if (value >= 0 && value < 0x7fff) {
            this.writeShort(value);
        } else if (value >= 0x7fff && value <= 0x7fffffff) {
            this.writeInt(value | 0x80000000);
        } else {
            throw new Error(`Big smart out of range: ${value}`);
        }
    }

    writeBytes(bytes: Int8Array): void {
        this.reserve(bytes.length);
        this.bytes.set(bytes, this.length);
        this.length += bytes.length;
    }

    toBytes(): Int8Array {
        return this.bytes.slice(0, this.length);
    }
}
