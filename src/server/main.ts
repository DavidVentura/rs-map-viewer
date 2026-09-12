// The pack server: cuts cache packs for the browser and serves them. Run with tsx:
//   PACK_SERVER_PORT=3001 CACHES_DIR=caches PACKS_DIR=packs npx tsx src/server/main.ts
import { CachePacker } from "../rs/cache/pack/CachePacker";
import { Bzip2 } from "../rs/compression/Bzip2";
import { readCacheInfos, readSourceCache } from "./CacheDirectory";
import { readWorldSpawns } from "./WorldSpawns";
import { createPackServer } from "./packServer";

type PackServerEnv = {
    readonly port: number;
    readonly cachesDir: string;
    readonly packsDir: string;
};

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set`);
    }
    return value;
}

function parseEnv(): PackServerEnv {
    const portText = requireEnv("PACK_SERVER_PORT");
    const port = Number(portText);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`PACK_SERVER_PORT is not a port: ${portText}`);
    }
    return { port, cachesDir: requireEnv("CACHES_DIR"), packsDir: requireEnv("PACKS_DIR") };
}

async function main(): Promise<void> {
    const env = parseEnv();
    // Opening a cache decodes its reference tables and config archives, most of them bzip2.
    await Bzip2.initWasm();
    const caches = readCacheInfos(env.cachesDir);
    const server = await createPackServer({
        caches,
        packsDir: env.packsDir,
        worldSpawns: readWorldSpawns(),
        openPacker: (info) => {
            const start = performance.now();
            const packer = new CachePacker(readSourceCache(env.cachesDir, info));
            console.log(`Opened ${info.name} in ${(performance.now() - start).toFixed(0)} ms`);
            return packer;
        },
    });
    server.listen(env.port, () => {
        console.log(
            `Pack server listening on port ${env.port}, serving ${caches
                .map((info) => info.name)
                .join(", ")}`,
        );
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
