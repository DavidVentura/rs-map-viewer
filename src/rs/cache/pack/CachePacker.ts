import { encodeCachePack } from "./CachePack";
import { CachePackBuilder } from "./CachePackBuilder";
import { CacheRoots } from "./CacheRoots";
import { SourceCache } from "./SourceCache";
import { CacheSelectionResolver } from "./resolveCacheSelection";

export type PackedRoots =
    | { readonly kind: "PACKED"; readonly bytes: Uint8Array }
    // Roots come from clients, and no pack of this cache can serve a type it lacks.
    | { readonly kind: "UNKNOWN_ROOT"; readonly reason: string };

// Cuts encoded packs from one source cache. Built once per source, so repeated packs only walk and
// copy: the resolver's decoded types and the builder's decoded archives outlive each pack.
export class CachePacker {
    private readonly resolver: CacheSelectionResolver;
    private readonly builder: CachePackBuilder;

    constructor(source: SourceCache) {
        this.resolver = new CacheSelectionResolver(source);
        this.builder = new CachePackBuilder(source);
    }

    pack(roots: CacheRoots): PackedRoots {
        const reason = this.resolver.unknownRoot(roots);
        if (reason !== undefined) {
            return { kind: "UNKNOWN_ROOT", reason };
        }
        const pack = this.builder.build(this.resolver.resolve(roots));
        return { kind: "PACKED", bytes: encodeCachePack(pack) };
    }
}
