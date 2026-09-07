import { CacheInfo } from "../CacheInfo";

// "RSCB" (RuneScape Cache Bundle).
const MAGIC = 0x52534342;
const FORMAT_VERSION = 1;

const TOC_ENTRY_SIZE = 4 + 4 + 4 + 4; // indexId, archiveId, blobOffset, blobLength

export type CacheBundleEntry = {
    readonly indexId: number;
    readonly archiveId: number;
    readonly data: Int8Array;
};

export type CacheBundleHeader = {
    readonly encounterId: string;
    readonly cacheInfo: CacheInfo;
    // Every index id the bundled cache exposes, including ones with no bundled archives (e.g. the
    // reference table for an index that exists but is never read), mirroring what CacheSystem.fromFiles
    // builds for a full cache.
    readonly indexIds: readonly number[];
    // xtea keys for the map archives the bundle needs, keyed by archive id (as a string, since
    // JSON object keys are always strings).
    readonly xteas: Readonly<Record<string, readonly number[]>>;
};

export type CacheBundle = {
    readonly header: CacheBundleHeader;
    readonly entries: readonly CacheBundleEntry[];
};

function sortedEntries(entries: readonly CacheBundleEntry[]): CacheBundleEntry[] {
    return [...entries].sort((a, b) => a.indexId - b.indexId || a.archiveId - b.archiveId);
}

export function encodeCacheBundle(bundle: CacheBundle): Uint8Array {
    const entries = sortedEntries(bundle.entries);

    const headerBytes = new TextEncoder().encode(JSON.stringify(bundle.header));

    const blobOffsets: number[] = new Array(entries.length);
    let blobTotalLength = 0;
    for (let i = 0; i < entries.length; i++) {
        blobOffsets[i] = blobTotalLength;
        blobTotalLength += entries[i].data.length;
    }

    const tocStart = 4 + 4 + 4 + headerBytes.length;
    const blobStart = tocStart + 4 + entries.length * TOC_ENTRY_SIZE;
    const totalLength = blobStart + blobTotalLength;

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let offset = 0;
    view.setUint32(offset, MAGIC);
    offset += 4;
    view.setUint32(offset, FORMAT_VERSION);
    offset += 4;
    view.setUint32(offset, headerBytes.length);
    offset += 4;
    bytes.set(headerBytes, offset);
    offset += headerBytes.length;

    view.setUint32(offset, entries.length);
    offset += 4;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        view.setUint32(offset, entry.indexId);
        offset += 4;
        view.setUint32(offset, entry.archiveId);
        offset += 4;
        view.setUint32(offset, blobOffsets[i]);
        offset += 4;
        view.setUint32(offset, entry.data.length);
        offset += 4;
    }

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        bytes.set(
            new Uint8Array(entry.data.buffer, entry.data.byteOffset, entry.data.length),
            blobStart + blobOffsets[i],
        );
    }

    return bytes;
}

export function decodeCacheBundle(buffer: ArrayBuffer): CacheBundle {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let offset = 0;
    const magic = view.getUint32(offset);
    offset += 4;
    if (magic !== MAGIC) {
        throw new Error(`Not a cache bundle: bad magic 0x${magic.toString(16)}`);
    }
    const formatVersion = view.getUint32(offset);
    offset += 4;
    if (formatVersion !== FORMAT_VERSION) {
        throw new Error(`Unsupported cache bundle format version: ${formatVersion}`);
    }

    const headerLength = view.getUint32(offset);
    offset += 4;
    // TextDecoder refuses a SharedArrayBuffer-backed view (the fetched bundle bytes are shared,
    // like the full cache's), so copy the header out with slice() rather than subarray().
    const header: CacheBundleHeader = JSON.parse(
        new TextDecoder().decode(bytes.slice(offset, offset + headerLength)),
    );
    offset += headerLength;

    const entryCount = view.getUint32(offset);
    offset += 4;

    const entries: CacheBundleEntry[] = new Array(entryCount);
    const blobStart = offset + entryCount * TOC_ENTRY_SIZE;
    for (let i = 0; i < entryCount; i++) {
        const entryOffset = offset + i * TOC_ENTRY_SIZE;
        const indexId = view.getUint32(entryOffset);
        const archiveId = view.getUint32(entryOffset + 4);
        const blobOffset = view.getUint32(entryOffset + 8);
        const blobLength = view.getUint32(entryOffset + 12);
        entries[i] = {
            indexId,
            archiveId,
            data: new Int8Array(buffer, blobStart + blobOffset, blobLength),
        };
    }

    return { header, entries };
}
