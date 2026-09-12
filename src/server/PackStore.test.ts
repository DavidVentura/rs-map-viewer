/**
 * @jest-environment node
 */
import { promises as fsp } from "fs";
import os from "os";
import path from "path";

import { parsePackId } from "../rs/cache/pack/PackId";
import { PackStore, packIdOf } from "./PackStore";

async function tempDir(): Promise<string> {
    return fsp.mkdtemp(path.join(os.tmpdir(), "pack-store-"));
}

describe("parsePackId", () => {
    it("accepts a lowercase sha256 hex digest", () => {
        const packId = packIdOf(new Uint8Array([1, 2, 3]));
        expect(parsePackId(packId)).toBe(packId);
    });

    it.each(["", "abc", "A".repeat(64), "g".repeat(64), "../" + "a".repeat(61)])(
        "refuses %p",
        (value) => {
            expect(parsePackId(value)).toBeUndefined();
        },
    );
});

describe("PackStore", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("writes a pack under its content hash and leaves no temp file", async () => {
        const dir = await tempDir();
        const store = await PackStore.open(dir);
        const bytes = new Uint8Array([5, 6, 7, 8]);

        const packId = await store.put(bytes);

        expect(packId).toBe(packIdOf(bytes));
        expect(await fsp.readdir(dir)).toEqual([`${packId}.pack`]);
        expect(new Uint8Array(await fsp.readFile(store.packPath(packId)))).toEqual(bytes);
    });

    it("writes concurrent puts of the same bytes once", async () => {
        const store = await PackStore.open(await tempDir());
        const rename = jest.spyOn(fsp, "rename");
        const bytes = new Uint8Array([1, 1, 2, 3, 5, 8]);

        const packIds = await Promise.all(Array.from({ length: 8 }, () => store.put(bytes)));

        expect(new Set(packIds)).toEqual(new Set([packIdOf(bytes)]));
        expect(rename).toHaveBeenCalledTimes(1);
    });

    it("keeps a pack that is already on disk", async () => {
        const dir = await tempDir();
        const bytes = new Uint8Array([9, 9, 9]);
        const first = await PackStore.open(dir);
        const packId = await first.put(bytes);
        const { mtimeMs } = await fsp.stat(first.packPath(packId));

        const second = await PackStore.open(dir);
        const rename = jest.spyOn(fsp, "rename");
        const writeFile = jest.spyOn(fsp, "writeFile");
        expect(await second.put(bytes)).toBe(packId);

        expect(rename).not.toHaveBeenCalled();
        expect(writeFile).not.toHaveBeenCalled();
        expect((await fsp.stat(second.packPath(packId))).mtimeMs).toBe(mtimeMs);
    });

    it("deletes temp files a previous process left behind when opened", async () => {
        const dir = await tempDir();
        const packId = packIdOf(new Uint8Array([4]));
        await fsp.writeFile(path.join(dir, `${packId}.pack`), new Uint8Array([4]));
        await fsp.writeFile(path.join(dir, `${packId}.pack.tmp-1234-abcdef`), new Uint8Array([4]));

        await PackStore.open(dir);

        expect(await fsp.readdir(dir)).toEqual([`${packId}.pack`]);
    });

    it("cleans up and retries after a failed write", async () => {
        const dir = await tempDir();
        const store = await PackStore.open(dir);
        const bytes = new Uint8Array([7, 7]);
        jest.spyOn(fsp, "rename").mockRejectedValueOnce(new Error("disk full"));

        await expect(store.put(bytes)).rejects.toThrow("disk full");
        expect(await fsp.readdir(dir)).toEqual([]);

        const packId = await store.put(bytes);
        expect(await fsp.readdir(dir)).toEqual([`${packId}.pack`]);
    });
});
