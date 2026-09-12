import { createHash, randomBytes } from "crypto";
import { promises as fsp } from "fs";
import path from "path";

import { PackId } from "../rs/cache/pack/PackId";

export function packIdOf(bytes: Uint8Array): PackId {
    return createHash("sha256").update(bytes).digest("hex") as PackId;
}

const TEMP_FILE_MARKER = ".tmp-";

function fileExists(filePath: string): Promise<boolean> {
    return fsp.access(filePath).then(
        () => true,
        () => false,
    );
}

// One cache's packs on disk, each in <packId>.pack. A pack is written to a temp file beside it and
// renamed into place, so a reader never sees a partial pack, and is never written twice: an
// existing file is kept, and concurrent puts of the same bytes share one write.
export class PackStore {
    private readonly writes = new Map<PackId, Promise<void>>();

    private constructor(readonly dir: string) {}

    // Temp files left in the directory are writes a previous process died during.
    static async open(dir: string): Promise<PackStore> {
        await fsp.mkdir(dir, { recursive: true });
        const staleTempFiles = (await fsp.readdir(dir)).filter((name) =>
            name.includes(TEMP_FILE_MARKER),
        );
        await Promise.all(staleTempFiles.map((name) => fsp.unlink(path.join(dir, name))));
        return new PackStore(dir);
    }

    packPath(packId: PackId): string {
        return path.join(this.dir, `${packId}.pack`);
    }

    put(bytes: Uint8Array): Promise<PackId> {
        const packId = packIdOf(bytes);
        let write = this.writes.get(packId);
        if (!write) {
            write = this.write(packId, bytes);
            this.writes.set(packId, write);
            // A failed write leaves nothing on disk, so a later put should try again.
            write.catch(() => this.writes.delete(packId));
        }
        return write.then(() => packId);
    }

    private async write(packId: PackId, bytes: Uint8Array): Promise<void> {
        const packPath = this.packPath(packId);
        if (await fileExists(packPath)) {
            return;
        }
        const suffix = `${process.pid}-${randomBytes(6).toString("hex")}`;
        const tempPath = `${packPath}${TEMP_FILE_MARKER}${suffix}`;
        try {
            await fsp.writeFile(tempPath, bytes, { flag: "wx" });
            await fsp.rename(tempPath, packPath);
        } catch (e) {
            await fsp.rm(tempPath, { force: true });
            throw e;
        }
    }
}
