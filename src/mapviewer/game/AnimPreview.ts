import { DropTier, EnemyBehaviour, EnemyType, EnemyTypeId } from "./EnemyType";

export type SeqRange = {
    readonly from: number;
    readonly to: number;
};

// The animation viewer's two mutually exclusive modes: ?anim=<npcTypeId>&seqs=<from>-<to> previews
// an npc's sequences (see buildPreviewEnemyType), ?gfx=<from>-<to> previews a range of spot
// animations (SpotAnimType ids) as a hovering visual effect (see WebGLMapViewerRenderer's gfx
// preview controls).
export type AnimPreviewParams =
    | { readonly kind: "NPC_SEQS"; readonly npcTypeId: number; readonly seqRange: SeqRange }
    | { readonly kind: "SPOT_ANIMS"; readonly range: SeqRange };

const SEQ_RANGE_PATTERN = /^(\d+)-(\d+)$/;

export function parseSeqRange(value: string | null): SeqRange | undefined {
    if (!value) {
        return undefined;
    }
    const match = SEQ_RANGE_PATTERN.exec(value.trim());
    if (!match) {
        return undefined;
    }
    const from = parseInt(match[1], 10);
    const to = parseInt(match[2], 10);
    if (to < from) {
        return undefined;
    }
    return { from, to };
}

// Parses the animation viewer's URL params: ?anim=<npcTypeId>&seqs=<from>-<to> takes priority over
// ?gfx=<from>-<to> when both are somehow present, since the two modes are mutually exclusive.
// Returns undefined when neither mode is fully specified, which the caller takes to mean "not in
// preview mode".
export function parseAnimPreviewParams(
    searchParams: URLSearchParams,
): AnimPreviewParams | undefined {
    const npcParam = searchParams.get("anim");
    if (npcParam !== null) {
        const npcTypeId = parseInt(npcParam, 10);
        if (Number.isNaN(npcTypeId)) {
            return undefined;
        }
        const seqRange = parseSeqRange(searchParams.get("seqs"));
        if (!seqRange) {
            return undefined;
        }
        return { kind: "NPC_SEQS", npcTypeId, seqRange };
    }
    const range = parseSeqRange(searchParams.get("gfx"));
    if (!range) {
        return undefined;
    }
    return { kind: "SPOT_ANIMS", range };
}

// Steps a seq id by one position within range, wrapping around at either end.
export function stepSeqId(current: number, range: SeqRange, direction: -1 | 1): number {
    const span = range.to - range.from + 1;
    const offset = ((current - range.from + direction) % span) + span;
    return range.from + (offset % span);
}

export type PreviewNpcConfig = {
    readonly npcTypeId: number;
    readonly idleSeqId: number;
    readonly walkSeqId: number;
    readonly size: number;
};

// Builds a synthetic EnemyType for the animation viewer's one preview enemy: idle/walk/death/
// attack all point at the npc's real idle/walk seqs (death and attack are never played, since the
// preview enemy always has previewSeqId set and skips the state machine entirely), and its
// abilities are empty since none are ever cast.
export function buildPreviewEnemyType(npc: PreviewNpcConfig): EnemyType {
    return {
        id: EnemyTypeId.PREVIEW,
        npcTypeId: npc.npcTypeId,
        idleSeqId: npc.idleSeqId,
        walkSeqId: npc.walkSeqId,
        deathSeqId: npc.idleSeqId,
        attackSeqId: npc.idleSeqId,
        hitRadius: 32 + 32 * npc.size,
        projectileLaunchHeight: 40 * npc.size,
        maxHealth: 1,
        walkSpeed: 0,
        behaviour: EnemyBehaviour.RUSHER,
        abilities: [],
        dropTier: DropTier.NONE,
    };
}
