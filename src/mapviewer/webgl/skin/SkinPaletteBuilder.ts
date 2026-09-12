import { FramePalette } from "../../../rs/model/animation/FramePalette";
import { SkinFrame } from "./SkinAnimation";

const ROW_VALUES = 4;

export class SkinPaletteBuilder {
    private table = new Float32Array(4096);
    private length = 0;

    addFrame(palette: FramePalette): SkinFrame {
        const matrixOffset = this.length / ROW_VALUES;
        this.append(palette.matrices);
        const alphaOffset = this.length / ROW_VALUES;
        for (const alpha of palette.alphaTransforms) {
            this.append([alpha.delta, alpha.lower, alpha.upper, 0]);
        }
        return { matrixOffset, alphaOffset };
    }

    build(): Float32Array {
        return this.table.slice(0, this.length);
    }

    private append(values: ArrayLike<number>): void {
        const length = this.length + values.length;
        if (length > this.table.length) {
            const grown = new Float32Array(Math.max(length, this.table.length * 2));
            grown.set(this.table.subarray(0, this.length));
            this.table = grown;
        }
        this.table.set(values, this.length);
        this.length = length;
    }
}
