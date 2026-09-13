import { Model } from "../../../rs/model/Model";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { DrawRange, newDrawRange } from "../DrawRange";
import { packVertex } from "../buffer/VertexBuffer";
import { SkinInfluence, SkinModelBinding, SkinRig } from "./SkinRig";

const MAX_INFLUENCE_START = 2 ** 20 - 1;
const MAX_INFLUENCE_COUNT = 16;

export interface SkinnedMesh {
    readonly opaque: DrawRange;
    readonly transparent: DrawRange;
}

export interface SkinnedMeshData {
    readonly vertices: Uint8Array;
    readonly indices: Int32Array;
    readonly influences: Uint32Array;
    readonly usedTextureIds: ReadonlySet<number>;
}

export class SkinFaceSelection {
    private constructor(readonly firstFace: number) {}

    static all(): SkinFaceSelection {
        return new SkinFaceSelection(0);
    }

    static startingAt(firstFace: number): SkinFaceSelection {
        if (!Number.isInteger(firstFace) || firstFace < 0) {
            throw new Error(`Invalid first actor face ${firstFace}`);
        }
        return new SkinFaceSelection(firstFace);
    }
}

export class SkinnedMeshBuilder {
    private readonly vertexWords: number[] = [];
    private readonly indices: number[] = [];
    private readonly influences: number[] = [];
    private readonly influenceLists = new Map<string, number>();
    private readonly vertices = new Map<string, number>();
    private readonly usedTextureIds = new Set<number>();

    constructor(
        private readonly textureLoader: TextureLoader,
        private readonly textureIdIndexMap: ReadonlyMap<number, number>,
    ) {}

    addModel(model: Model, rig: SkinRig, selection: SkinFaceSelection): SkinnedMesh {
        if (selection.firstFace > model.faceCount) {
            throw new Error(`First actor face ${selection.firstFace} exceeds ${model.faceCount}`);
        }
        const binding = rig.bind(model);
        const opaqueFaces: number[] = [];
        const transparentFaces: number[] = [];
        for (let face = selection.firstFace; face < model.faceCount; face++) {
            if (model.faceColors3[face] === -2) {
                continue;
            }
            const textureId = model.faceTextures?.[face] ?? -1;
            const alphaLabel = textureId === -1 ? binding.faceAlphaIndex(face) : 0;
            const alpha = textureId === -1 ? 0xff - (model.faceAlphas?.[face] & 0xff) : 0xff;
            if ((alpha === 0 || alpha === 1) && alphaLabel === 0) {
                continue;
            }
            const isTransparent =
                alphaLabel !== 0 ||
                alpha < 0xff ||
                (textureId !== -1 && this.textureLoader.isTransparent(textureId));
            (isTransparent ? transparentFaces : opaqueFaces).push(face);
        }
        return {
            opaque: this.addFaces(model, binding, opaqueFaces),
            transparent: this.addFaces(model, binding, transparentFaces),
        };
    }

    build(): SkinnedMeshData {
        const words = Uint32Array.from(this.vertexWords);
        return {
            vertices: new Uint8Array(words.buffer),
            indices: Int32Array.from(this.indices),
            influences: Uint32Array.from(this.influences),
            usedTextureIds: new Set(this.usedTextureIds),
        };
    }

    private addFaces(model: Model, binding: SkinModelBinding, faces: readonly number[]): DrawRange {
        const offset = this.indices.length * 4;
        for (const face of faces) {
            const textureId = model.faceTextures?.[face] ?? -1;
            const textureIndex = this.textureIdIndexMap.get(textureId) ?? -1;
            if (textureIndex !== -1) {
                this.usedTextureIds.add(textureId);
            }
            let hslA = model.faceColors1[face];
            let hslB = model.faceColors2[face];
            let hslC = model.faceColors3[face];
            if (hslC === -1) {
                hslC = hslB = hslA;
            }
            const alpha = textureId === -1 ? 0xff - (model.faceAlphas?.[face] & 0xff) : 0xff;
            const alphaLabel = textureId === -1 ? binding.faceAlphaIndex(face) : 0;
            const textureCoordinates = model.uvs?.subarray(face * 6, face * 6 + 6);
            if (textureId !== -1 && !textureCoordinates) {
                throw new Error("Actor model has face textures but no texture coordinates");
            }
            const vertices = [model.indices1[face], model.indices2[face], model.indices3[face]];
            const hsls = [hslA, hslB, hslC];
            for (let corner = 0; corner < 3; corner++) {
                const vertex = vertices[corner];
                this.indices.push(
                    this.addVertex(
                        model,
                        vertex,
                        hsls[corner],
                        alpha,
                        textureCoordinates?.[corner * 2] ?? 0,
                        textureCoordinates?.[corner * 2 + 1] ?? 0,
                        textureIndex,
                        (model.faceRenderPriorities?.[face] ?? 0) + 1,
                        binding.vertexInfluences(vertex),
                        alphaLabel,
                    ),
                );
            }
        }
        return newDrawRange(offset, faces.length * 3, 1);
    }

    private addVertex(
        model: Model,
        vertex: number,
        hsl: number,
        alpha: number,
        u: number,
        v: number,
        textureIndex: number,
        priority: number,
        influences: readonly SkinInfluence[],
        alphaLabel: number,
    ): number {
        const influenceStart = this.internInfluences(influences);
        const metadata = influenceStart | ((influences.length - 1) << 20) | (alphaLabel << 24);
        const words = [
            ...packVertex(
                model.verticesX[vertex],
                model.verticesY[vertex],
                model.verticesZ[vertex],
                hsl,
                alpha,
                u,
                v,
                textureIndex,
                priority,
            ),
            metadata,
        ];
        const key = words.join(",");
        const existing = this.vertices.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const index = this.vertexWords.length / 4;
        this.vertexWords.push(...words);
        this.vertices.set(key, index);
        return index;
    }

    private internInfluences(influences: readonly SkinInfluence[]): number {
        if (influences.length === 0 || influences.length > MAX_INFLUENCE_COUNT) {
            throw new Error(`Actor influence count ${influences.length} is outside 1..16`);
        }
        const totalWeight = influences.reduce((total, influence) => total + influence.weight, 0);
        if (totalWeight !== 0xff) {
            throw new Error(`Actor influence weights total ${totalWeight}; expected 255`);
        }
        const entries = influences.map(({ matrixIndex, weight }) => {
            if (!Number.isInteger(matrixIndex) || matrixIndex < 0 || matrixIndex > 0xffff) {
                throw new Error(`Actor matrix index ${matrixIndex} does not fit in 16 bits`);
            }
            if (!Number.isInteger(weight) || weight < 0 || weight > 0xff) {
                throw new Error(`Actor influence weight ${weight} does not fit in 8 bits`);
            }
            return matrixIndex | (weight << 16);
        });
        const key = entries.join(",");
        const existing = this.influenceLists.get(key);
        if (existing !== undefined) {
            return existing;
        }
        if (this.influences.length > MAX_INFLUENCE_START) {
            throw new Error("Actor influence table exceeds its 20-bit address space");
        }
        const start = this.influences.length;
        this.influences.push(...entries);
        this.influenceLists.set(key, start);
        return start;
    }
}
