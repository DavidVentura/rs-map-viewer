#!/usr/bin/env bash
# Exports one encounter as a static site: the app build, the one pack the encounter loads, and a
# resolve.json holding the pack server's answer to its resolve, so the host runs no pack server.
# The host's web server must rewrite POST /packs/<cache>/resolve to GET /packs/<cache>/resolve.json
# and send COOP/COEP, which the pack buffer shared with the render workers needs.
#   ./export_static.sh fightcaves /tmp/fc-site
# Open it as /?enc=<encounter>: any other encounter asks for a pack the site doesn't have.
set -euo pipefail

USAGE="usage: export_static.sh <encounter id, e.g. fightcaves> <out dir>"
export ENCOUNTER=${1:?$USAGE}
export OUT=$(realpath -m "${2:?$USAGE}")
REPO=$(dirname "$(realpath "$0")")
export CACHES_DIR=$(realpath -m "${CACHES_DIR:-$REPO/caches}")
export PACKS_DIR=$(realpath -m "${PACKS_DIR:-$REPO/packs}")
# Not npm start's 3001, so an export can run beside the dev server.
export PACK_SERVER_PORT=${PACK_SERVER_PORT:-3099}

if [[ -e "$OUT" && -n "$(ls -A "$OUT")" && ! -f "$OUT/packs/caches.json" ]]; then
    echo "$OUT holds something other than an export, refusing to replace it" >&2
    exit 1
fi

cd "$REPO"

GENERATE_SOURCEMAP=false npm run build

node_modules/.bin/tsx src/server/main.ts &
SERVER=$!
trap 'kill $SERVER' EXIT
until curl -sf "http://127.0.0.1:$PACK_SERVER_PORT/packs/caches.json" -o /dev/null; do
    kill -0 $SERVER
    sleep 0.2
done

rm -rf "$OUT"
mkdir -p "$OUT"
cp -r build/. "$OUT/"

node_modules/.bin/tsx -e '
import fs from "fs";
import path from "path";
import { packRequest } from "./src/mapviewer/assets/cacheRoots";
import { EncounterId, getEncounter } from "./src/mapviewer/game/Encounter";
import { CacheInfo, getLatestCache } from "./src/rs/cache/CacheInfo";

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
    }
    return response;
}

async function main(): Promise<void> {
    const out = process.env.OUT!;
    const encounterId = Object.values(EncounterId).find((id) => id === process.env.ENCOUNTER);
    if (!encounterId) {
        throw new Error(`No encounter ${process.env.ENCOUNTER}: ${Object.values(EncounterId).join(", ")}`);
    }
    const encounter = getEncounter(encounterId);
    // The track is gitignored, rendered by npm run render-music, so a build can lack it.
    if (!fs.existsSync(path.join(out, encounter.musicFile))) {
        throw new Error(`The build has no ${encounter.musicFile}: run npm run render-music`);
    }

    const packsUrl = `http://127.0.0.1:${process.env.PACK_SERVER_PORT}/packs`;
    const caches: CacheInfo[] = await (await fetchOk(`${packsUrl}/caches.json`)).json();
    // The one the app picks when the URL names no cache.
    const cache = getLatestCache(caches);
    if (!cache) {
        throw new Error("The pack server lists no caches");
    }
    const cacheUrl = `${packsUrl}/${encodeURIComponent(cache.name)}`;
    const resolveText = await (
        await fetchOk(`${cacheUrl}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(packRequest(encounter, undefined)),
        })
    ).text();
    const { packId } = JSON.parse(resolveText);
    const pack = await (await fetchOk(`${cacheUrl}/${packId}.pack`)).arrayBuffer();

    const cacheDir = path.join(out, "packs", cache.name);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(out, "packs", "caches.json"), JSON.stringify([cache]));
    fs.writeFileSync(path.join(cacheDir, "resolve.json"), resolveText);
    fs.writeFileSync(path.join(cacheDir, `${packId}.pack`), Buffer.from(pack));
    console.log(`Exported ${encounterId} with pack ${packId} (${pack.byteLength} bytes) to ${out}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
'
