import { PackContents, PackedRoots } from "../rs/cache/pack/CachePacker";
import { PackId } from "../rs/cache/pack/PackId";
import { PackRequest } from "../rs/cache/pack/PackRequest";
import { MapSpawns } from "../rs/map/MapSpawns";
import { PackStore } from "./PackStore";
import { packContents } from "./packContents";

// What the resolver needs of a CachePacker, so it can be exercised without a real cache.
export interface RootsPacker {
    pack(contents: PackContents): PackedRoots;
}

export type ResolveOutcome =
    | { readonly kind: "PACK"; readonly packId: PackId }
    | { readonly kind: "UNKNOWN_ROOT"; readonly reason: string };

// Resolves requests to the pack of one cache that serves them. The cache is opened on the first
// resolve and kept for the process; each distinct request is packed once, and repeats, concurrent
// or later, share that one outcome.
export class PackResolver {
    private packer: RootsPacker | undefined;
    private readonly outcomes = new Map<string, Promise<ResolveOutcome>>();

    constructor(
        private readonly store: PackStore,
        private readonly openPacker: () => RootsPacker,
        private readonly worldSpawns: MapSpawns,
    ) {}

    resolve(request: PackRequest): Promise<ResolveOutcome> {
        // Canonical requests serialise to the same string exactly when they are equal.
        const key = JSON.stringify(request);
        let outcome = this.outcomes.get(key);
        if (!outcome) {
            outcome = this.packRequest(request);
            this.outcomes.set(key, outcome);
            // A failure is a bug to be fixed, not an answer to remember for this request.
            outcome.catch(() => this.outcomes.delete(key));
        }
        return outcome;
    }

    private async packRequest(request: PackRequest): Promise<ResolveOutcome> {
        if (!this.packer) {
            this.packer = this.openPacker();
        }
        const packed = this.packer.pack(packContents(this.worldSpawns, request));
        if (packed.kind === "UNKNOWN_ROOT") {
            return packed;
        }
        return { kind: "PACK", packId: await this.store.put(packed.bytes) };
    }
}
