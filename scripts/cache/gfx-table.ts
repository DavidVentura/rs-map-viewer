import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { ModelData } from "../../src/rs/model/ModelData";
import { SeqFrameLoader } from "../../src/rs/model/seq/SeqFrameLoader";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

type GfxRange = { from: number; to: number };

function parseArgs(): GfxRange {
    const [rangeArg] = process.argv.slice(2);
    const match = /^(\d+)-(\d+)$/.exec(rangeArg ?? "");
    if (!match) {
        throw new Error("Usage: gfx-table.ts <from>-<to>, e.g. 440-460");
    }
    return { from: Number(match[1]), to: Number(match[2]) };
}

type HslColor = { hue: number; saturation: number; lightness: number };

// Standard OSRS packed HSL16: 6 bits hue, 3 bits saturation, 7 bits lightness (see
// src/rs/util/ColorUtil.ts's packHsl/mixHsl for the same layout), rescaled to conventional
// degrees/percent for display.
function unpackHsl(packed: number): HslColor {
    const hue6 = (packed >> 10) & 0x3f;
    const sat3 = (packed >> 7) & 0x7;
    const light7 = packed & 0x7f;
    return {
        hue: Math.round((hue6 * 360) / 64),
        saturation: Math.round((sat3 * 100) / 7),
        lightness: Math.round((light7 * 100) / 127),
    };
}

function formatHsl(color: HslColor): string {
    return `(${color.hue}°, ${color.saturation}%, ${color.lightness}%)`;
}

// The model's own raw per-face palette (pre-lighting), so repeated faces of the same colour
// actually collide in the histogram instead of being smeared apart by per-vertex shading. Faces
// that carry a texture instead of a flat colour (faceColors holds an unrelated sentinel for those,
// see ModelData's decode) are excluded.
function topFaceColors(modelData: ModelData, count: number): HslColor[] {
    const counts = new Map<number, number>();
    for (let i = 0; i < modelData.faceCount; i++) {
        if (modelData.faceTextures && modelData.faceTextures[i] !== -1) {
            continue;
        }
        const packed = modelData.faceColors[i] & 0xffff;
        counts.set(packed, (counts.get(packed) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([packed]) => unpackHsl(packed));
}

type GfxRow = {
    gfxId: number;
    modelId?: number;
    seqId?: number;
    frameCount: number;
    totalMs: number;
    topColors: HslColor[];
};

function describeGfx(
    gfxId: number,
    factory: ReturnType<typeof getCacheLoaderFactory>,
    seqFrameLoader: SeqFrameLoader,
): GfxRow {
    const spotAnimTypeLoader = factory.getSpotAnimTypeLoader();
    if (!spotAnimTypeLoader) {
        throw new Error("Spot animations are not available in this cache");
    }
    const spotAnim = spotAnimTypeLoader.load(gfxId);
    if (typeof spotAnim.modelId !== "number") {
        return { gfxId, frameCount: 0, totalMs: 0, topColors: [] };
    }

    const modelData = factory.getModelLoader().getModel(spotAnim.modelId);
    const topColors = modelData ? topFaceColors(modelData, 3) : [];

    if (spotAnim.sequenceId === -1) {
        return { gfxId, modelId: spotAnim.modelId, frameCount: 1, totalMs: 0, topColors };
    }

    const seqType = factory.getSeqTypeLoader().load(spotAnim.sequenceId);
    const frameCount = seqType.frameIds?.length ?? 0;
    let totalTicks = 0;
    for (let frame = 0; frame < frameCount; frame++) {
        totalTicks += seqType.getFrameLength(seqFrameLoader, frame);
    }
    return {
        gfxId,
        modelId: spotAnim.modelId,
        seqId: spotAnim.sequenceId,
        frameCount,
        totalMs: totalTicks * 20,
        topColors,
    };
}

function main(): void {
    const range = parseArgs();
    const cacheList = loadCacheList(loadCacheInfos());
    const loadedCache = loadCache(cacheList.latest);
    const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);
    const factory = getCacheLoaderFactory(cacheList.latest, cacheSystem);
    const seqFrameLoader = factory.getSeqFrameLoader();

    console.log(`viewer: ?gfx=${range.from}-${range.to}`);
    console.log("gfx    model  seq    frames  ms    top colours");
    for (let gfxId = range.from; gfxId <= range.to; gfxId++) {
        const row = describeGfx(gfxId, factory, seqFrameLoader);
        const colours = row.topColors.map(formatHsl).join(" ") || "-";
        if (row.modelId === undefined) {
            console.log(`${String(row.gfxId).padEnd(6)} no model`);
            continue;
        }
        console.log(
            [
                String(row.gfxId).padEnd(6),
                String(row.modelId).padEnd(6),
                String(row.seqId ?? "-").padEnd(6),
                String(row.frameCount).padStart(6),
                String(row.totalMs).padStart(5),
                `  ${colours}`,
            ].join(" "),
        );
    }
}

main();
