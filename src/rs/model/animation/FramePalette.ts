import { COSINE, SINE } from "../../MathConstants";
import { Model } from "../Model";
import { SeqFrame } from "../seq/SeqFrame";
import { SeqTransformType } from "../seq/SeqTransformType";

const AFFINE_VALUES = 12;

export class AffineTransform {
    private constructor(private readonly values: Float64Array) {}

    static identity(): AffineTransform {
        return new AffineTransform(new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]));
    }

    static fromRows(values: readonly number[]): AffineTransform {
        if (values.length !== AFFINE_VALUES) {
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
        const result = new Float64Array(AFFINE_VALUES);
        compose(this.values, 0, next.values, 0, result, 0);
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
        const labels = (model.vertexLabels ?? []).map((vertices) => {
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

    transformed(transform: AffineTransform): VertexLabelStats {
        const rows = transform.toRows();
        return new VertexLabelStats(
            this.labels.map(({ positionSum, vertexCount }) => ({
                positionSum: transformSum(rows, 0, positionSum, vertexCount),
                vertexCount,
            })),
        );
    }
}

// Frames pose a model in the space its sequence was authored in, which can differ from the space
// its rest mesh is stored in: a loc is stored rotated to its orientation but animated unrotated,
// and an npc is animated before its width/height scale is applied.
export class PoseSpace {
    private constructor(
        readonly toPose: AffineTransform,
        readonly fromPose: AffineTransform,
    ) {}

    static identity(): PoseSpace {
        return new PoseSpace(AffineTransform.identity(), AffineTransform.identity());
    }

    static between(toPose: AffineTransform, fromPose: AffineTransform): PoseSpace {
        return new PoseSpace(toPose, fromPose);
    }

    restTransform(): AffineTransform {
        return this.toPose.then(this.fromPose);
    }
}

export interface AlphaTransform {
    readonly delta: number;
    readonly lower: number;
    readonly upper: number;
}

const UNCHANGED_ALPHA: AlphaTransform = { delta: 0, lower: 0, upper: 255 };

export interface FramePalette {
    readonly matrices: Float64Array;
    readonly alphaTransforms: readonly AlphaTransform[];
}

// Matrices map rest-mesh positions straight to posed positions: into the pose space, through the
// frame, and back out.
//
// While a frame's operations run, only the labels it moves carry a matrix. Every other label is
// still at its pose-space rest position, which is all an origin needs from it, and ends at the rest
// transform; that includes labels no frame names at all.
export class FramePoser {
    private readonly poseStats: VertexLabelStats;
    private readonly toPose: Float64Array;
    private readonly fromPose: Float64Array;
    private readonly restRows: Float64Array;
    private readonly alphaIndices: ReadonlyMap<number, number>;

    constructor(
        restStats: VertexLabelStats,
        space: PoseSpace,
        private readonly matrixLabels: readonly number[],
        private readonly alphaLabels: readonly number[],
    ) {
        this.poseStats = restStats.transformed(space.toPose);
        this.toPose = space.toPose.toRows();
        this.fromPose = space.fromPose.toRows();
        this.restRows = space.restTransform().toRows();
        this.alphaIndices = new Map(alphaLabels.map((label, index) => [label, index]));
        if (this.alphaIndices.size !== alphaLabels.length) {
            throw new Error(`Alpha labels must be unique, received ${alphaLabels.join(", ")}`);
        }
    }

    rest(): FramePalette {
        const matrices = new Float64Array(this.matrixLabels.length * AFFINE_VALUES);
        for (let index = 0; index < this.matrixLabels.length; index++) {
            matrices.set(this.restRows, index * AFFINE_VALUES);
        }
        return { matrices, alphaTransforms: this.alphaLabels.map(() => UNCHANGED_ALPHA) };
    }

    pose(frame: SeqFrame): FramePalette {
        const slots = movedLabelSlots(frame);
        const moved = identities(slots.count);
        const operation = new Float64Array(OPERATION_SCRATCH_VALUES);
        const alphaTransforms = this.alphaLabels.map(() => UNCHANGED_ALPHA);
        let origin: [number, number, number] = [0, 0, 0];

        for (let index = 0; index < frame.transformCount; index++) {
            const group = frame.transformGroups[index];
            const resetOriginGroup = frame.resetOriginGroups[index];
            if (resetOriginGroup !== -1 && frame.base.masks[resetOriginGroup] === 0xffff) {
                origin = this.origin(slots, moved, frame.base.labels[resetOriginGroup], 0, 0, 0);
            }
            if (frame.base.masks[group] !== 0xffff) {
                continue;
            }

            const labels = frame.base.labels[group];
            const x = frame.transformX[index];
            const y = frame.transformY[index];
            const z = frame.transformZ[index];
            switch (frame.base.types[group]) {
                case SeqTransformType.ORIGIN:
                    origin = this.origin(slots, moved, labels, x, y, z);
                    break;
                case SeqTransformType.TRANSLATE:
                    writeTranslation(operation, 0, x, y, z);
                    applyToLabels(slots, moved, labels, operation);
                    break;
                case SeqTransformType.ROTATE:
                    writeRotationAbout(operation, origin, x, y, z);
                    applyToLabels(slots, moved, labels, operation);
                    break;
                case SeqTransformType.SCALE:
                    writeScaleAbout(operation, origin, x, y, z);
                    applyToLabels(slots, moved, labels, operation);
                    break;
                case SeqTransformType.ALPHA:
                    this.applyAlpha(alphaTransforms, labels, x * 8);
                    break;
                case SeqTransformType.LIGHT:
                    break;
                default:
                    throw new Error(
                        `Unsupported sequence transform type ${frame.base.types[group]}`,
                    );
            }
        }

        const matrices = new Float64Array(this.matrixLabels.length * AFFINE_VALUES);
        const intoPose = new Float64Array(AFFINE_VALUES);
        this.matrixLabels.forEach((label, index) => {
            const slot = slots.of(label);
            if (slot === UNMOVED) {
                matrices.set(this.restRows, index * AFFINE_VALUES);
                return;
            }
            compose(this.toPose, 0, moved, slot * AFFINE_VALUES, intoPose, 0);
            compose(intoPose, 0, this.fromPose, 0, matrices, index * AFFINE_VALUES);
        });
        return { matrices, alphaTransforms };
    }

    private origin(
        slots: LabelSlots,
        moved: Float64Array,
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
            const stat = this.poseStats.labels[label];
            if (!stat || stat.vertexCount === 0) {
                continue;
            }
            const slot = slots.of(label);
            const [x, y, z] =
                slot === UNMOVED
                    ? stat.positionSum
                    : transformSum(moved, slot * AFFINE_VALUES, stat.positionSum, stat.vertexCount);
            sumX += x;
            sumY += y;
            sumZ += z;
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

    private applyAlpha(
        transforms: AlphaTransform[],
        labels: readonly number[],
        delta: number,
    ): void {
        for (const label of labels) {
            const index = this.alphaIndices.get(label);
            if (index === undefined) {
                continue;
            }
            const transform = transforms[index];
            transforms[index] = {
                delta: transform.delta + delta,
                lower: clampAlpha(transform.lower + delta),
                upper: clampAlpha(transform.upper + delta),
            };
        }
    }
}

const UNMOVED = -1;

// Each label a frame moves gets a slot of 12 values in one scratch buffer, so its matrix is
// updated in place by every operation instead of reallocated.
class LabelSlots {
    constructor(
        private readonly slotByLabel: Int32Array,
        readonly count: number,
    ) {}

    of(label: number): number {
        if (label < 0 || label >= this.slotByLabel.length) {
            return UNMOVED;
        }
        return this.slotByLabel[label];
    }
}

function movedLabelSlots(frame: SeqFrame): LabelSlots {
    let maxLabel = -1;
    forEachMovedLabel(frame, (label) => {
        maxLabel = Math.max(maxLabel, label);
    });
    const slotByLabel = new Int32Array(maxLabel + 1).fill(UNMOVED);
    let count = 0;
    forEachMovedLabel(frame, (label) => {
        if (slotByLabel[label] === UNMOVED) {
            slotByLabel[label] = count++;
        }
    });
    return new LabelSlots(slotByLabel, count);
}

function forEachMovedLabel(frame: SeqFrame, visit: (label: number) => void): void {
    for (let index = 0; index < frame.transformCount; index++) {
        const group = frame.transformGroups[index];
        if (frame.base.masks[group] !== 0xffff) {
            continue;
        }
        const type = frame.base.types[group];
        if (
            type !== SeqTransformType.TRANSLATE &&
            type !== SeqTransformType.ROTATE &&
            type !== SeqTransformType.SCALE
        ) {
            continue;
        }
        for (const label of frame.base.labels[group]) {
            visit(label);
        }
    }
}

function identities(count: number): Float64Array {
    const matrices = new Float64Array(count * AFFINE_VALUES);
    for (let offset = 0; offset < matrices.length; offset += AFFINE_VALUES) {
        matrices[offset] = 1;
        matrices[offset + 5] = 1;
        matrices[offset + 10] = 1;
    }
    return matrices;
}

function applyToLabels(
    slots: LabelSlots,
    moved: Float64Array,
    labels: readonly number[],
    operation: Float64Array,
): void {
    for (const label of labels) {
        const slot = slots.of(label);
        if (slot === UNMOVED) {
            throw new Error(`Label ${label} is moved but has no matrix slot`);
        }
        compose(moved, slot * AFFINE_VALUES, operation, 0, moved, slot * AFFINE_VALUES);
    }
}

// Writes `first` followed by `second` into `out`. Each column of `first` is read in full before
// that column of `out` is written, so `out` may alias `first` but not `second`.
function compose(
    first: Float64Array,
    firstOffset: number,
    second: Float64Array,
    secondOffset: number,
    out: Float64Array,
    outOffset: number,
): void {
    for (let column = 0; column < 4; column++) {
        const a0 = first[firstOffset + column];
        const a1 = first[firstOffset + 4 + column];
        const a2 = first[firstOffset + 8 + column];
        for (let row = 0; row < 3; row++) {
            const r = secondOffset + row * 4;
            const value = second[r] * a0 + second[r + 1] * a1 + second[r + 2] * a2;
            out[outOffset + row * 4 + column] = column === 3 ? value + second[r + 3] : value;
        }
    }
}

// The sum of `count` transformed points: the linear part applies to the sum once, the translation
// once per point.
function transformSum(
    rows: Float64Array,
    offset: number,
    sum: readonly [number, number, number],
    count: number,
): [number, number, number] {
    const [x, y, z] = sum;
    const result: [number, number, number] = [0, 0, 0];
    for (let row = 0; row < 3; row++) {
        const r = offset + row * 4;
        const translation = rows[r + 3];
        result[row] =
            rows[r] * x +
            rows[r + 1] * y +
            rows[r + 2] * z +
            translation +
            translation * (count - 1);
    }
    return result;
}

function clampAlpha(alpha: number): number {
    return Math.max(0, Math.min(255, alpha));
}

// The operation's transform goes in the first 12 values; a rotation builds its factors in the
// three slots after it.
const OPERATION_SCRATCH_VALUES = AFFINE_VALUES * 4;

type AffineRows = readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
];

function writeRows(out: Float64Array, offset: number, rows: AffineRows): void {
    for (let index = 0; index < AFFINE_VALUES; index++) {
        out[offset + index] = rows[index];
    }
}

function writeTranslation(
    out: Float64Array,
    offset: number,
    x: number,
    y: number,
    z: number,
): void {
    writeRows(out, offset, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]);
}

function writeScaleAbout(
    out: Float64Array,
    origin: readonly number[],
    x: number,
    y: number,
    z: number,
): void {
    const sx = x / 128;
    const sy = y / 128;
    const sz = z / 128;
    writeRows(out, 0, [
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

function writeRotationAbout(
    scratch: Float64Array,
    origin: readonly number[],
    x: number,
    y: number,
    z: number,
): void {
    const a = AFFINE_VALUES;
    const b = AFFINE_VALUES * 2;
    const c = AFFINE_VALUES * 3;
    const angleX = (x & 0xff) * 8;
    const angleY = (y & 0xff) * 8;
    const angleZ = (z & 0xff) * 8;
    const sx = SINE[angleX] / 65536;
    const cx = COSINE[angleX] / 65536;
    const sy = SINE[angleY] / 65536;
    const cy = COSINE[angleY] / 65536;
    const sz = SINE[angleZ] / 65536;
    const cz = COSINE[angleZ] / 65536;
    writeRows(scratch, a, [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0]);
    writeRows(scratch, b, [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0]);
    compose(scratch, a, scratch, b, scratch, c);
    writeRows(scratch, a, [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0]);
    compose(scratch, c, scratch, a, scratch, b);
    writeTranslation(scratch, a, -origin[0], -origin[1], -origin[2]);
    compose(scratch, a, scratch, b, scratch, c);
    writeTranslation(scratch, a, origin[0], origin[1], origin[2]);
    compose(scratch, c, scratch, a, scratch, 0);
}
