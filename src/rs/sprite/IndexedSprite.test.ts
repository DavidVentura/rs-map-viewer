import { IndexedSprite } from "./IndexedSprite";

function trimmedSprite(): IndexedSprite {
    const sprite = new IndexedSprite();
    sprite.width = 4;
    sprite.height = 3;
    sprite.subWidth = 2;
    sprite.subHeight = 2;
    sprite.xOffset = 1;
    sprite.yOffset = 1;
    // Palette index 0 is transparent; 1 is red, 2 is green.
    sprite.palette = Int32Array.from([0, 0xff0000, 0x00ff00]);
    sprite.pixels = Uint8Array.from([1, 0, 2, 1]);
    return sprite;
}

function pixelAt(rgba: Uint8ClampedArray, width: number, x: number, y: number): number[] {
    const index = (x + y * width) * 4;
    return Array.from(rgba.slice(index, index + 4));
}

describe("IndexedSprite.toFullSizeRgba", () => {
    it("places the trimmed pixels at their offset inside the full-size image", () => {
        const rgba = trimmedSprite().toFullSizeRgba();
        expect(rgba).toHaveLength(4 * 3 * 4);
        expect(pixelAt(rgba, 4, 1, 1)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(rgba, 4, 2, 1)).toEqual([0, 0, 0, 0]);
        expect(pixelAt(rgba, 4, 1, 2)).toEqual([0, 255, 0, 255]);
        expect(pixelAt(rgba, 4, 2, 2)).toEqual([255, 0, 0, 255]);
    });

    it("leaves everything outside the trimmed area transparent", () => {
        const rgba = trimmedSprite().toFullSizeRgba();
        for (const [x, y] of [
            [0, 0],
            [3, 0],
            [0, 1],
            [3, 2],
        ]) {
            expect(pixelAt(rgba, 4, x, y)).toEqual([0, 0, 0, 0]);
        }
    });
});
