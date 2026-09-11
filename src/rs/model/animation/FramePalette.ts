import { COSINE, SINE } from "../../MathConstants";
import { Model } from "../Model";
import { SeqFrame } from "../seq/SeqFrame";
import { SeqTransformType } from "../seq/SeqTransformType";

export class AffineTransform {
    private constructor(private readonly values: Float64Array) {}

    static identity(): AffineTransform {
        return new AffineTransform(new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]));
    }

    static fromRows(values: readonly number[]): AffineTransform {
        if (values.length !== 12) {
            throw new Error(`An affine transform requires 12 values, received ${values.length}`);
        }
        return new AffineTransform(Float64Array.from(values));
    }

    transformPoint(x: number, y: number, z: number): [number, number, number] {
        const m = this.values;
        return [
            m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11],
        ];
    }

    toRows(): Float64Array {
        return new Float64Array(this.values);
    }

    then(next: AffineTransform): AffineTransform {
        const a = this.values;
        const b = next.values;
        const result = new Float64Array(12);
        for (let row = 0; row < 3; row++) {
            const r = row * 4;
            for (let column = 0; column < 3; column++) {
                result[r + column] =
                    b[r] * a[column] + b[r + 1] * a[4 + column] + b[r + 2] * a[8 + column];
            }
            result[r + 3] = b[r] * a[3] + b[r + 1] * a[7] + b[r + 2] * a[11] + b[r + 3];
        }
        return new AffineTransform(result);
    }
}

export interface VertexLabelStat {
    readonly positionSum: readonly [number, number, number];
    readonly vertexCount: number;
}

export class VertexLabelStats {
    constructor(readonly labels: readonly VertexLabelStat[]) {}

    static fromModel(model: Model): VertexLabelStats {
        const labels = model.vertexLabels.map((vertices) => {
            let sumX = 0;
            let sumY = 0;
            let sumZ = 0;
            for (const vertex of vertices) {
                sumX += model.verticesX[vertex];
                sumY += model.verticesY[vertex];
                sumZ += model.verticesZ[vertex];
            }
            return {
                positionSum: [sumX, sumY, sumZ] as const,
                vertexCount: vertices.length,
            };
        });
        return new VertexLabelStats(labels);
    }
}

export interface AlphaTransform {
    readonly delta: number;
    readonly lower: number;
    readonly upper: number;
}

export interface FramePalette {
    readonly matrices: readonly AffineTransform[];
    readonly alphaTransforms: readonly AlphaTransform[];
}

export function buildFramePalette(
    stats: VertexLabelStats,
    frame: SeqFrame,
    postTransform: AffineTransform,
): FramePalette {
    const labelCount = Math.max(
        stats.labels.length,
        ...frame.base.labels.flat().map((label) => label + 1),
    );
    let matrices = Array.from({ length: labelCount }, () => AffineTransform.identity());
    let alphaTransforms: AlphaTransform[] = Array.from({ length: labelCount }, () => ({
        delta: 0,
        lower: 0,
        upper: 255,
    }));
    let origin: [number, number, number] = [0, 0, 0];

    for (let index = 0; index < frame.transformCount; index++) {
        const group = frame.transformGroups[index];
        if (frame.base.masks[group] !== 0xffff) {
            continue;
        }
        const resetOriginGroup = frame.resetOriginGroups[index];
        if (resetOriginGroup !== -1) {
            origin = calculateOrigin(stats, matrices, frame.base.labels[resetOriginGroup], 0, 0, 0);
        }

        const labels = frame.base.labels[group];
        const x = frame.transformX[index];
        const y = frame.transformY[index];
        const z = frame.transformZ[index];
        switch (frame.base.types[group]) {
            case SeqTransformType.ORIGIN:
                origin = calculateOrigin(stats, matrices, labels, x, y, z);
                break;
            case SeqTransformType.TRANSLATE:
                matrices = applyToLabels(matrices, labels, translation(x, y, z));
                break;
            case SeqTransformType.ROTATE:
                matrices = applyToLabels(matrices, labels, rotationAbout(origin, x, y, z));
                break;
            case SeqTransformType.SCALE:
                matrices = applyToLabels(matrices, labels, scaleAbout(origin, x, y, z));
                break;
            case SeqTransformType.ALPHA:
                alphaTransforms = applyAlpha(alphaTransforms, labels, x * 8);
                break;
            case SeqTransformType.LIGHT:
                break;
            default:
                throw new Error(`Unsupported sequence transform type ${frame.base.types[group]}`);
        }
    }

    return {
        matrices: matrices.map((matrix) => matrix.then(postTransform)),
        alphaTransforms,
    };
}

function calculateOrigin(
    stats: VertexLabelStats,
    matrices: readonly AffineTransform[],
    labels: readonly number[],
    x: number,
    y: number,
    z: number,
): [number, number, number] {
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;
    for (const label of labels) {
        const stat = stats.labels[label];
        if (!stat || stat.vertexCount === 0) {
            continue;
        }
        const transformed = matrices[label].transformPoint(...stat.positionSum);
        const translation = matrices[label].transformPoint(0, 0, 0);
        sumX += transformed[0] + translation[0] * (stat.vertexCount - 1);
        sumY += transformed[1] + translation[1] * (stat.vertexCount - 1);
        sumZ += transformed[2] + translation[2] * (stat.vertexCount - 1);
        count += stat.vertexCount;
    }
    if (count === 0) {
        return [x, y, z];
    }
    return [
        x + Math.trunc(sumX / count),
        y + Math.trunc(sumY / count),
        z + Math.trunc(sumZ / count),
    ];
}

function applyToLabels(
    matrices: readonly AffineTransform[],
    labels: readonly number[],
    transform: AffineTransform,
): AffineTransform[] {
    const result = [...matrices];
    for (const label of labels) {
        result[label] = result[label].then(transform);
    }
    return result;
}

function applyAlpha(
    transforms: readonly AlphaTransform[],
    labels: readonly number[],
    delta: number,
): AlphaTransform[] {
    const result = [...transforms];
    for (const label of labels) {
        const transform = result[label];
        result[label] = {
            delta: transform.delta + delta,
            lower: clampAlpha(transform.lower + delta),
            upper: clampAlpha(transform.upper + delta),
        };
    }
    return result;
}

function clampAlpha(alpha: number): number {
    return Math.max(0, Math.min(255, alpha));
}

function translation(x: number, y: number, z: number): AffineTransform {
    return AffineTransform.fromRows([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]);
}

function scaleAbout(origin: readonly number[], x: number, y: number, z: number): AffineTransform {
    const sx = x / 128;
    const sy = y / 128;
    const sz = z / 128;
    return AffineTransform.fromRows([
        sx,
        0,
        0,
        origin[0] * (1 - sx),
        0,
        sy,
        0,
        origin[1] * (1 - sy),
        0,
        0,
        sz,
        origin[2] * (1 - sz),
    ]);
}

function rotationAbout(
    origin: readonly number[],
    x: number,
    y: number,
    z: number,
): AffineTransform {
    const rotation = rotationAtOrigin(x, y, z);
    return translation(-origin[0], -origin[1], -origin[2])
        .then(rotation)
        .then(translation(origin[0], origin[1], origin[2]));
}

function rotationAtOrigin(x: number, y: number, z: number): AffineTransform {
    const angleX = (x & 0xff) * 8;
    const angleY = (y & 0xff) * 8;
    const angleZ = (z & 0xff) * 8;
    const sx = SINE[angleX] / 65536;
    const cx = COSINE[angleX] / 65536;
    const sy = SINE[angleY] / 65536;
    const cy = COSINE[angleY] / 65536;
    const sz = SINE[angleZ] / 65536;
    const cz = COSINE[angleZ] / 65536;
    const roll = AffineTransform.fromRows([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0]);
    const pitch = AffineTransform.fromRows([1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0]);
    const yaw = AffineTransform.fromRows([cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0]);
    return roll.then(pitch).then(yaw);
}
