import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { registerSerializer } from "threads";
import WebFont from "webfontloader";

import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import { CacheInfo } from "../rs/cache/CacheInfo";
import { openCachePack } from "../rs/cache/pack/openCachePack";
import { isIos, isWallpaperEngine } from "../util/DeviceUtil";
import { CacheList, fetchCacheList, loadCachePack, pruneCacheStorage } from "./Caches";
import { MapViewer } from "./MapViewer";
import { MapViewerContainer } from "./MapViewerContainer";
import { getAvailableRenderers } from "./MapViewerRenderers";
import { packRequest } from "./assets/cacheRoots";
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

const workerPool = RenderDataWorkerPool.create(isWallpaperEngine ? 1 : 4);

// Debug god mode: no damage taken, free casting (see GameWorld.setGodMode); parsed here, at the
// edge, alongside parseEncounterId and parseAnimPreviewParams. The query key predates the free
// casting half of the mode.
function parseGodMode(searchParams: URLSearchParams): boolean {
    return searchParams.get("invuln") === "1";
}

function selectCache(cacheList: CacheList, cacheName: string | null): CacheInfo {
    return cacheList.caches.find((cache) => cache.name === cacheName) ?? cacheList.latest;
}

function MapViewerApp() {
    const [searchParams] = useSearchParams();

    const [errorMessage, setErrorMessage] = useState<string>();
    const [mapViewer, setMapViewer] = useState<MapViewer>();

    useEffect(() => {
        const abortController = new AbortController();
        const { signal } = abortController;

        const load = async () => {
            const cacheList = await fetchCacheList(signal);
            const cacheInfo = selectCache(cacheList, searchParams.get("cache"));

            const encounterId = parseEncounterId(searchParams.get("enc"));
            const animPreview = parseAnimPreviewParams(searchParams);
            const godMode = parseGodMode(searchParams);

            // The base encounter even in the animation viewer: the actor loader bakes the preview
            // for it (see ActorRenderDataLoader), and the preview encounter maps its squares.
            const request = packRequest(getEncounter(encounterId), animPreview);
            const packBuffer = await loadCachePack(cacheInfo.name, request, signal);
            pruneCacheStorage(cacheInfo.name).catch((e) =>
                console.error("Failed pruning cache storage", e),
            );

            const availableRenderers = getAvailableRenderers();
            if (availableRenderers.length === 0) {
                setErrorMessage("No renderers available");
                return;
            }

            // Add some way to get preferred renderer
            const rendererType = availableRenderers[0];

            workerPool.initCache(packBuffer);
            const mapViewer = new MapViewer(
                workerPool,
                cacheList,
                encounterId,
                rendererType,
                openCachePack(packBuffer).cache,
                animPreview,
                godMode,
            );
            (window as any).mapViewer = mapViewer;

            // MapViewer's constructor already starts the camera at this encounter's spawn;
            // applySearchParams only needs to override it when the URL asked for a specific spot.
            mapViewer.applySearchParams(searchParams);
            mapViewer.init();

            setMapViewer(mapViewer);
        };

        if (isIos) {
            setErrorMessage("iOS is not supported.");
        } else {
            load().catch((e) => {
                if (signal.aborted) {
                    return;
                }
                console.error(e);
                setErrorMessage(`Failed to load: ${e instanceof Error ? e.message : e}`);
            });
        }

        return () => {
            abortController.abort();
        };
    }, []);

    let content: JSX.Element;
    if (errorMessage) {
        content = <div className="center-container max-height content-text">{errorMessage}</div>;
    } else if (mapViewer) {
        content = <MapViewerContainer mapViewer={mapViewer} />;
    } else {
        content = (
            <div className="center-container max-height">
                <OsrsLoadingBar text="Loading cache" />
            </div>
        );
    }

    return <div className="App max-height">{content}</div>;
}

export default MapViewerApp;
