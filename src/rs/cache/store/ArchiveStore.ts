// Archives as Archive.decode reads them: decompressed and decrypted, with no container framing.
// At CacheIndex.META_INDEX_ID, an index's reference table in the same form. Packs store exactly
// this, so the browser never decompresses or decrypts anything.
export interface ArchiveStore {
    read(indexId: number, archiveId: number): Int8Array;
}
