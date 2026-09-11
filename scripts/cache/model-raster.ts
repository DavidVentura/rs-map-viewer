import { Rasterizer2D } from "../../src/rs/graphics/Rasterizer2D";
import { Rasterizer3D } from "../../src/rs/graphics/Rasterizer3D";
import { Model } from "../../src/rs/model/Model";
import { ModelData } from "../../src/rs/model/ModelData";
import { TextureLoader } from "../../src/rs/texture/TextureLoader";
import { RgbImage } from "./png";

export enum View {
    Front = "front",
    Iso = "iso",
    Top = "top",
}

const VIEW_PITCH_RADIANS: Record<View, number> = {
    [View.Front]: 0,
    [View.Iso]: Math.PI / 4,
    [View.Top]: Math.PI / 2,
};

// Model space has y pointing down and z pointing north (the client's convention), so the top of
// a model is at minY.
export type ModelExtent = {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly minZ: number;
    readonly maxZ: number;
};

export function modelExtent(model: Model): ModelExtent {
    model.calculateBounds();
    return {
        minX: model.minX,
        maxX: model.maxX,
        minY: model.minY,
        maxY: model.maxY,
        minZ: model.minZ,
        maxZ: model.maxZ,
    };
}

export function unionExtent(extents: readonly ModelExtent[]): ModelExtent {
    if (extents.length === 0) {
        throw new Error("Cannot fit a camera to zero frames");
    }
    return extents.reduce((acc, extent) => ({
        minX: Math.min(acc.minX, extent.minX),
        maxX: Math.max(acc.maxX, extent.maxX),
        minY: Math.min(acc.minY, extent.minY),
        maxY: Math.max(acc.maxY, extent.maxY),
        minZ: Math.min(acc.minZ, extent.minZ),
        maxZ: Math.max(acc.maxZ, extent.maxZ),
    }));
}

export type Camera = {
    readonly pitchRadians: number;
    readonly yawRadians: number;
    readonly distance: number;
    readonly focal: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly centerZ: number;
};

const FIT_FILL = 0.9;
const DISTANCE_RADII = 4;

type ViewPoint = {
    readonly viewX: number;
    readonly viewY: number;
    readonly depth: number;
};

function toViewSpace(camera: Camera, x: number, y: number, z: number): ViewPoint {
    const dx = x - camera.centerX;
    const dy = y - camera.centerY;
    const dz = z - camera.centerZ;
    const sinYaw = Math.sin(camera.yawRadians);
    const cosYaw = Math.cos(camera.yawRadians);
    const sinPitch = Math.sin(camera.pitchRadians);
    const cosPitch = Math.cos(camera.pitchRadians);
    const rotatedX = dx * cosYaw + dz * sinYaw;
    const rotatedZ = dz * cosYaw - dx * sinYaw;
    return {
        viewX: rotatedX,
        viewY: dy * cosPitch - rotatedZ * sinPitch,
        depth: camera.distance + dy * sinPitch + rotatedZ * cosPitch,
    };
}

// Every frame of an animation shares one camera, fitted so the union of the frames' bounding
// boxes projects inside the image; zoom is a multiplier on top of that fit.
export function fitCamera(view: View, extent: ModelExtent, size: number, zoom: number): Camera {
    const spanX = extent.maxX - extent.minX;
    const spanY = extent.maxY - extent.minY;
    const spanZ = extent.maxZ - extent.minZ;
    const radius = Math.max(1, Math.sqrt(spanX ** 2 + spanY ** 2 + spanZ ** 2) / 2);
    const unfitted: Camera = {
        pitchRadians: VIEW_PITCH_RADIANS[view],
        yawRadians: 0,
        distance: radius * DISTANCE_RADII,
        focal: 1,
        centerX: (extent.minX + extent.maxX) / 2,
        centerY: (extent.minY + extent.maxY) / 2,
        centerZ: (extent.minZ + extent.maxZ) / 2,
    };
    const corners = [extent.minX, extent.maxX].flatMap((x) =>
        [extent.minY, extent.maxY].flatMap((y) =>
            [extent.minZ, extent.maxZ].map((z) => toViewSpace(unfitted, x, y, z)),
        ),
    );
    const widest = Math.max(
        ...corners.map(
            (corner) => Math.max(Math.abs(corner.viewX), Math.abs(corner.viewY)) / corner.depth,
        ),
    );
    return { ...unfitted, focal: ((size / 2) * FIT_FILL * zoom) / Math.max(widest, 1e-6) };
}

type ProjectedVertices = {
    readonly screenX: Int32Array;
    readonly screenY: Int32Array;
    readonly depth: Int32Array;
};

function projectVertices(model: Model, camera: Camera, size: number): ProjectedVertices {
    const count = model.usedVertexCount;
    const screenX = new Int32Array(count);
    const screenY = new Int32Array(count);
    const depth = new Int32Array(count);
    const half = size / 2;
    for (let i = 0; i < count; i++) {
        const point = toViewSpace(
            camera,
            model.verticesX[i],
            model.verticesY[i],
            model.verticesZ[i],
        );
        screenX[i] = (half + (camera.focal * point.viewX) / point.depth) | 0;
        screenY[i] = (half + (camera.focal * point.viewY) / point.depth) | 0;
        depth[i] = point.depth | 0;
    }
    return { screenX, screenY, depth };
}

// The client's face depth: mean vertex depth, with back faces (clockwise on screen) culled by
// returning -1.
function faceDepths(model: Model, projected: ProjectedVertices): Int32Array {
    const depths = new Int32Array(model.faceCount);
    for (let f = 0; f < model.faceCount; f++) {
        const a = model.indices1[f];
        const b = model.indices2[f];
        const c = model.indices3[f];
        const { screenX, screenY, depth } = projected;
        const winding =
            (screenX[a] - screenX[b]) * (screenY[c] - screenY[b]) -
            (screenY[a] - screenY[b]) * (screenX[c] - screenX[b]);
        if (winding <= 0 || model.faceColors3[f] === -2) {
            depths[f] = -1;
            continue;
        }
        depths[f] = ((depth[a] + depth[b] + depth[c]) / 3) | 0;
    }
    return depths;
}

function bucketByDepth(depths: Int32Array): number[][] {
    let maxDepth = 0;
    for (const depth of depths) {
        maxDepth = Math.max(maxDepth, depth);
    }
    const buckets: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (let f = 0; f < depths.length; f++) {
        if (depths[f] >= 0) {
            buckets[depths[f]].push(f);
        }
    }
    return buckets;
}

const PRIORITY_COUNT = 12;
const NO_MORE_FACES = -1000;

// The client's draw ordering: far-to-near painter's order, except that faces with render
// priorities are grouped by priority and priorities 10/11 are interleaved by depth relative to
// the average depth of certain priority groups.
export function orderFaces(model: Model, depths: Int32Array): number[] {
    const buckets = bucketByDepth(depths);
    const farToNear = buckets.flatMap((_, i) => buckets[buckets.length - 1 - i]);
    if (!model.faceRenderPriorities) {
        return farToNear;
    }
    const priorities = model.faceRenderPriorities;
    const byPriority: number[][] = Array.from({ length: PRIORITY_COUNT }, () => []);
    const depthSum = new Array<number>(PRIORITY_COUNT).fill(0);
    const depths10: number[] = [];
    const depths11: number[] = [];
    for (const face of farToNear) {
        const priority = priorities[face];
        byPriority[priority].push(face);
        if (priority < 10) {
            depthSum[priority] += depths[face];
        } else if (priority === 10) {
            depths10.push(depths[face]);
        } else {
            depths11.push(depths[face]);
        }
    }
    const averageDepth = (p: number, q: number): number => {
        const count = byPriority[p].length + byPriority[q].length;
        return count === 0 ? 0 : ((depthSum[p] + depthSum[q]) / count) | 0;
    };
    const threshold = [averageDepth(1, 2), averageDepth(3, 4), averageDepth(6, 8)];

    const ordered: number[] = [];
    let queue = byPriority[10];
    let queueDepths = depths10;
    if (queue.length === 0) {
        queue = byPriority[11];
        queueDepths = depths11;
    }
    let cursor = 0;
    let nextDepth = queue.length > 0 ? queueDepths[0] : NO_MORE_FACES;
    const drainWhile = (limit: number): void => {
        while (nextDepth > limit) {
            ordered.push(queue[cursor++]);
            if (cursor === queue.length && queue !== byPriority[11]) {
                cursor = 0;
                queue = byPriority[11];
                queueDepths = depths11;
            }
            nextDepth = cursor < queue.length ? queueDepths[cursor] : NO_MORE_FACES;
        }
    };
    for (let priority = 0; priority < 10; priority++) {
        if (priority === 0) {
            drainWhile(threshold[0]);
        }
        if (priority === 3) {
            drainWhile(threshold[1]);
        }
        if (priority === 5) {
            drainWhile(threshold[2]);
        }
        ordered.push(...byPriority[priority]);
    }
    drainWhile(NO_MORE_FACES);
    return ordered;
}

type FaceShade = {
    readonly hsl1: number;
    readonly hsl2: number;
    readonly hsl3: number;
};

// Textured faces carry per-vertex lightness rather than a colour; shade them with the texture's
// average colour the way the client's low-memory path does.
function faceShade(model: Model, textureLoader: TextureLoader, face: number): FaceShade {
    const textureId = model.faceTextures ? model.faceTextures[face] : -1;
    const flat = model.faceColors3[face] === -1;
    if (textureId === -1) {
        const hsl1 = model.faceColors1[face] & 0xffff;
        if (flat) {
            return { hsl1, hsl2: hsl1, hsl3: hsl1 };
        }
        return {
            hsl1,
            hsl2: model.faceColors2[face] & 0xffff,
            hsl3: model.faceColors3[face] & 0xffff,
        };
    }
    const average = textureLoader.getAverageHsl(textureId);
    const hsl1 = ModelData.adjustLightness(average, model.faceColors1[face]);
    if (flat) {
        return { hsl1, hsl2: hsl1, hsl3: hsl1 };
    }
    return {
        hsl1,
        hsl2: ModelData.adjustLightness(average, model.faceColors2[face]),
        hsl3: ModelData.adjustLightness(average, model.faceColors3[face]),
    };
}

export function renderModel(
    model: Model,
    textureLoader: TextureLoader,
    camera: Camera,
    size: number,
    background: number,
): RgbImage {
    const pixels = new Int32Array(size * size).fill(background);
    Rasterizer2D.setRaster(pixels, size, size);
    Rasterizer3D.setClip();
    Rasterizer3D.rasterGouraudLowRes = false;
    Rasterizer3D.rasterClipEnable = true;

    const projected = projectVertices(model, camera, size);
    const order = orderFaces(model, faceDepths(model, projected));
    for (const face of order) {
        const a = model.indices1[face];
        const b = model.indices2[face];
        const c = model.indices3[face];
        const shade = faceShade(model, textureLoader, face);
        Rasterizer3D.rasterAlpha = model.faceAlphas ? model.faceAlphas[face] & 0xff : 0;
        Rasterizer3D.rasterGouraud(
            projected.screenY[a],
            projected.screenY[b],
            projected.screenY[c],
            projected.screenX[a],
            projected.screenX[b],
            projected.screenX[c],
            shade.hsl1,
            shade.hsl2,
            shade.hsl3,
        );
    }
    Rasterizer3D.rasterAlpha = 0;
    return { width: size, height: size, pixels };
}
