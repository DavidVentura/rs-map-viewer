import { ByteBuffer } from "../../io/ByteBuffer";
import { XteaMap } from "../../map/XteaMap";
import { ApiType } from "../ApiType";
import { Container } from "../Container";
import { IndexType } from "../IndexType";
import { ArchiveStore } from "./ArchiveStore";
import { CacheStore } from "./CacheStore";

// A full dat2 cache's archives, decoded from its containers on every read. The map keys belong
// here rather than with the map loader: packs are cut from these decoded archives, so nothing
// past this store ever sees a key.
export class Dat2ArchiveStore implements ArchiveStore {
    constructor(
        private readonly containers: CacheStore<ApiType.SYNC>,
        private readonly mapKeys: XteaMap,
    ) {}

    read(indexId: number, archiveId: number): Int8Array {
        const key = indexId === IndexType.DAT2.maps ? this.mapKeys.get(archiveId) : undefined;
        return Container.decode(new ByteBuffer(this.containers.read(indexId, archiveId)), key).data;
    }
}
