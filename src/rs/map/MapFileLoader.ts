import { CacheIndex } from "../cache/CacheIndex";
import { MapFileIndex } from "./MapFileIndex";

export class MapFileLoader {
    constructor(
        readonly mapIndex: CacheIndex,
        readonly mapFileIndex: MapFileIndex,
    ) {}

    getTerrainData(mapX: number, mapY: number): Int8Array | undefined {
        const archiveId = this.mapFileIndex.getTerrainArchiveId(mapX, mapY);
        if (archiveId === -1) {
            return undefined;
        }
        try {
            const file = this.mapIndex.getFile(archiveId, 0);
            return file?.data;
        } catch (e) {
            return undefined;
        }
    }

    getLocData(mapX: number, mapY: number): Int8Array | undefined {
        const archiveId = this.mapFileIndex.getLocArchiveId(mapX, mapY);
        if (archiveId === -1) {
            return undefined;
        }
        try {
            const file = this.mapIndex.getFile(archiveId, 0);
            return file?.data;
        } catch (e) {
            return undefined;
        }
    }

    getNpcSpawnData(mapX: number, mapY: number): Int8Array | undefined {
        const locArchiveId = this.mapFileIndex.getLocArchiveId(mapX, mapY);
        const archiveId = this.mapIndex.getArchiveId(`n${mapX}_${mapY}`);
        if (locArchiveId === -1 || archiveId === -1) {
            return undefined;
        }
        try {
            const file = this.mapIndex.getFile(archiveId, 0);
            return file?.data;
        } catch (e) {
            return undefined;
        }
    }
}

const WORLDAREA_GROUP_ID = (98 << 8) | 199;

export class ModernMapFileLoader extends MapFileLoader {
    override getTerrainData(mapX: number, mapY: number): Int8Array | undefined {
        const archiveId = (mapX << 8) | mapY;
        if (!this.mapIndex.archiveExists(archiveId) || archiveId === WORLDAREA_GROUP_ID) {
            return undefined;
        }
        return this.mapIndex.getFile(archiveId, 0)?.data;
    }

    override getLocData(mapX: number, mapY: number): Int8Array | undefined {
        const archiveId = (mapX << 8) | mapY;
        if (!this.mapIndex.archiveExists(archiveId) || archiveId === WORLDAREA_GROUP_ID) {
            return undefined;
        }
        return this.mapIndex.getFile(archiveId, 1)?.data;
    }

    override getNpcSpawnData(mapX: number, mapY: number): Int8Array | undefined {
        return undefined;
    }
}
