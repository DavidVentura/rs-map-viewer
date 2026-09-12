import { CacheInfo } from "../CacheInfo";

// "RSCP" (RuneScape Cache Pack).
const MAGIC = 0x52534350;
const FORMAT_VERSION = 1;

const ENTRY_TABLE_ROW_SIZE = 4 + 4 + 4 + 4; // indexId, archiveId, blobOffset, blobLength

export type CachePackEntry = {
    readonly indexId: number;
    readonly archiveId: number;
    // A container exactly as CacheStore.read returns it: either the source cache's bytes or a
    // re-encoded subset (reference tables, config archives).
    readonly data: Int8Array;
};

export type CachePackHeader = {
    readonly cacheInfo: CacheInfo;
    // Every index of the source cache, each with a (possibly empty) subset reference table, so
    // CacheSystem.indexExists answers as it does on the full cache.
    readonly indexIds: readonly number[];
    // Keys of the packed map archives, by archive id (a string, as JSON object keys are).
    readonly xteas: Readonly<Record<string, readonly number[]>>;
};

export type CachePack = {
    readonly header: CachePackHeader;
    readonly entries: readonly CachePackEntry[];
};

// Fixed key order, so equal headers serialise to equal bytes.
function canonicalHeaderJson(header: CachePackHeader): string {
    const { cacheInfo } = header;
    const xteaArchiveIds = Object.keys(header.xteas)
        .map((key) => parseInt(key))
        .sort((a, b) => a - b);
    return JSON.stringify({
        cacheInfo: {
            name: cacheInfo.name,
            game: cacheInfo.game,
            environment: cacheInfo.environment,
            revision: cacheInfo.revision,
            timestamp: cacheInfo.timestamp,
            size: cacheInfo.size,
        },
        indexIds: [...header.indexIds].sort((a, b) => a - b),
        xteas: Object.fromEntries(
            xteaArchiveIds.map((archiveId) => [String(archiveId), header.xteas[archiveId]]),
        ),
    });
}

function sortedEntries(entries: readonly CachePackEntry[]): CachePackEntry[] {
    const sorted = [...entries].sort((a, b) => a.indexId - b.indexId || a.archiveId - b.archiveId);
    for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1];
        const entry = sorted[i];
        if (previous.indexId === entry.indexId && previous.archiveId === entry.archiveId) {
            throw new Error(
                `Cache pack has two entries for index ${entry.indexId}, archive ${entry.archiveId}`,
            );
        }
    }
    return sorted;
}

// Deterministic: the same pack always encodes to the same bytes.
export function encodeCachePack(pack: CachePack): Uint8Array {
    const entries = sortedEntries(pack.entries);
    const headerBytes = new TextEncoder().encode(canonicalHeaderJson(pack.header));

    const blobOffsets = new Array<number>(entries.length);
    let blobTotalLength = 0;
    for (let i = 0; i < entries.length; i++) {
        blobOffsets[i] = blobTotalLength;
        blobTotalLength += entries[i].data.length;
    }

    const tableStart = 4 + 4 + 4 + headerBytes.length;
    const blobStart = tableStart + 4 + entries.length * ENTRY_TABLE_ROW_SIZE;

    const bytes = new Uint8Array(blobStart + blobTotalLength);
    const view = new DataView(bytes.buffer);

    view.setUint32(0, MAGIC);
    view.setUint32(4, FORMAT_VERSION);
    view.setUint32(8, headerBytes.length);
    bytes.set(headerBytes, 12);

    view.setUint32(tableStart, entries.length);
    entries.forEach((entry, i) => {
        const row = tableStart + 4 + i * ENTRY_TABLE_ROW_SIZE;
        view.setUint32(row, entry.indexId);
        view.setUint32(row + 4, entry.archiveId);
        view.setUint32(row + 8, blobOffsets[i]);
        view.setUint32(row + 12, entry.data.length);
        bytes.set(
            new Uint8Array(entry.data.buffer, entry.data.byteOffset, entry.data.length),
            blobStart + blobOffsets[i],
        );
    });

    return bytes;
}

// Entries are views into the buffer, which may be a SharedArrayBuffer shared with workers.
export function decodeCachePack(buffer: ArrayBufferLike): CachePack {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    const magic = view.getUint32(0);
    if (magic !== MAGIC) {
        throw new Error(`Not a cache pack: bad magic 0x${magic.toString(16)}`);
    }
    const formatVersion = view.getUint32(4);
    if (formatVersion !== FORMAT_VERSION) {
        throw new Error(`Unsupported cache pack format version: ${formatVersion}`);
    }

    const headerLength = view.getUint32(8);
    // TextDecoder refuses a SharedArrayBuffer-backed view, so the header is copied out first.
    const header: CachePackHeader = JSON.parse(
        new TextDecoder().decode(bytes.slice(12, 12 + headerLength)),
    );

    const tableStart = 12 + headerLength;
    const entryCount = view.getUint32(tableStart);
    const blobStart = tableStart + 4 + entryCount * ENTRY_TABLE_ROW_SIZE;
    const entries = new Array<CachePackEntry>(entryCount);
    for (let i = 0; i < entryCount; i++) {
        const row = tableStart + 4 + i * ENTRY_TABLE_ROW_SIZE;
        entries[i] = {
            indexId: view.getUint32(row),
            archiveId: view.getUint32(row + 4),
            data: new Int8Array(
                buffer,
                blobStart + view.getUint32(row + 8),
                view.getUint32(row + 12),
            ),
        };
    }

    return { header, entries };
}
