import { PackedRoots } from "../rs/cache/pack/CachePacker";
import { CacheRoots } from "../rs/cache/pack/CacheRoots";
import { PackId } from "../rs/cache/pack/PackId";
import { PackStore } from "./PackStore";

// What the resolver needs of a CachePacker, so it can be exercised without a real cache.
export interface RootsPacker {
    pack(roots: CacheRoots): PackedRoots;
}

export type ResolveOutcome =
    | { readonly kind: "PACK"; readonly packId: PackId }
    | { readonly kind: "UNKNOWN_ROOT"; readonly reason: string };

// Resolves roots to the pack of one cache that serves them. The cache is opened on the first
// resolve and kept for the process; each distinct set of roots is packed once, and repeats,
// concurrent or later, share that one outcome.
export class PackResolver {
    private packer: RootsPacker | undefined;
    private readonly outcomes = new Map<string, Promise<ResolveOutcome>>();

    constructor(
        private readonly store: PackStore,
        private readonly openPacker: () => RootsPacker,
    ) {}

    resolve(roots: CacheRoots): Promise<ResolveOutcome> {
        // Canonical roots serialise to the same string exactly when they are equal.
        const key = JSON.stringify(roots);
        let outcome = this.outcomes.get(key);
        if (!outcome) {
            outcome = this.packRoots(roots);
            this.outcomes.set(key, outcome);
            // A failure is a bug to be fixed, not an answer to remember for these roots.
            outcome.catch(() => this.outcomes.delete(key));
        }
        return outcome;
    }

    private async packRoots(roots: CacheRoots): Promise<ResolveOutcome> {
        if (!this.packer) {
            this.packer = this.openPacker();
        }
        const packed = this.packer.pack(roots);
        if (packed.kind === "UNKNOWN_ROOT") {
            return packed;
        }
        return { kind: "PACK", packId: await this.store.put(packed.bytes) };
    }
}
