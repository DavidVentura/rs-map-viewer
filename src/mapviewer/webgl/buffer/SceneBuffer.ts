import { vec3 } from "gl-matrix";

import { Model, computeTextureCoords } from "../../../rs/model/Model";
import { Scene } from "../../../rs/scene/Scene";
import { SceneTile } from "../../../rs/scene/SceneTile";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { clamp } from "../../../util/MathUtil";
import { DrawRange, newDrawRange } from "../DrawRange";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { SceneLocEntity } from "../loc/SceneLocEntity";
import { VertexBuffer } from "./VertexBuffer";

export enum ContourGroundType {
    CENTER_TILE = 0,
    VERTEX = 1,
    NONE = 2,
}

export type ModelInfo = {
    sceneX: number;
    sceneZ: number;
    heightOffset: number;
    level: number;
    contourGround: ContourGroundType;
    priority: number;
};

export type DrawCommand = {
    offset: number;
    elements: number;
    instances: ModelInfo[];
};

export type SceneModel = {
    model: Model;
    sceneHeight: number;
    forceMerge: boolean;
} & ModelInfo;

export type ModelMergeGroup = {
    transparent: boolean;
    level: number;
    priority: number;
    models: SceneModel[];
};

export class SceneBuffer {
    vertexBuf: VertexBuffer;
    indices: number[] = [];

    drawCommands: DrawCommand[] = [];
    drawCommandsAlpha: DrawCommand[] = [];

    usedTextureIds = new Set<number>();

    constructor(
        readonly textureLoader: TextureLoader,
        readonly textureIdIndexMap: Map<number, number>,
        initVertexCount: number,
    ) {
        this.vertexBuf = new VertexBuffer(initVertexCount);
    }

    vertexCount(): number {
        return this.vertexBuf.offset;
    }

    indexByteOffset(): number {
        return this.indices.length * 4;
    }

    addTerrainTile(tile: SceneTile, offsetX: number, offsetY: number): void {
        const tileModel = tile.tileModel;
        if (!tileModel) {
            return;
        }
        for (const face of tileModel.faces) {
            for (const vertex of face.vertices) {
                const textureIndex = this.textureIdIndexMap.get(vertex.textureId) ?? -1;

                if (textureIndex !== -1) {
                    this.usedTextureIds.add(vertex.textureId);
                }

                const index = this.vertexBuf.addVertex(
                    vertex.x + offsetX,
                    vertex.y,
                    vertex.z + offsetY,
                    vertex.hsl,
                    0xff,
                    vertex.u,
                    vertex.v,
                    textureIndex,
                    0,
                );

                this.indices.push(index);
            }
        }
    }

    addTerrain(scene: Scene, borderSize: number, maxLevel: number): number {
        const startX = borderSize;
        const startY = borderSize;
        const endX = borderSize + Scene.MAP_SQUARE_SIZE;
        const endY = borderSize + Scene.MAP_SQUARE_SIZE;

        const vertexOffset = borderSize * -128;

        const terrainStartVertexCount = this.vertexCount();
        for (let level = 0; level < scene.levels; level++) {
            const indexOffset = this.indexByteOffset();
            for (let x = startX; x < endX; x++) {
                for (let y = startY; y < endY; y++) {
                    const tile = scene.tiles[level][x][y];
                    if (!tile || tile.minLevel > maxLevel) {
                        continue;
                    }
                    this.addTerrainTile(tile, vertexOffset, vertexOffset);
                }
            }

            const levelVertexCount = (this.indexByteOffset() - indexOffset) / 4;

            if (levelVertexCount > 0) {
                const command: DrawCommand = {
                    offset: indexOffset,
                    elements: levelVertexCount,
                    instances: [
                        {
                            sceneX: 0,
                            sceneZ: 0,
                            heightOffset: 0,
                            level,
                            contourGround: ContourGroundType.NONE,
                            priority: 0,
                        },
                    ],
                };

                this.drawCommands.push(command);
            }
        }

        return this.vertexCount() - terrainStartVertexCount;
    }

    // minFaceIndex excludes faces before that index, e.g. to bake only a player item's own faces
    // out of a model merged with the body for correct posing (see AnimationBaking.
    // addPlayerAnimationFrames).
    addModelAnimFrame(model: Model, transparent: boolean, minFaceIndex: number = 0): DrawRange {
        const faces = getModelFaces(model).filter(
            (face) =>
                face.index >= minFaceIndex &&
                isModelFaceTransparent(this.textureLoader, face) === transparent,
        );

        const offset = this.indexByteOffset();
        this.addModel(model, faces);
        const elements = (this.indexByteOffset() - offset) / 4;

        return newDrawRange(offset, elements, 1);
    }

    addLocAnimatedGroups(groups: Iterable<LocAnimatedGroup>): LocAnimatedData[] {
        const locsAnimated: LocAnimatedData[] = [];

        for (const group of groups) {
            for (const loc of group.locs) {
                locsAnimated.push(this.addLocAnimated(group, loc));
            }
        }

        return locsAnimated;
    }

    addLocAnimated(group: LocAnimatedGroup, loc: SceneLocEntity): LocAnimatedData {
        const anim = group.anim;

        const drawRangeIndex = this.drawCommands.length;
        this.drawCommands.push({
            offset: 0,
            elements: 0,
            instances: [loc],
        });
        const drawRangeAlphaIndex = this.drawCommandsAlpha.length;
        if (anim.framesAlpha) {
            this.drawCommandsAlpha.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
        }
        return {
            drawRangeIndex,
            drawRangeAlphaIndex,

            anim,
            seqId: loc.entity.seqId,
            randomStart: loc.entity.seqRandomStart,
        };
    }

    addModelGroup(group: ModelMergeGroup): void {
        const groupOffset = this.indexByteOffset();

        for (const sceneModel of group.models) {
            const model = sceneModel.model;

            const faces = getModelFaces(model).filter(
                (face) => isModelFaceTransparent(this.textureLoader, face) === group.transparent,
            );

            const vertexOffset: vec3 = [
                sceneModel.sceneX,
                sceneModel.sceneHeight,
                sceneModel.sceneZ,
            ];
            if (sceneModel.heightOffset !== 0) {
                vertexOffset[1] = -sceneModel.heightOffset;
            }
            this.addModel(model, faces, vertexOffset);
        }

        const groupElements = (this.indexByteOffset() - groupOffset) / 4;

        if (groupElements > 0) {
            const drawCommand: DrawCommand = {
                offset: groupOffset,
                elements: groupElements,
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                    },
                ],
            };

            if (group.transparent) {
                this.drawCommandsAlpha.push(drawCommand);
            } else {
                this.drawCommands.push(drawCommand);
            }
        }
    }

    addModel(model: Model, faces: ModelFace[], offset?: vec3, reuseVertices: boolean = true): void {
        if (faces.length === 0) {
            return;
        }

        const verticesX = model.verticesX;
        let verticesY = model.verticesY;
        const verticesZ = model.verticesZ;

        let sceneX = 0;
        let sceneZ = 0;
        let sceneHeight = 0;
        if (offset) {
            sceneX = offset[0];
            sceneHeight = offset[1];
            sceneZ = offset[2];
            if (model.contourVerticesY) {
                verticesY = model.contourVerticesY;
            }
        }

        const facesA = model.indices1;
        const facesB = model.indices2;
        const facesC = model.indices3;

        // const modelTexCoords = computeTextureCoords(model);
        const modelTexCoords = model.uvs;

        if (model.faceTextures && !modelTexCoords) {
            throw new Error("Model has face textures but no texture coordinates");
        }

        for (const face of faces) {
            const index = face.index;
            const alpha = face.alpha;
            const priority = face.priority;
            const textureId = face.textureId;
            const textureIndex = this.textureIdIndexMap.get(textureId) ?? -1;

            let hslA = model.faceColors1[index];
            let hslB = model.faceColors2[index];
            let hslC = model.faceColors3[index];

            if (hslC === -1) {
                hslC = hslB = hslA;
            }

            let u0: number = 0;
            let v0: number = 0;
            let u1: number = 0;
            let v1: number = 0;
            let u2: number = 0;
            let v2: number = 0;

            if (modelTexCoords) {
                const texCoordIdx = index * 6;
                u0 = modelTexCoords[texCoordIdx];
                v0 = modelTexCoords[texCoordIdx + 1];
                u1 = modelTexCoords[texCoordIdx + 2];
                v1 = modelTexCoords[texCoordIdx + 3];
                u2 = modelTexCoords[texCoordIdx + 4];
                v2 = modelTexCoords[texCoordIdx + 5];

                // emulate wrapS: PicoGL.CLAMP_TO_EDGE
                // u0 = clamp(u0, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u1 = clamp(u1, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u2 = clamp(u2, 0.00390625 * 3, 1 - 0.00390625 * 3);
            }

            const fa = facesA[index];
            const fb = facesB[index];
            const fc = facesC[index];

            const vxa = sceneX + verticesX[fa];
            const vxb = sceneX + verticesX[fb];
            const vxc = sceneX + verticesX[fc];

            const vya = sceneHeight + verticesY[fa];
            const vyb = sceneHeight + verticesY[fb];
            const vyc = sceneHeight + verticesY[fc];

            const vza = sceneZ + verticesZ[fa];
            const vzb = sceneZ + verticesZ[fb];
            const vzc = sceneZ + verticesZ[fc];

            if (textureIndex !== -1) {
                this.usedTextureIds.add(textureId);
            }

            const index0 = this.vertexBuf.addVertex(
                vxa,
                vya,
                vza,
                hslA,
                alpha,
                u0,
                v0,
                textureIndex,
                priority + 1,
                reuseVertices,
            );
            const index1 = this.vertexBuf.addVertex(
                vxb,
                vyb,
                vzb,
                hslB,
                alpha,
                u1,
                v1,
                textureIndex,
                priority + 1,
                reuseVertices,
            );
            const index2 = this.vertexBuf.addVertex(
                vxc,
                vyc,
                vzc,
                hslC,
                alpha,
                u2,
                v2,
                textureIndex,
                priority + 1,
                reuseVertices,
            );

            this.indices.push(index0, index1, index2);
        }
    }
}

export type ModelFace = {
    index: number;
    alpha: number;
    priority: number;
    textureId: number;
};

export function isModelFaceTransparent(textureLoader: TextureLoader, face: ModelFace): boolean {
    return (
        face.alpha < 0xff || (face.textureId !== -1 && textureLoader.isTransparent(face.textureId))
    );
}

export function getModelFaces(model: Model): ModelFace[] {
    const faces: ModelFace[] = [];

    const faceTransparencies = model.faceAlphas;

    const priorities = model.faceRenderPriorities;

    for (let index = 0; index < model.faceCount; index++) {
        let hslC = model.faceColors3[index];

        if (hslC === -2) {
            continue;
        }

        let textureId = -1;
        if (model.faceTextures) {
            textureId = model.faceTextures[index];
        }

        let alpha = 0xff;
        if (faceTransparencies && textureId === -1) {
            alpha = 0xff - (faceTransparencies[index] & 0xff);
        }
        // if (faceTransparencies) {
        //     alpha = 0xff - (faceTransparencies[index] & 0xff);
        // }

        if (alpha === 0 || alpha === 0x1) {
            continue;
        }

        let priority = 0;
        if (priorities) {
            priority = priorities[index];
        }

        faces.push({
            index,
            alpha,
            priority,
            textureId,
        });
    }

    return faces;
}

export function createModelInfoTextureData(drawCommands: DrawCommand[]): Uint16Array {
    const instances: ModelInfo[] = [];
    for (const cmd of drawCommands) {
        instances.push(...cmd.instances);
    }
    const instanceCount = instances.length;

    const dataLength = Math.ceil((drawCommands.length * 4 + instanceCount) / 16) * 16;
    const textureData = new Uint16Array(Math.max(dataLength, 16) * 4);
    let dataOffset = 0;
    drawCommands.forEach((cmd, index) => {
        textureData[index * 4] = drawCommands.length + dataOffset;

        dataOffset += cmd.instances.length;
    });

    instances.forEach((data, index) => {
        const offset = drawCommands.length * 4 + index * 4;

        const contourGround = data.contourGround;

        const height = data.heightOffset;

        textureData[offset] = data.sceneX | (data.level << 14);
        textureData[offset + 1] = data.sceneZ | (contourGround << 14);
        textureData[offset + 2] = (data.priority & 0x7) | (Math.round(height / 8) << 6);
    });

    return textureData;
}
