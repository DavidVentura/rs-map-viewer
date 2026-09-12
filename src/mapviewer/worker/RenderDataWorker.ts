import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import { openCachePack } from "../../rs/cache/pack/openCachePack";
import { Bzip2 } from "../../rs/compression/Bzip2";
import { Gzip } from "../../rs/compression/Gzip";
import { Hasher } from "../../util/Hasher";
import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { RenderDataLoader, renderDataLoaderSerializer } from "./RenderDataLoader";
import { WorkerState, clearWorkerStateCaches, createWorkerState } from "./WorkerState";

registerSerializer(renderDataLoaderSerializer);

const compressionPromise = Promise.all([Bzip2.initWasm(), Gzip.initWasm()]);
const hasherPromise = Hasher.init();

let workerStatePromise: Promise<WorkerState> | undefined;

async function initWorker(
    packBuffer: SharedArrayBuffer,
    objSpawns: ObjSpawn[],
    npcSpawns: NpcSpawn[],
): Promise<WorkerState> {
    await compressionPromise;
    await hasherPromise;

    return createWorkerState(openCachePack(packBuffer), objSpawns, npcSpawns);
}

const worker = {
    initCache(packBuffer: SharedArrayBuffer, objSpawns: ObjSpawn[], npcSpawns: NpcSpawn[]) {
        workerStatePromise = initWorker(packBuffer, objSpawns, npcSpawns);
    },
    initDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.init();
    },
    resetDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.reset();
    },
    async load<I, D>(
        dataLoader: RenderDataLoader<I, D>,
        input: I,
    ): Promise<TransferDescriptor<D> | undefined> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const { data, transferables } = await dataLoader.load(workerState, input);

        clearWorkerStateCaches(workerState);

        if (!data) {
            return undefined;
        }
        return Transfer<D>(data, transferables);
    },
    async setVars(values: Int32Array): Promise<void> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }
        workerState.varManager.set(values);
    },
};

export type RenderDataWorker = typeof worker;

expose(worker);
