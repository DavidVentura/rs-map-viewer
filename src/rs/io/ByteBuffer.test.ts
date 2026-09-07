import { ByteBuffer } from "./ByteBuffer";

describe("ByteBuffer", () => {
    describe("readUnsignedBytes", () => {
        it("reads from byte 0 of a freshly allocated array", () => {
            const buffer = new ByteBuffer(Int8Array.from([1, 2, 3, 4]));
            expect(Array.from(buffer.readUnsignedBytes(4))).toEqual([1, 2, 3, 4]);
        });

        // A cache bundle entry is a view into one big shared ArrayBuffer, so its Int8Array has a
        // nonzero byteOffset relative to that buffer. readUnsignedBytes must read relative to the
        // view's own start, not byte 0 of the underlying buffer.
        it("reads relative to the view's own byteOffset, not the underlying buffer's", () => {
            const shared = new Int8Array([9, 9, 1, 2, 3, 4, 9, 9]);
            const view = shared.subarray(2, 6); // [1, 2, 3, 4], byteOffset === 2
            expect(view.byteOffset).toBe(2);

            const buffer = new ByteBuffer(view);
            expect(Array.from(buffer.readUnsignedBytes(4))).toEqual([1, 2, 3, 4]);
        });

        it("advances the offset by the requested amount and honors a prior offset", () => {
            const shared = new Int8Array([9, 1, 2, 3, 4, 5, 9]);
            const view = shared.subarray(1, 6); // [1, 2, 3, 4, 5]

            const buffer = new ByteBuffer(view);
            buffer.offset = 2;
            expect(Array.from(buffer.readUnsignedBytes(2))).toEqual([3, 4]);
            expect(buffer.offset).toBe(4);
        });
    });
});
