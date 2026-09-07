import { vec3 } from "gl-matrix";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { registerSerializer } from "threads";
import WebFont from "webfontloader";

import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import { DownloadProgress } from "../rs/cache/CacheFiles";
import { formatBytes } from "../util/BytesUtil";
import { isIos, isWallpaperEngine } from "../util/DeviceUtil";
import { fetchCacheList, loadCacheFiles } from "./Caches";
import { MapViewer } from "./MapViewer";
import { MapViewerContainer } from "./MapViewerContainer";
import { WEBGL, getAvailableRenderers } from "./MapViewerRenderers";
import { fetchNpcSpawns, getNpcSpawnsUrl } from "./data/npc/NpcSpawn";
import { fetchObjSpawns } from "./data/obj/ObjSpawn";
import { parseAnimPreviewParams } from "./game/AnimPreview";
import { getEncounter, parseEncounterId } from "./game/Encounter";
import { renderDataLoaderSerializer } from "./worker/RenderDataLoader";
import { RenderDataWorkerPool } from "./worker/RenderDataWorkerPool";

registerSerializer(renderDataLoaderSerializer);

WebFont.load({
    custom: {
        families: ["OSRS Bold", "OSRS Small"],
    },
});

const cachesPromise = fetchCacheList();

const workerPool = RenderDataWorkerPool.create(isWallpaperEngine ? 1 : 4);

function MapViewerApp() {
    const [searchParams, setSearchParams] = useSearchParams();

    const [errorMessage, setErrorMessage] = useState<string>();
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();
    const [mapViewer, setMapViewer] = useState<MapViewer>();

    useEffect(() => {
        const abortController = new AbortController();

        const load = async () => {
            const objSpawnsPromise = fetchObjSpawns();

            const cacheList = await cachesPromise;
            if (!cacheList) {
                setErrorMessage("Failed to load cache list");
                throw new Error("No caches found");
            }

            const cacheNameParam = searchParams.get("cache");
            let cacheInfo = cacheList.latest;
            if (cacheNameParam) {
                const foundCache = cacheList.caches.find((cache) => cache.name === cacheNameParam);
                if (foundCache) {
                    cacheInfo = foundCache;
                }
            }

            const [cache, objSpawns, npcSpawns] = await Promise.all([
                loadCacheFiles(cacheInfo, abortController.signal, setDownloadProgress),
                objSpawnsPromise,
                fetchNpcSpawns(getNpcSpawnsUrl(cacheInfo)),
            ]);

            const mapImageCache = await caches.open("map-images");

            const availableRenderers = getAvailableRenderers();
            if (availableRenderers.length === 0) {
                setErrorMessage("No renderers available");
                return;
            }

            // Add some way to get preferred renderer
            const rendererType = availableRenderers[0];

            const encounterId = parseEncounterId(searchParams.get("enc"));
            const animPreview = parseAnimPreviewParams(searchParams);

            const mapViewer = new MapViewer(
                workerPool,
                cacheList,
                objSpawns,
                npcSpawns,
                mapImageCache,
                encounterId,
                rendererType,
                cache,
                animPreview,
            );
            (window as any).mapViewer = mapViewer;

            const hasCameraParams =
                searchParams.get("cx") && searchParams.get("cy") && searchParams.get("cz");
            if (!hasCameraParams) {
                const { playerSpawn } = getEncounter(encounterId);
                mapViewer.setCamera({
                    position: vec3.fromValues(
                        playerSpawn.x / 128,
                        mapViewer.camera.pos[1],
                        playerSpawn.y / 128,
                    ),
                });
            }

            mapViewer.applySearchParams(searchParams);
            mapViewer.init();

            setDownloadProgress(undefined);
            setMapViewer(mapViewer);
        };

        if (isIos) {
            setErrorMessage("iOS is not supported.");
        } else {
            load().catch(console.error);
        }

        return () => {
            abortController.abort();
        };
    }, []);

    let content: JSX.Element | undefined;
    if (errorMessage) {
        content = <div className="center-container max-height content-text">{errorMessage}</div>;
    } else if (downloadProgress) {
        const formattedCacheSize = formatBytes(downloadProgress.total);
        const progress = ((downloadProgress.current / downloadProgress.total) * 100) | 0;
        content = (
            <div className="center-container max-height">
                <OsrsLoadingBar
                    text={`Downloading cache (${formattedCacheSize})`}
                    progress={progress}
                />
            </div>
        );
    } else if (mapViewer) {
        content = <MapViewerContainer mapViewer={mapViewer} />;
    }

    return <div className="App max-height">{content}</div>;
}

export default MapViewerApp;
