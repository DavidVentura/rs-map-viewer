import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import { openCachePack } from "../../rs/cache/pack/openCachePack";
import { Hasher } from "../../util/Hasher";
import { RenderDataLoader, renderDataLoaderSerializer } from "./RenderDataLoader";
import { WorkerState, clearWorkerStateCaches, createWorkerState } from "./WorkerState";

registerSerializer(renderDataLoaderSerializer);

const hasherPromise = Hasher.init();

let workerStatePromise: Promise<WorkerState> | undefined;

async function initWorker(packBuffer: SharedArrayBuffer): Promise<WorkerState> {
    await hasherPromise;

    const { cache, spawns } = openCachePack(packBuffer);
    return createWorkerState(cache, spawns);
}

const worker = {
    initCache(packBuffer: SharedArrayBuffer) {
        workerStatePromise = initWorker(packBuffer);
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
