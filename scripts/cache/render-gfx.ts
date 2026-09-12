import fs from "fs";
import path from "path";

import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { NpcModelLoader } from "../../src/rs/config/npctype/NpcModelLoader";
import { SeqType } from "../../src/rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../../src/rs/config/seqtype/SeqTypeLoader";
import { SpotAnimType } from "../../src/rs/config/spotanimtype/SpotAnimType";
import { VarManager } from "../../src/rs/config/vartype/VarManager";
import { Model } from "../../src/rs/model/Model";
import { ModelData } from "../../src/rs/model/ModelData";
import { ModelLoader } from "../../src/rs/model/ModelLoader";
import { SeqFrameLoader } from "../../src/rs/model/seq/SeqFrameLoader";
import { TextureLoader } from "../../src/rs/texture/TextureLoader";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";
import { View, fitCamera, modelExtent, renderModel, unionExtent } from "./model-raster";
import { RgbImage, concatHorizontally, encodeRgbPng } from "./png";

const USAGE = `Usage: render-gfx.ts <subject> [options]

Subject (exactly one):
  --gfx <id>                 spot animation
  --range <from-to>          spot animations from..to, one subdirectory each
  --npc <id> --seq <seqId>   npc model posed by a sequence
  --model <id> [--seq <id>]  bare model, optionally posed by a sequence

Options:
  --out <dir>                output directory (default ./render-out/<subject>)
  --bg <hex>                 background colour, e.g. ffffff (default 000000)
  --size <px>                square image size (default 256)
  --view <front|iso|top>     camera preset (default iso)
  --zoom <factor>            multiplier on the bounds fit (default 1)
  --frames <all|N|a-b>       frames to render (default all)
  --strip | --no-strip       also write strip.png with all frames (default on)`;

const CLIENT_TICK_MS = 20;
const SPOT_ANIM_LIGHT = { x: -50, y: -10, z: -50 };
const BARE_MODEL_AMBIENT = 64;
const BARE_MODEL_CONTRAST = 768;

enum SubjectKind {
    Gfx = "gfx",
    Npc = "npc",
    Model = "model",
}

type Subject =
    | { readonly kind: SubjectKind.Gfx; readonly ids: readonly number[] }
    | { readonly kind: SubjectKind.Npc; readonly npcId: number; readonly seqId: number }
    | {
          readonly kind: SubjectKind.Model;
          readonly modelId: number;
          readonly seqId: number | undefined;
      };

type FrameSelection =
    | { readonly type: "all" }
    | { readonly type: "range"; readonly from: number; readonly to: number };

type Options = {
    readonly subject: Subject;
    readonly outDir: string;
    readonly background: number;
    readonly size: number;
    readonly view: View;
    readonly zoom: number;
    readonly frames: FrameSelection;
    readonly writeStrip: boolean;
};

const VALUE_OPTIONS = new Set([
    "gfx",
    "range",
    "npc",
    "model",
    "seq",
    "out",
    "bg",
    "size",
    "view",
    "zoom",
    "frames",
]);
const FLAG_OPTIONS = new Set(["strip", "no-strip"]);

function usageError(message: string): Error {
    return new Error(`${message}\n\n${USAGE}`);
}

function tokenize(argv: readonly string[]): Map<string, string> {
    const raw = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith("--")) {
            throw usageError(`Unexpected argument "${token}"`);
        }
        const name = token.slice(2);
        if (FLAG_OPTIONS.has(name)) {
            raw.set(name, "");
            continue;
        }
        if (!VALUE_OPTIONS.has(name)) {
            throw usageError(`Unknown option "${token}"`);
        }
        const value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
            throw usageError(`Option "${token}" needs a value`);
        }
        raw.set(name, value);
        i++;
    }
    return raw;
}

function parseInteger(name: string, value: string): number {
    if (!/^\d+$/.test(value)) {
        throw usageError(`--${name} expects a non-negative integer, got "${value}"`);
    }
    return Number(value);
}

function parseRange(name: string, value: string): { from: number; to: number } {
    const match = /^(\d+)-(\d+)$/.exec(value);
    if (!match) {
        throw usageError(`--${name} expects <from>-<to>, got "${value}"`);
    }
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (to < from) {
        throw usageError(`--${name} range is reversed: ${value}`);
    }
    return { from, to };
}

function parseSubject(raw: Map<string, string>): Subject {
    const given = ["gfx", "range", "npc", "model"].filter((name) => raw.has(name));
    if (given.length !== 1) {
        throw usageError("Give exactly one of --gfx, --range, --npc or --model");
    }
    const seq = raw.get("seq");
    const [kind] = given;
    if (kind === "gfx" || kind === "range") {
        if (seq !== undefined) {
            throw usageError("--seq only applies to --npc and --model");
        }
        if (kind === "gfx") {
            return { kind: SubjectKind.Gfx, ids: [parseInteger("gfx", raw.get("gfx")!)] };
        }
        const { from, to } = parseRange("range", raw.get("range")!);
        const ids = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        return { kind: SubjectKind.Gfx, ids };
    }
    if (kind === "npc") {
        if (seq === undefined) {
            throw usageError("--npc needs --seq <seqId>");
        }
        return {
            kind: SubjectKind.Npc,
            npcId: parseInteger("npc", raw.get("npc")!),
            seqId: parseInteger("seq", seq),
        };
    }
    return {
        kind: SubjectKind.Model,
        modelId: parseInteger("model", raw.get("model")!),
        seqId: seq === undefined ? undefined : parseInteger("seq", seq),
    };
}

function subjectName(subject: Subject): string {
    switch (subject.kind) {
        case SubjectKind.Gfx: {
            const first = subject.ids[0];
            const last = subject.ids[subject.ids.length - 1];
            return first === last ? `gfx-${first}` : `gfx-${first}-${last}`;
        }
        case SubjectKind.Npc:
            return `npc-${subject.npcId}-seq-${subject.seqId}`;
        case SubjectKind.Model:
            return subject.seqId === undefined
                ? `model-${subject.modelId}`
                : `model-${subject.modelId}-seq-${subject.seqId}`;
    }
}

function parseView(value: string): View {
    const views = Object.values(View);
    if (!views.includes(value as View)) {
        throw usageError(`--view expects one of ${views.join(", ")}, got "${value}"`);
    }
    return value as View;
}

function parseFrames(value: string): FrameSelection {
    if (value === "all") {
        return { type: "all" };
    }
    if (/^\d+$/.test(value)) {
        const index = Number(value);
        return { type: "range", from: index, to: index };
    }
    return { type: "range", ...parseRange("frames", value) };
}

function parseBackground(value: string): number {
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
        throw usageError(`--bg expects six hex digits, got "${value}"`);
    }
    return parseInt(value, 16);
}

function parseZoom(value: string): number {
    const zoom = Number(value);
    if (!Number.isFinite(zoom) || zoom <= 0) {
        throw usageError(`--zoom expects a positive number, got "${value}"`);
    }
    return zoom;
}

export function parseOptions(argv: readonly string[]): Options {
    const raw = tokenize(argv);
    if (raw.has("strip") && raw.has("no-strip")) {
        throw usageError("--strip and --no-strip are mutually exclusive");
    }
    const subject = parseSubject(raw);
    const size = raw.has("size") ? parseInteger("size", raw.get("size")!) : 256;
    if (size === 0) {
        throw usageError("--size must be at least 1");
    }
    return {
        subject,
        outDir: raw.get("out") ?? path.join("render-out", subjectName(subject)),
        background: raw.has("bg") ? parseBackground(raw.get("bg")!) : 0x000000,
        size,
        view: raw.has("view") ? parseView(raw.get("view")!) : View.Iso,
        zoom: raw.has("zoom") ? parseZoom(raw.get("zoom")!) : 1,
        frames: raw.has("frames") ? parseFrames(raw.get("frames")!) : { type: "all" },
        writeStrip: !raw.has("no-strip"),
    };
}

type Loaders = {
    readonly factory: ReturnType<typeof getCacheLoaderFactory>;
    readonly modelLoader: ModelLoader;
    readonly textureLoader: TextureLoader;
    readonly seqTypeLoader: SeqTypeLoader;
    readonly seqFrameLoader: SeqFrameLoader;
    readonly npcModelLoader: NpcModelLoader;
};

function openLoaders(): Loaders {
    const cacheList = loadCacheList(loadCacheInfos());
    const loadedCache = loadCache(cacheList.latest);
    const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);
    const factory = getCacheLoaderFactory(cacheList.latest, cacheSystem);
    const modelLoader = factory.getModelLoader();
    const textureLoader = factory.getTextureLoader();
    const seqTypeLoader = factory.getSeqTypeLoader();
    const seqFrameLoader = factory.getSeqFrameLoader();
    const npcModelLoader = new NpcModelLoader(
        factory.getNpcTypeLoader(),
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        factory.getSkeletalSeqLoader(),
        new VarManager(factory.getVarBitTypeLoader()),
    );
    return { factory, modelLoader, textureLoader, seqTypeLoader, seqFrameLoader, npcModelLoader };
}

// Every frame the game would bake for one subject, in sequence order, plus what to print.
type PosedSubject = {
    readonly label: string;
    readonly modelIds: readonly number[];
    readonly seqId: number;
    readonly frames: readonly Model[];
    readonly totalMs: number;
    readonly notes: readonly string[];
};

function frameDurationMs(seqType: SeqType, seqFrameLoader: SeqFrameLoader): number {
    if (seqType.isSkeletalSeq()) {
        return seqType.getSkeletalDuration() * CLIENT_TICK_MS;
    }
    let ticks = 0;
    for (let frame = 0; frame < seqType.frameIds.length; frame++) {
        ticks += seqType.getFrameLength(seqFrameLoader, frame);
    }
    return ticks * CLIENT_TICK_MS;
}

type PosedFrames = {
    readonly frames: readonly Model[];
    readonly totalMs: number;
    readonly notes: readonly string[];
};

// Poses a CPU copy per frame with Model.animate, the reference the game's GPU skinning
// (Skinning.addAnimation) matches; the game renders skeletal sequences at rest pose, so only the
// rest pose is shown for those.
function poseWithSequence(
    base: Model,
    seqType: SeqType,
    seqId: number,
    seqFrameLoader: SeqFrameLoader,
): PosedFrames {
    if (seqType.isSkeletalSeq()) {
        return {
            frames: [base],
            totalMs: 0,
            notes: [
                `skeletal sequence ${seqId}, ${seqType.getSkeletalDuration()} frames unavailable, rendering rest pose`,
            ],
        };
    }
    if (!seqType.frameIds || seqType.frameIds.length === 0) {
        throw new Error(`Sequence ${seqId} has no frames`);
    }
    const frames = seqType.frameIds.map((frameId) => {
        const seqFrame = seqFrameLoader.load(frameId);
        if (!seqFrame) {
            return base;
        }
        const posed = Model.copyAnimated(
            base,
            !seqFrame.hasAlphaTransform,
            !seqFrame.hasColorTransform,
        );
        posed.animate(seqFrame, undefined, seqType.op14);
        return posed;
    });
    return { frames, totalMs: frameDurationMs(seqType, seqFrameLoader), notes: [] };
}

// Ids without a model are ordinary in a range, so callers decide how to report them.
function loadSpotAnim(loaders: Loaders, gfxId: number): SpotAnimType | undefined {
    const spotAnimTypeLoader = loaders.factory.getSpotAnimTypeLoader();
    if (!spotAnimTypeLoader) {
        throw new Error("Spot animations are not available in this cache");
    }
    const spotAnim = spotAnimTypeLoader.load(gfxId);
    return typeof spotAnim.modelId === "number" ? spotAnim : undefined;
}

function poseGfx(loaders: Loaders, gfxId: number, spotAnim: SpotAnimType): PosedSubject {
    const modelData = loaders.modelLoader.getModel(spotAnim.modelId);
    if (!modelData) {
        throw new Error(`gfx ${gfxId}: model ${spotAnim.modelId} failed to load`);
    }
    const base = ModelData.merge([modelData], 1).light(
        loaders.textureLoader,
        spotAnim.ambient + 64,
        spotAnim.contrast + 768,
        SPOT_ANIM_LIGHT.x,
        SPOT_ANIM_LIGHT.y,
        SPOT_ANIM_LIGHT.z,
    );
    if (spotAnim.widthScale !== 128 || spotAnim.heightScale !== 128) {
        base.scale(spotAnim.widthScale, spotAnim.heightScale, spotAnim.widthScale);
    }
    const posed =
        spotAnim.sequenceId === -1
            ? { frames: [base], totalMs: 0, notes: [] }
            : poseWithSequence(
                  base,
                  loaders.seqTypeLoader.load(spotAnim.sequenceId),
                  spotAnim.sequenceId,
                  loaders.seqFrameLoader,
              );
    return {
        label: `gfx ${gfxId}`,
        modelIds: [spotAnim.modelId],
        seqId: spotAnim.sequenceId,
        ...posed,
    };
}

function poseNpc(loaders: Loaders, npcId: number, seqId: number): PosedSubject {
    const npcType = loaders.factory.getNpcTypeLoader().load(npcId);
    const seqType = loaders.seqTypeLoader.load(seqId);
    const frameCount = seqType.isSkeletalSeq()
        ? seqType.getSkeletalDuration()
        : seqType.frameIds?.length ?? 0;
    if (frameCount === 0) {
        throw new Error(`Sequence ${seqId} has no frames`);
    }
    const frames = Array.from({ length: frameCount }, (_, frame) => {
        const model = loaders.npcModelLoader.getModel(npcType, seqId, frame);
        if (!model) {
            throw new Error(`npc ${npcId} has no model for frame ${frame} of seq ${seqId}`);
        }
        return model;
    });
    return {
        label: `npc ${npcId} "${npcType.name}"`,
        modelIds: npcType.modelIds,
        seqId,
        frames,
        totalMs: frameDurationMs(seqType, loaders.seqFrameLoader),
        notes: [],
    };
}

function poseBareModel(loaders: Loaders, modelId: number, seqId: number | undefined): PosedSubject {
    const modelData = loaders.modelLoader.getModel(modelId);
    if (!modelData) {
        throw new Error(`model ${modelId} failed to load`);
    }
    const base = ModelData.merge([modelData], 1).light(
        loaders.textureLoader,
        BARE_MODEL_AMBIENT,
        BARE_MODEL_CONTRAST,
        SPOT_ANIM_LIGHT.x,
        SPOT_ANIM_LIGHT.y,
        SPOT_ANIM_LIGHT.z,
    );
    const posed =
        seqId === undefined
            ? { frames: [base], totalMs: 0, notes: [] }
            : poseWithSequence(
                  base,
                  loaders.seqTypeLoader.load(seqId),
                  seqId,
                  loaders.seqFrameLoader,
              );
    return { label: `model ${modelId}`, modelIds: [modelId], seqId: seqId ?? -1, ...posed };
}

function selectFrameIndices(selection: FrameSelection, frameCount: number): number[] {
    if (selection.type === "all") {
        return Array.from({ length: frameCount }, (_, i) => i);
    }
    if (selection.to >= frameCount) {
        throw new Error(
            `--frames ${selection.from}-${selection.to} is out of range, only ${frameCount} frames`,
        );
    }
    return Array.from({ length: selection.to - selection.from + 1 }, (_, i) => selection.from + i);
}

function renderSubject(
    loaders: Loaders,
    options: Options,
    posed: PosedSubject,
    outDir: string,
): void {
    const camera = fitCamera(
        options.view,
        unionExtent(posed.frames.map(modelExtent)),
        options.size,
        options.zoom,
    );
    const indices = selectFrameIndices(options.frames, posed.frames.length);
    fs.mkdirSync(outDir, { recursive: true });
    const images: RgbImage[] = [];
    for (const index of indices) {
        const image = renderModel(
            posed.frames[index],
            loaders.textureLoader,
            camera,
            options.size,
            options.background,
        );
        images.push(image);
        const name = `frame-${String(index).padStart(3, "0")}.png`;
        fs.writeFileSync(path.join(outDir, name), encodeRgbPng(image));
    }
    if (options.writeStrip) {
        fs.writeFileSync(path.join(outDir, "strip.png"), encodeRgbPng(concatHorizontally(images)));
    }
    for (const note of posed.notes) {
        console.log(`${posed.label}: ${note}`);
    }
    console.log(
        [
            `${posed.label}:`,
            `model ${posed.modelIds.join(",")}`,
            `seq ${posed.seqId === -1 ? "-" : posed.seqId},`,
            `${posed.frames.length} frames,`,
            `${posed.totalMs} ms`,
            `-> ${outDir}`,
        ].join(" "),
    );
}

function main(): void {
    const options = parseOptions(process.argv.slice(2));
    const loaders = openLoaders();
    const { subject } = options;
    switch (subject.kind) {
        case SubjectKind.Gfx: {
            const nested = subject.ids.length > 1;
            for (const gfxId of subject.ids) {
                const spotAnim = loadSpotAnim(loaders, gfxId);
                if (!spotAnim) {
                    console.log(`gfx ${gfxId}: no model`);
                    continue;
                }
                const outDir = nested ? path.join(options.outDir, `gfx-${gfxId}`) : options.outDir;
                renderSubject(loaders, options, poseGfx(loaders, gfxId, spotAnim), outDir);
            }
            return;
        }
        case SubjectKind.Npc:
            renderSubject(
                loaders,
                options,
                poseNpc(loaders, subject.npcId, subject.seqId),
                options.outDir,
            );
            return;
        case SubjectKind.Model:
            renderSubject(
                loaders,
                options,
                poseBareModel(loaders, subject.modelId, subject.seqId),
                options.outDir,
            );
            return;
    }
}

main();
