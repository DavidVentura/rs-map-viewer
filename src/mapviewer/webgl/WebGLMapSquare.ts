import { vec2 } from "gl-matrix";
import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { CollisionFlag } from "../../rs/pathfinder/flag/CollisionFlag";
import { CollisionMap } from "../../rs/scene/CollisionMap";
import { Scene } from "../../rs/scene/Scene";
import { tileKey } from "../game/roofHiding";
import { DrawRange, newDrawRange } from "./DrawRange";
import { SdMapData } from "./loader/SdMapData";
import { LocAnimated } from "./loc/LocAnimated";
import { Npc } from "./npc/Npc";

const DEFAULT_HIDE_ABOVE_PLANE = Scene.MAX_LEVELS - 1;

const FRAME_RENDER_DELAY = 3;

const NPC_DATA_TEXTURE_BUFFER_SIZE = 5;

function createModelInfoTexture(app: PicoApp, data: Uint16Array): Texture {
    return app.createTexture2D(data, 16, Math.max(Math.ceil(data.length / 16 / 4), 1), {
        internalFormat: PicoGL.RGBA16UI,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}

export type DrawCallRange = {
    drawCall: DrawCall;
    drawRanges: DrawRange[];
};

export class WebGLMapSquare {
    readonly id: number;

    npcDataTextureOffsets: number[];

    private readonly mainDrawCalls: DrawCallRange[];

    static load(
        seqTypeLoader: SeqTypeLoader,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        time: number,
        frame: number,
    ): WebGLMapSquare {
        const { mapX, mapY, borderSize, tileRenderFlags } = mapData;

        const collisionMaps = mapData.collisionDatas.map(CollisionMap.fromData);

        const mapPos = vec2.fromValues(mapX, mapY);

        const interleavedBuffer = app.createInterleavedBuffer(12, mapData.vertices);
        const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, mapData.indices);

        const vertexArray = app
            .createVertexArray()
            // v0, v1, v2
            .vertexAttributeBuffer(0, interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(indexBuffer);

        const modelInfoTexture = createModelInfoTexture(app, mapData.modelTextureData);
        const modelInfoTextureAlpha = createModelInfoTexture(app, mapData.modelTextureDataAlpha);

        const modelInfoTextureLod = createModelInfoTexture(app, mapData.modelTextureDataLod);
        const modelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataLodAlpha,
        );

        const modelInfoTextureInteract = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteract,
        );
        const modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractAlpha,
        );

        const modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractLod,
        );
        const modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractLodAlpha,
        );

        const heightMapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;
        const heightMapTexture = app.createTextureArray(
            mapData.heightMapTextureData,
            heightMapSize,
            heightMapSize,
            Scene.MAX_LEVELS,
            {
                internalFormat: PicoGL.R16I,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                type: PicoGL.SHORT,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            },
        );

        const roofMaskSize = heightMapSize;
        const roofMaskData = new Uint8Array(roofMaskSize * roofMaskSize);
        const roofMaskTexture = app.createTexture2D(roofMaskData, roofMaskSize, roofMaskSize, {
            internalFormat: PicoGL.R8UI,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });

        // const time = performance.now() * 0.001;

        const createDrawCall = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRanges: DrawRange[],
        ): DrawCallRange => {
            const drawCall = app
                .createDrawCall(program, vertexArray)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", time)
                .uniform("u_mapPos", mapPos)
                // .uniform("u_drawIdOffset", drawIdOffset)
                .uniform("u_hideAbovePlane", DEFAULT_HIDE_ABOVE_PLANE)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_heightMap", heightMapTexture)
                .texture("u_roofMask", roofMaskTexture)
                // .texture("u_modelInfoTexture", modelInfoTexture)
                .drawRanges(...drawRanges);
            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }
            return {
                drawCall,
                drawRanges,
            };
        };

        const drawCall = createDrawCall(mainProgram, modelInfoTexture, mapData.drawRanges);
        const drawCallAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureAlpha,
            mapData.drawRangesAlpha,
        );

        const drawCallLod = createDrawCall(mainProgram, modelInfoTextureLod, mapData.drawRangesLod);
        const drawCallLodAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureLodAlpha,
            mapData.drawRangesLodAlpha,
        );

        const drawCallInteract = createDrawCall(
            mainProgram,
            modelInfoTextureInteract,
            mapData.drawRangesInteract,
        );
        const drawCallInteractAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureInteractAlpha,
            mapData.drawRangesInteractAlpha,
        );

        const drawCallInteractLod = createDrawCall(
            mainProgram,
            modelInfoTextureInteractLod,
            mapData.drawRangesInteractLod,
        );
        const drawCallInteractLodAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureInteractLodAlpha,
            mapData.drawRangesInteractLodAlpha,
        );

        const cycle = time / 0.02;

        const locsAnimated: LocAnimated[] = [];
        for (const loc of mapData.locsAnimated) {
            const seqType = seqTypeLoader.load(loc.seqId);
            locsAnimated.push(
                new LocAnimated(
                    loc.drawRangeIndex,
                    loc.drawRangeAlphaIndex,

                    loc.drawRangeLodIndex,
                    loc.drawRangeLodAlphaIndex,

                    loc.drawRangeInteractIndex,
                    loc.drawRangeInteractAlphaIndex,

                    loc.drawRangeInteractLodIndex,
                    loc.drawRangeInteractLodAlphaIndex,

                    loc.anim,
                    seqType,
                    cycle,
                    loc.randomStart,
                ),
            );
        }

        const npcs: Npc[] = [];
        for (const npc of mapData.npcs) {
            const npcType = npcTypeLoader.load(npc.id);

            npcs.push(
                new Npc(
                    npc.tileX,
                    npc.tileY,
                    npc.level,
                    npc.idleAnim,
                    npc.walkAnim,
                    npcType,
                    npcType.getIdleSeqId(basTypeLoader),
                    npcType.getWalkSeqId(basTypeLoader),
                ),
            );
        }

        for (const npc of npcs) {
            const collisionMap = collisionMaps[npc.level];

            const currentX = npc.pathX[0];
            const currentY = npc.pathY[0];

            const size = npc.getSize();

            for (let flagX = currentX; flagX < currentX + size; flagX++) {
                for (let flagY = currentY; flagY < currentY + size; flagY++) {
                    collisionMap.flag(
                        flagX + borderSize,
                        flagY + borderSize,
                        CollisionFlag.BLOCK_NPCS,
                    );
                }
            }
        }

        const drawRangesNpc = Array.from({ length: npcs.length }, () => newDrawRange(0, 0, 1));

        const drawCallNpc = createDrawCall(npcProgram, undefined, drawRangesNpc);

        return new WebGLMapSquare(
            mapX,
            mapY,

            borderSize,
            tileRenderFlags,
            collisionMaps,

            time,
            frame,

            interleavedBuffer,
            indexBuffer,
            vertexArray,

            heightMapTexture,
            mapData.heightMapTextureData,

            roofMaskTexture,
            roofMaskData,

            modelInfoTexture,
            modelInfoTextureAlpha,

            modelInfoTextureLod,
            modelInfoTextureLodAlpha,

            modelInfoTextureInteract,
            modelInfoTextureInteractAlpha,

            modelInfoTextureInteractLod,
            modelInfoTextureInteractLodAlpha,

            drawCall,
            drawCallAlpha,

            drawCallLod,
            drawCallLodAlpha,

            drawCallInteract,
            drawCallInteractAlpha,

            drawCallInteractLod,
            drawCallInteractLodAlpha,

            drawCallNpc,

            locsAnimated,
            npcs,
        );
    }

    constructor(
        readonly mapX: number,
        readonly mapY: number,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],
        readonly collisionMaps: CollisionMap[],

        readonly timeLoaded: number,
        readonly frameLoaded: number,

        readonly interleavedBuffer: VertexBuffer,
        readonly indexBuffer: VertexBuffer,
        readonly vertexArray: VertexArray,

        readonly heightMapTexture: Texture,
        readonly heightMapTextureData: Int16Array,

        readonly roofMaskTexture: Texture,
        private roofMaskData: Uint8Array,

        // Model info
        readonly modelInfoTexture: Texture,
        readonly modelInfoTextureAlpha: Texture,

        readonly modelInfoTextureLod: Texture,
        readonly modelInfoTextureLodAlpha: Texture,

        readonly modelInfoTextureInteract: Texture,
        readonly modelInfoTextureInteractAlpha: Texture,

        readonly modelInfoTextureInteractLod: Texture,
        readonly modelInfoTextureInteractLodAlpha: Texture,

        // Draw calls
        readonly drawCall: DrawCallRange,
        readonly drawCallAlpha: DrawCallRange,

        readonly drawCallLod: DrawCallRange,
        readonly drawCallLodAlpha: DrawCallRange,

        readonly drawCallInteract: DrawCallRange,
        readonly drawCallInteractAlpha: DrawCallRange,

        readonly drawCallInteractLod: DrawCallRange,
        readonly drawCallInteractLodAlpha: DrawCallRange,

        readonly drawCallNpc: DrawCallRange,

        // Animated locs
        readonly locsAnimated: LocAnimated[],

        // Npcs
        readonly npcs: Npc[],
    ) {
        this.id = getMapSquareId(mapX, mapY);
        this.npcDataTextureOffsets = new Array(NPC_DATA_TEXTURE_BUFFER_SIZE).fill(-1);
        this.mainDrawCalls = [
            drawCall,
            drawCallAlpha,
            drawCallLod,
            drawCallLodAlpha,
            drawCallInteract,
            drawCallInteractAlpha,
            drawCallInteractLod,
            drawCallInteractLodAlpha,
        ];
    }

    canRender(frameCount: number): boolean {
        return frameCount - this.frameLoaded > FRAME_RENDER_DELAY;
    }

    getTileRenderFlag(level: number, tileX: number, tileY: number): number {
        return this.tileRenderFlags[level][tileX + this.borderSize][tileY + this.borderSize];
    }

    setHideAbovePlane(plane: number): void {
        for (const { drawCall } of this.mainDrawCalls) {
            drawCall.uniform("u_hideAbovePlane", plane);
        }
    }

    updateRoofMask(hiddenTiles: ReadonlySet<string>): boolean {
        const size = Scene.MAP_SQUARE_SIZE + this.borderSize * 2;
        const baseX = this.mapX * Scene.MAP_SQUARE_SIZE - this.borderSize;
        const baseY = this.mapY * Scene.MAP_SQUARE_SIZE - this.borderSize;

        let hasHiddenTile = false;
        let changed = false;
        for (let localY = 0; localY < size; localY++) {
            const tileY = baseY + localY;
            for (let localX = 0; localX < size; localX++) {
                const tileX = baseX + localX;
                const hidden = hiddenTiles.has(tileKey(tileX, tileY)) ? 1 : 0;
                hasHiddenTile ||= hidden === 1;

                const index = localY * size + localX;
                if (this.roofMaskData[index] !== hidden) {
                    this.roofMaskData[index] = hidden;
                    changed = true;
                }
            }
        }

        if (changed) {
            this.roofMaskTexture.data(this.roofMaskData);
        }

        return hasHiddenTile;
    }

    getMapDistance(mapX: number, mapY: number): number {
        return Math.max(Math.abs(mapX - this.mapX), Math.abs(mapY - this.mapY));
    }

    getHeightAt(x: number, y: number, level: number): number {
        const tileX = x >> 7;
        const tileY = y >> 7;
        const offsetX = x & 0x7f;
        const offsetY = y & 0x7f;
        const size = Scene.MAP_SQUARE_SIZE + this.borderSize * 2;
        const getHeight = (x: number, y: number) =>
            this.heightMapTextureData[
                level * size * size + (y + this.borderSize) * size + x + this.borderSize
            ] * 8;
        const height0 =
            (getHeight(tileX, tileY) * (128 - offsetX) + getHeight(tileX + 1, tileY) * offsetX) >>
            7;
        const height1 =
            (getHeight(tileX, tileY + 1) * (128 - offsetX) +
                getHeight(tileX + 1, tileY + 1) * offsetX) >>
            7;
        return (height0 * (128 - offsetY) + height1 * offsetY) >> 7;
    }

    getDrawCall(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallRange {
        if (isInteract) {
            if (isLod) {
                return isAlpha ? this.drawCallInteractLodAlpha : this.drawCallInteractLod;
            } else {
                return isAlpha ? this.drawCallInteractAlpha : this.drawCallInteract;
            }
        } else {
            if (isLod) {
                return isAlpha ? this.drawCallLodAlpha : this.drawCallLod;
            } else {
                return isAlpha ? this.drawCallAlpha : this.drawCall;
            }
        }
    }

    delete() {
        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();

        this.heightMapTexture.delete();
        this.roofMaskTexture.delete();

        // Model info
        this.modelInfoTexture.delete();
        this.modelInfoTextureAlpha.delete();

        this.modelInfoTextureLod.delete();
        this.modelInfoTextureLodAlpha.delete();

        this.modelInfoTextureInteract.delete();
        this.modelInfoTextureInteractAlpha.delete();

        this.modelInfoTextureInteractLod.delete();
        this.modelInfoTextureInteractLodAlpha.delete();
    }
}
