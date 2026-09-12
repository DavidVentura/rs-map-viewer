import { ByteBuffer } from "../../io/ByteBuffer";
import { ByteWriter } from "../../io/ByteWriter";
import { canonicalMapSpawns } from "../../map/MapSpawns";
import { Archive } from "../Archive";
import { ArchiveFile } from "../ArchiveFile";
import { CacheInfo } from "../CacheInfo";
import { CacheSystem } from "../CacheSystem";
import { ArchiveReference } from "../ref/ArchiveReference";
import { ReferenceTable } from "../ref/ReferenceTable";
import { CachePack, decodeCachePack, encodeCachePack } from "./CachePack";
import { CacheSelectionBuilder } from "./CacheSelection";
import { PackCacheStore } from "./PackCacheStore";

const CACHE_INFO: CacheInfo = {
    name: "osrs-240_2026-09-02",
    game: "oldschool",
    environment: "live",
    revision: 240,
    timestamp: "2026-09-02T10:30:06.395938Z",
    size: 190440869,
};

function files(archiveId: number, contents: number[][]): ArchiveFile[] {
    return contents.map((bytes, i) => new ArchiveFile(i * 3, archiveId, Int8Array.from(bytes)));
}

function decodeArchive(data: Int8Array, archiveFiles: ArchiveFile[]): Archive {
    const fileIds = Int32Array.from(archiveFiles.map((file) => file.id));
    return Archive.decode(
        7,
        fileIds.length > 0 ? fileIds[fileIds.length - 1] : 0,
        fileIds.length,
        fileIds,
        new Int32Array(fileIds.length),
        new ByteBuffer(data),
    );
}

const SPAWNS = canonicalMapSpawns(
    [
        { id: 3106, name: "Man", x: 3222, y: 3218, level: 0 },
        { id: 3106, name: "Man", x: 3221, y: 3218, level: 2 },
    ],
    [{ id: 995, count: 3, x: 3220, y: 3219, plane: 1 }],
);

function makePack(entries: CachePack["entries"]): CachePack {
    return {
        spawns: SPAWNS,
        header: { cacheInfo: CACHE_INFO, indexIds: [2, 7] },
        entries,
    };
}

describe("ByteWriter", () => {
    it("writes big smarts that ByteBuffer reads back, across the short/int boundary", () => {
        const values = [0, 1, 32766, 32767, 32768, 65535, 1 << 20, 0x7fffffff, -1];
        const writer = new ByteWriter(1);
        values.forEach((value) => writer.writeBigSmart(value));
        const buffer = new ByteBuffer(writer.toBytes());
        expect(values.map(() => buffer.readBigSmart())).toEqual(values);
        expect(buffer.remaining).toBe(0);
    });
});

describe("Archive encoding", () => {
    it.each([
        ["no files", []],
        ["one file", [[5, 6, 7]]],
        ["several files, one empty", [[1, 2], [], [3, 4, 5, 6]]],
    ])("round-trips an archive with %s", (_, contents) => {
        const archiveFiles = files(7, contents);
        const archive = decodeArchive(Archive.encode(archiveFiles), archiveFiles);
        for (const file of archiveFiles) {
            expect(Array.from(archive.getFile(file.id)!.data)).toEqual(Array.from(file.data));
        }
        expect(archive.files).toHaveLength(archiveFiles.length);
    });

    it("decodes archive files from data that is a view into a larger buffer", () => {
        const archiveFiles = files(7, [[9, 8], [7]]);
        const data = Archive.encode(archiveFiles);
        const padded = new Int8Array(data.length + 11);
        padded.set(data, 11);
        const archive = decodeArchive(padded.subarray(11), archiveFiles);
        expect(Array.from(archive.getFile(3)!.data)).toEqual([7]);
    });
});

describe("ReferenceTable encoding", () => {
    function reference(id: number, fileIds: number[]): ArchiveReference {
        const indexMap = new Map(fileIds.map((fileId, i) => [fileId, i]));
        return new ArchiveReference(
            id,
            id * 7,
            new Int8Array(),
            id * 13,
            100 + id,
            200 + id,
            id * 3,
            fileIds.length,
            fileIds[fileIds.length - 1] ?? 0,
            indexMap,
            Int32Array.from(fileIds),
            Int32Array.from(fileIds.map((fileId) => fileId * 11)),
        );
    }

    it("round-trips archives and a file subset through a view into a larger buffer", () => {
        const format = {
            protocol: 7,
            revision: 42,
            named: true,
            usesWhirlpool: false,
            hasSizes: true,
        };
        const full = reference(40000, [0, 2, 70000]);
        const archives = [reference(3, [0]), full.withFiles([2, 70000], 60)];
        const table = ReferenceTable.encode(format, archives);
        const padded = new Int8Array(table.length + 3);
        padded.set(table, 3);

        const decoded = ReferenceTable.decode(new ByteBuffer(padded.subarray(3)));

        expect(decoded.format).toEqual(format);
        expect(Array.from(decoded.archiveIds)).toEqual([3, 40000]);
        const subset = decoded.getArchiveReference(40000)!;
        expect(Array.from(subset.fileIds)).toEqual([2, 70000]);
        expect(Array.from(subset.fileNameHashes)).toEqual([22, 770000]);
        expect([subset.crc, subset.revision, subset.nameHash]).toEqual([
            full.crc,
            full.revision,
            full.nameHash,
        ]);
        expect([subset.compressedSize, subset.decompressedSize]).toEqual([60, 60]);
    });

    it("rejects archives out of order", () => {
        const format = {
            protocol: 7,
            revision: 0,
            named: false,
            usesWhirlpool: false,
            hasSizes: false,
        };
        expect(() => ReferenceTable.encode(format, [reference(5, [0]), reference(4, [0])])).toThrow(
            /ascend/,
        );
    });
});

describe("CacheSelectionBuilder", () => {
    it("orders archives and files, and lets a whole archive absorb its files", () => {
        const builder = new CacheSelectionBuilder();
        builder.addFile(2, 6, 9);
        builder.addFile(2, 6, 1);
        builder.addArchive(2, 9);
        builder.addWhole(7, 5);
        builder.addFile(7, 5, 0);
        builder.addWhole(7, 1);
        expect(builder.build()).toEqual([
            { indexId: 2, archiveId: 6, selection: { kind: "FILES", fileIds: [1, 9] } },
            { indexId: 2, archiveId: 9, selection: { kind: "FILES", fileIds: [] } },
            { indexId: 7, archiveId: 1, selection: { kind: "WHOLE" } },
            { indexId: 7, archiveId: 5, selection: { kind: "WHOLE" } },
        ]);
    });
});

describe("CachePack", () => {
    const entries = [
        { indexId: 7, archiveId: 9, data: Int8Array.from([4, 5]) },
        { indexId: 2, archiveId: 6, data: Int8Array.from([1, 2, 3]) },
        { indexId: 255, archiveId: 2, data: Int8Array.from([]) },
    ];

    it("round-trips its header, spawns and entries", () => {
        const decoded = decodeCachePack(encodeCachePack(makePack(entries)).buffer);
        expect(decoded.header).toEqual(makePack(entries).header);
        expect(decoded.spawns).toEqual(SPAWNS);
        expect(
            decoded.entries.map(({ indexId, archiveId, data }) => [
                indexId,
                archiveId,
                Array.from(data),
            ]),
        ).toEqual([
            [2, 6, [1, 2, 3]],
            [7, 9, [4, 5]],
            [255, 2, []],
        ]);
    });

    it("encodes the same pack to the same bytes regardless of entry order", () => {
        const forwards = encodeCachePack(makePack(entries));
        const backwards = encodeCachePack(makePack([...entries].reverse()));
        expect(Buffer.from(forwards).equals(Buffer.from(backwards))).toBe(true);
    });

    it("rejects two entries for one archive", () => {
        expect(() => encodeCachePack(makePack([...entries, entries[0]]))).toThrow(/two entries/);
    });

    it("serves packed archives and throws naming anything else", () => {
        const store = new PackCacheStore(
            decodeCachePack(encodeCachePack(makePack(entries)).buffer),
        );
        expect(Array.from(store.read(7, 9))).toEqual([4, 5]);
        expect(() => store.read(7, 10)).toThrow("Cache pack has no data for index 7, archive 10");
        expect(() => store.read(3, 0)).toThrow(/index 3/);
    });

    it("rejects a pack of another format version", () => {
        const bytes = encodeCachePack(makePack(entries));
        new DataView(bytes.buffer).setUint32(4, 1);
        expect(() => decodeCachePack(bytes.buffer)).toThrow(
            "Unsupported cache pack format version: 1",
        );
    });

    it("decodes archives straight from their packed data", () => {
        const archiveFiles = files(9, [[1, 2], [3]]);
        const fileIds = archiveFiles.map((file) => file.id);
        const data = Archive.encode(archiveFiles);
        const reference = new ArchiveReference(
            9,
            0,
            new Int8Array(),
            0,
            0,
            0,
            0,
            fileIds.length,
            fileIds[fileIds.length - 1],
            new Map(fileIds.map((fileId, i) => [fileId, i])),
            Int32Array.from(fileIds),
            new Int32Array(fileIds.length),
        ).withFiles(fileIds, data.length);
        const format = {
            protocol: 6,
            revision: 0,
            named: false,
            usesWhirlpool: false,
            hasSizes: false,
        };
        const pack = makePack([
            { indexId: 255, archiveId: 7, data: ReferenceTable.encode(format, [reference]) },
            { indexId: 7, archiveId: 9, data },
        ]);
        const system = CacheSystem.fromStore(
            new PackCacheStore(decodeCachePack(encodeCachePack(pack).buffer)),
            [7],
        );
        expect(Array.from(system.getIndex(7).getFile(9, 3)!.data)).toEqual([3]);
        expect(Array.from(system.getIndex(7).getFile(9, 0)!.data)).toEqual([1, 2]);
    });
});
