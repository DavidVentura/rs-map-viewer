// A full cache's files by name, as the Node scripts read them from disk.
export class CacheFiles {
    static DAT_FILE_NAME = "main_file_cache.dat";
    static DAT2_FILE_NAME = "main_file_cache.dat2";

    static INDEX_FILE_PREFIX = "main_file_cache.idx";

    static META_FILE_NAME = "main_file_cache.idx255";

    constructor(readonly files: Map<string, ArrayBuffer>) {}
}
