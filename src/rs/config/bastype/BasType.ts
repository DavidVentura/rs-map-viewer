import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

export class BasType extends Type {
    idleSeqId = -1;
    walkSeqId = -1;

    modelRotateTranslate?: number[][];

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            this.idleSeqId = buffer.readUnsignedShort();
            this.walkSeqId = buffer.readUnsignedShort();
            if (this.idleSeqId === 0xffff) {
                this.idleSeqId = -1;
            }
            if (this.walkSeqId === 0xffff) {
                this.walkSeqId = -1;
            }
        } else if (opcode === 2) {
            buffer.readUnsignedShort();
        } else if (opcode === 3) {
            buffer.readUnsignedShort();
        } else if (opcode === 4) {
            buffer.readUnsignedShort();
        } else if (opcode === 5) {
            buffer.readUnsignedShort();
        } else if (opcode === 6) {
            buffer.readUnsignedShort();
        } else if (opcode === 7) {
            buffer.readUnsignedShort();
        } else if (opcode === 8) {
            buffer.readUnsignedShort();
        } else if (opcode === 9) {
            buffer.readUnsignedShort();
        } else if (opcode === 26) {
            buffer.readUnsignedByte();
            buffer.readUnsignedByte();
        } else if (opcode === 27) {
            if (!this.modelRotateTranslate) {
                this.modelRotateTranslate = new Array(12);
            }
            const bodyPartId = buffer.readUnsignedByte();
            this.modelRotateTranslate[bodyPartId] = new Array(6);
            for (let type = 0; type < 6; type++) {
                /*
                 * 0 -Rotate X
                 * 1 - Rotate Y
                 * 2 - Rotate Z
                 * 3 - Translate X
                 * 4 - Translate Y
                 * 5 - Translate Z
                 */
                this.modelRotateTranslate[bodyPartId][type] = buffer.readShort();
            }
        } else if (opcode === 29) {
            buffer.readUnsignedByte();
        } else if (opcode === 30) {
            buffer.readUnsignedShort();
        } else if (opcode === 31) {
            buffer.readUnsignedByte();
        } else if (opcode === 32) {
            buffer.readUnsignedShort();
        } else if (opcode === 33) {
            buffer.readShort();
        } else if (opcode === 34) {
            buffer.readUnsignedByte();
        } else if (opcode === 35) {
            buffer.readUnsignedShort();
        } else if (opcode === 36) {
            buffer.readShort();
        } else if (opcode === 37) {
            buffer.readUnsignedByte();
        } else if (opcode === 38) {
            buffer.readUnsignedShort();
        } else if (opcode === 39) {
            buffer.readUnsignedShort();
        } else if (opcode === 40) {
            buffer.readUnsignedShort();
        } else if (opcode === 41) {
            buffer.readUnsignedShort();
        } else if (opcode === 42) {
            buffer.readUnsignedShort();
        } else if (opcode === 43) {
            buffer.readUnsignedShort();
        } else if (opcode === 44) {
            buffer.readUnsignedShort();
        } else if (opcode === 45) {
            buffer.readUnsignedShort();
        } else if (opcode === 46) {
            buffer.readUnsignedShort();
        } else if (opcode === 47) {
            buffer.readUnsignedShort();
        } else if (opcode === 48) {
            buffer.readUnsignedShort();
        } else if (opcode === 49) {
            buffer.readUnsignedShort();
        } else if (opcode === 50) {
            buffer.readUnsignedShort();
        } else if (opcode === 51) {
            buffer.readUnsignedShort();
        } else if (opcode === 52) {
            const count = buffer.readUnsignedByte();
            for (let i = 0; i < count; i++) {
                buffer.readUnsignedShort();
                buffer.readUnsignedByte();
            }
        } else if (opcode === 53) {
            // bool = false;
        } else if (opcode === 54) {
            buffer.readUnsignedByte();
            buffer.readUnsignedByte();
        } else if (opcode === 55) {
            buffer.readUnsignedByte();
            buffer.readUnsignedShort();
        } else if (opcode === 54) {
            buffer.readUnsignedByte();
            for (let i = 0; i < 3; i++) {
                buffer.readShort();
            }
        } else {
            throw new Error("BasType: Unknown opcode: " + opcode);
        }
    }
}
