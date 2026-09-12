import { LoadedCache } from "../../rs/cache/LoadedCache";
import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { WorkerState, createWorkerState } from "./WorkerState";

// What loadMinimapBlob's canvas turns into: the pixels it was drawn with, so a minimap built in
// Node can be compared byte for byte.
export class HeadlessBlob {
    constructor(readonly pixels: Uint8ClampedArray) {}
}

class HeadlessImageData {
    readonly data: Uint8ClampedArray;

    constructor(
        readonly width: number,
        readonly height: number,
    ) {
        this.data = new Uint8ClampedArray(width * height * 4);
    }
}

class HeadlessOffscreenCanvas {
    private drawn = new Uint8ClampedArray(0);

    constructor(
        readonly width: number,
        readonly height: number,
    ) {}

    getContext() {
        return {
            putImageData: (imageData: HeadlessImageData) => {
                this.drawn = imageData.data.slice();
            },
        };
    }

    convertToBlob(): Promise<HeadlessBlob> {
        return Promise.resolve(new HeadlessBlob(this.drawn));
    }
}

// Node has neither OffscreenCanvas nor ImageData, which the map loader's minimap step draws with.
export function installHeadlessCanvas(): void {
    (globalThis as any).OffscreenCanvas = HeadlessOffscreenCanvas;
    (globalThis as any).ImageData = HeadlessImageData;
}

// A render worker's state in Node, without the wasm decoders (Bzip2 and Gzip use their JS
// versions).
export function createHeadlessWorkerState(
    cache: LoadedCache,
    objSpawns: ObjSpawn[],
    npcSpawns: NpcSpawn[],
): WorkerState {
    installHeadlessCanvas();
    return createWorkerState(cache, objSpawns, npcSpawns);
}
