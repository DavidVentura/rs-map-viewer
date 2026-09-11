import { vec4 } from "gl-matrix";

import { MapFileIndex, getMapSquareId } from "../rs/map/MapFileIndex";
import { Scene } from "../rs/scene/Scene";
import { Camera } from "./Camera";
import { MapSquareCoord } from "./MapSquareCoord";

function getMapDistance(x: number, z: number, mapX: number, mapY: number): number {
    const centerX = mapX * Scene.MAP_SQUARE_SIZE + 32;
    const centerY = mapY * Scene.MAP_SQUARE_SIZE + 32;
    const dx = Math.max(Math.abs(x - centerX) - 32, 0);
    const dz = Math.max(Math.abs(z - centerY) - 32, 0);
    return Math.sqrt(dx * dx + dz * dz);
}

type LoadMapFunction = (mapX: number, mapY: number) => void;

export interface MapSquare {
    mapX: number;
    mapY: number;

    canRender(frameCount: number): boolean;

    delete(): void;
}

export type TileCoord = {
    readonly tileX: number;
    readonly tileY: number;
};

export enum ResidencyPolicyKind {
    // Squares within renderDistance of the camera load when they enter the frustum, and unload
    // once they fall unloadDistance squares outside the render bounds: the free-flying viewer.
    CAMERA_FLY_OVER = "camera_fly_over",
    // The encounter's declared squares plus the ring around the focus (player) square are
    // resident regardless of where the camera looks; residency only changes when the focus
    // crosses a square boundary.
    PLAYER_CENTRED = "player_centred",
}

export type CameraFlyOverResidency = {
    readonly kind: ResidencyPolicyKind.CAMERA_FLY_OVER;
    // Tiles.
    readonly renderDistance: number;
    // Map squares.
    readonly unloadDistance: number;
};

export type PlayerCentredResidency = {
    readonly kind: ResidencyPolicyKind.PLAYER_CENTRED;
    readonly encounterSquares: readonly MapSquareCoord[];
    readonly focusTile: TileCoord;
};

export type ResidencyPolicy = CameraFlyOverResidency | PlayerCentredResidency;

// Ring of squares kept resident around the focus square. A radius of 1 means the focus has to
// move a whole square before anything is unloaded, which is all the hysteresis the policy needs.
export const ADJACENT_RADIUS = 1;

type CameraFlyOverState = {
    readonly kind: ResidencyPolicyKind.CAMERA_FLY_OVER;
    readonly renderBounds: vec4;
    renderDistMapCount: number;
    readonly renderDistMapIds: number[];
};

type PlayerCentredState = {
    readonly kind: ResidencyPolicyKind.PLAYER_CENTRED;
    // -1 until the first update so the wanted set is always computed once at init.
    focusMapId: number;
    wantedMapIds: ReadonlySet<number>;
    // Wanted squares whose load has not been accepted yet because the queue was full.
    pendingLoadIds: Set<number>;
    readonly drawMapIds: number[];
};

type ResidencyState = CameraFlyOverState | PlayerCentredState;

function createResidencyState(kind: ResidencyPolicyKind): ResidencyState {
    switch (kind) {
        case ResidencyPolicyKind.CAMERA_FLY_OVER:
            return {
                kind,
                renderBounds: vec4.fromValues(-1, -1, -1, -1),
                renderDistMapCount: 0,
                renderDistMapIds: [],
            };
        case ResidencyPolicyKind.PLAYER_CENTRED:
            return {
                kind,
                focusMapId: -1,
                wantedMapIds: new Set(),
                pendingLoadIds: new Set(),
                drawMapIds: [],
            };
    }
}

export function isValidMapSquare(mapX: number, mapY: number): boolean {
    return mapX >= 0 && mapY >= 0 && mapX < MapManager.MAX_MAP_X && mapY < MapManager.MAX_MAP_Y;
}

export function focusMapSquare(focusTile: TileCoord): MapSquareCoord {
    return {
        mapX: focusTile.tileX >> 6,
        mapY: focusTile.tileY >> 6,
    };
}

export function computeWantedMapIds(
    encounterSquares: readonly MapSquareCoord[],
    focusSquare: MapSquareCoord,
    invalidMapIds: ReadonlySet<number>,
): Set<number> {
    const wanted = new Set<number>();
    const add = (mapX: number, mapY: number) => {
        if (!isValidMapSquare(mapX, mapY)) {
            return;
        }
        const mapId = getMapSquareId(mapX, mapY);
        if (invalidMapIds.has(mapId)) {
            return;
        }
        wanted.add(mapId);
    };
    for (const { mapX, mapY } of encounterSquares) {
        add(mapX, mapY);
    }
    for (let dx = -ADJACENT_RADIUS; dx <= ADJACENT_RADIUS; dx++) {
        for (let dy = -ADJACENT_RADIUS; dy <= ADJACENT_RADIUS; dy++) {
            add(focusSquare.mapX + dx, focusSquare.mapY + dy);
        }
    }
    return wanted;
}

export type ResidencyDiff = {
    readonly toLoad: readonly number[];
    readonly toUnload: readonly number[];
};

export function diffResidency(
    wantedMapIds: ReadonlySet<number>,
    residentMapIds: ReadonlySet<number>,
): ResidencyDiff {
    const toLoad: number[] = [];
    for (const mapId of wantedMapIds) {
        if (!residentMapIds.has(mapId)) {
            toLoad.push(mapId);
        }
    }
    const toUnload: number[] = [];
    for (const mapId of residentMapIds) {
        if (!wantedMapIds.has(mapId)) {
            toUnload.push(mapId);
        }
    }
    return { toLoad, toUnload };
}

export class MapManager<T extends MapSquare> {
    static readonly MAX_MAP_X = 100;
    static readonly MAX_MAP_Y = 200;

    static mapIntersectBox: number[][] = [
        [0, (-Scene.UNITS_LEVEL_HEIGHT * 10) / 128, 0],
        [0, (Scene.UNITS_LEVEL_HEIGHT * 3) / 128, 0],
    ];

    invalidMapIds: Set<number> = new Set();
    loadingMapIds: Set<number> = new Set();

    private residency: ResidencyState;

    visibleMapCount: number = 0;
    visibleMaps: T[] = [];

    mapSquares: Map<number, T> = new Map();

    constructor(
        readonly maxQueuedTasks: number,
        readonly loadMapFunction: LoadMapFunction,
        readonly residencyKind: ResidencyPolicyKind,
    ) {
        this.residency = createResidencyState(residencyKind);
    }

    init(mapFileIndex: MapFileIndex, fillEmptyTerrain: boolean): void {
        this.cleanUp();
        for (let x = 0; x < MapManager.MAX_MAP_X; x++) {
            for (let y = 0; y < MapManager.MAX_MAP_Y; y++) {
                const exists = mapFileIndex.getTerrainArchiveId(x, y) !== -1;
                if (exists) {
                    continue;
                }
                if (y < 100 && fillEmptyTerrain) {
                    let hasNeighbour = false;
                    loop: for (let nx = x - 2; nx <= x + 2; nx++) {
                        for (let ny = y - 2; ny <= y + 2; ny++) {
                            const neighbourExists = mapFileIndex.getTerrainArchiveId(nx, ny) !== -1;
                            if (neighbourExists) {
                                hasNeighbour = true;
                                break loop;
                            }
                        }
                    }
                    if (hasNeighbour) {
                        continue;
                    }
                }
                this.invalidMapIds.add(getMapSquareId(x, y));
            }
        }
        console.log("Invalid map count", this.invalidMapIds.size);
    }

    isMapVisible(camera: Camera, mapX: number, mapY: number): boolean {
        const baseX = mapX * Scene.MAP_SQUARE_SIZE;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE;
        const endX = baseX + Scene.MAP_SQUARE_SIZE;
        const endY = baseY + Scene.MAP_SQUARE_SIZE;

        MapManager.mapIntersectBox[0][0] = baseX;
        MapManager.mapIntersectBox[0][2] = baseY;

        MapManager.mapIntersectBox[1][0] = endX;
        MapManager.mapIntersectBox[1][2] = endY;

        return camera.frustum.intersectsBox(MapManager.mapIntersectBox);
    }

    clearMaps(): void {
        this.invalidMapIds.clear();
        this.loadingMapIds.clear();
        for (const map of this.mapSquares.values()) {
            map.delete();
        }
        this.mapSquares.clear();
        // The camera policy re-requests whatever is in view every frame, but the player-centred
        // one only reacts to focus changes, so it has to forget its focus to reload the wanted set.
        if (this.residency.kind === ResidencyPolicyKind.PLAYER_CENTRED) {
            this.residency = createResidencyState(this.residency.kind);
        }
    }

    getMapSquare(mapX: number, mapY: number): T | undefined {
        return this.mapSquares.get(getMapSquareId(mapX, mapY));
    }

    private isWanted(mapId: number): boolean {
        return (
            this.residency.kind !== ResidencyPolicyKind.PLAYER_CENTRED ||
            this.residency.wantedMapIds.has(mapId)
        );
    }

    addMap(mapX: number, mapY: number, mapSquare: T): void {
        const mapId = getMapSquareId(mapX, mapY);
        this.loadingMapIds.delete(mapId);
        this.invalidMapIds.delete(mapId);
        // A load that was in flight when the focus moved on lands here after its square stopped
        // being wanted; keeping it would leave a resident square nothing ever unloads.
        if (!this.isWanted(mapId)) {
            mapSquare.delete();
            return;
        }
        this.mapSquares.set(mapId, mapSquare);
    }

    removeMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        const map = this.mapSquares.get(mapId);
        if (map) {
            map.delete();
            this.mapSquares.delete(mapId);
        }
    }

    addInvalidMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        this.invalidMapIds.add(mapId);
        this.loadingMapIds.delete(mapId);
    }

    loadMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        if (
            this.mapSquares.has(mapId) ||
            this.invalidMapIds.has(mapId) ||
            this.loadingMapIds.has(mapId) ||
            this.loadingMapIds.size > this.maxQueuedTasks ||
            !this.isWanted(mapId)
        ) {
            return;
        }
        console.log("Loading map", mapX, mapY);
        this.loadingMapIds.add(mapId);
        this.loadMapFunction(mapX, mapY);
    }

    private residencyState<K extends ResidencyPolicyKind>(
        kind: K,
    ): Extract<ResidencyState, { kind: K }> {
        if (this.residency.kind !== kind) {
            throw new Error(
                `Residency policy ${kind} passed to a ${this.residency.kind} map manager`,
            );
        }
        return this.residency as Extract<ResidencyState, { kind: K }>;
    }

    update(camera: Camera, frameCount: number, policy: ResidencyPolicy): void {
        switch (policy.kind) {
            case ResidencyPolicyKind.CAMERA_FLY_OVER:
                this.updateCameraFlyOver(
                    camera,
                    frameCount,
                    policy,
                    this.residencyState(policy.kind),
                );
                break;
            case ResidencyPolicyKind.PLAYER_CENTRED:
                this.updatePlayerCentred(
                    camera,
                    frameCount,
                    policy,
                    this.residencyState(policy.kind),
                );
                break;
        }

        // Probably a better way to do this, maybe set null
        if (this.visibleMapCount > this.visibleMaps.length) {
            // Delete 1 per frame
            this.visibleMaps.length -= 1;
        }
    }

    private updateCameraFlyOver(
        camera: Camera,
        frameCount: number,
        policy: CameraFlyOverResidency,
        state: CameraFlyOverState,
    ): void {
        const { renderDistance, unloadDistance } = policy;
        const cameraX = camera.getPosX();
        const cameraZ = camera.getPosZ();

        // Calculate which map square id to start and end on based on camera location and render distance (in tiles).
        const mapStartX = Math.floor((cameraX - renderDistance) / Scene.MAP_SQUARE_SIZE);
        const mapStartY = Math.floor((cameraZ - renderDistance) / Scene.MAP_SQUARE_SIZE);

        const mapEndX = Math.ceil((cameraX + renderDistance) / Scene.MAP_SQUARE_SIZE);
        const mapEndY = Math.ceil((cameraZ + renderDistance) / Scene.MAP_SQUARE_SIZE);

        const renderBoundsChanged =
            state.renderBounds[0] !== mapStartX ||
            state.renderBounds[1] !== mapStartY ||
            state.renderBounds[2] !== mapEndX ||
            state.renderBounds[3] !== mapEndY;

        if (renderBoundsChanged) {
            state.renderDistMapCount = 0;

            for (let x = mapStartX; x < mapEndX; x++) {
                for (let y = mapStartY; y < mapEndY; y++) {
                    if (!isValidMapSquare(x, y)) {
                        continue;
                    }
                    const mapId = getMapSquareId(x, y);
                    if (this.invalidMapIds.has(mapId)) {
                        continue;
                    }

                    state.renderDistMapIds[state.renderDistMapCount++] = mapId;
                }
            }

            // Calculate which map squares to unload based on the unload distance and remove them.
            // Unload distance is the distance in number of map squares.

            for (const map of this.mapSquares.values()) {
                const { mapX, mapY } = map;
                if (
                    mapX < mapStartX - unloadDistance ||
                    mapX > mapEndX + unloadDistance ||
                    mapY < mapStartY - unloadDistance ||
                    mapY > mapEndY + unloadDistance
                ) {
                    this.removeMap(mapX, mapY);
                }
            }
        }

        // Sort the maps to render based on a front to back distance.
        if (renderBoundsChanged || camera.updatedPosition) {
            state.renderDistMapIds.length = state.renderDistMapCount;
            // sort front to back
            state.renderDistMapIds.sort((a, b) => {
                const distA = getMapDistance(cameraX, cameraZ, a >> 8, a & 0xff);
                const distB = getMapDistance(cameraX, cameraZ, b >> 8, b & 0xff);
                return distA - distB;
            });
        }

        this.visibleMapCount = 0;
        for (let i = 0; i < state.renderDistMapCount; i++) {
            const mapId = state.renderDistMapIds[i];
            const mapX = mapId >> 8;
            const mapY = mapId & 0xff;
            if (!this.isMapVisible(camera, mapX, mapY)) {
                continue;
            }
            const mapSquare = this.mapSquares.get(mapId);
            if (mapSquare) {
                if (mapSquare.canRender(frameCount)) {
                    this.visibleMaps[this.visibleMapCount++] = mapSquare;
                }
            } else {
                this.loadMap(mapX, mapY);
            }
        }

        // Update the render bounds based on the map squares we are rendering.
        state.renderBounds[0] = mapStartX;
        state.renderBounds[1] = mapStartY;
        state.renderBounds[2] = mapEndX;
        state.renderBounds[3] = mapEndY;
    }

    private updatePlayerCentred(
        camera: Camera,
        frameCount: number,
        policy: PlayerCentredResidency,
        state: PlayerCentredState,
    ): void {
        const focusSquare = focusMapSquare(policy.focusTile);
        const focusMapId = getMapSquareId(focusSquare.mapX, focusSquare.mapY);

        if (focusMapId !== state.focusMapId) {
            state.focusMapId = focusMapId;
            state.wantedMapIds = computeWantedMapIds(
                policy.encounterSquares,
                focusSquare,
                this.invalidMapIds,
            );
            const { toLoad, toUnload } = diffResidency(
                state.wantedMapIds,
                new Set(this.mapSquares.keys()),
            );
            for (const mapId of toUnload) {
                this.removeMap(mapId >> 8, mapId & 0xff);
            }
            state.pendingLoadIds = new Set(toLoad);
        }

        for (const mapId of state.pendingLoadIds) {
            const mapX = mapId >> 8;
            const mapY = mapId & 0xff;
            this.loadMap(mapX, mapY);
            if (
                this.loadingMapIds.has(mapId) ||
                this.mapSquares.has(mapId) ||
                this.invalidMapIds.has(mapId)
            ) {
                state.pendingLoadIds.delete(mapId);
            }
        }

        const cameraX = camera.getPosX();
        const cameraZ = camera.getPosZ();
        state.drawMapIds.length = 0;
        for (const mapId of this.mapSquares.keys()) {
            state.drawMapIds.push(mapId);
        }
        // The transparent pass depends on a front to back order, and the resident set is a
        // handful of squares, so sorting it every frame is cheaper than tracking staleness.
        state.drawMapIds.sort((a, b) => {
            const distA = getMapDistance(cameraX, cameraZ, a >> 8, a & 0xff);
            const distB = getMapDistance(cameraX, cameraZ, b >> 8, b & 0xff);
            return distA - distB;
        });

        this.visibleMapCount = 0;
        for (const mapId of state.drawMapIds) {
            if (!this.isMapVisible(camera, mapId >> 8, mapId & 0xff)) {
                continue;
            }
            const mapSquare = this.mapSquares.get(mapId)!;
            if (mapSquare.canRender(frameCount)) {
                this.visibleMaps[this.visibleMapCount++] = mapSquare;
            }
        }
    }

    cleanUp(): void {
        this.clearMaps();
        this.residency = createResidencyState(this.residencyKind);
    }
}
