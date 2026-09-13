import { SeqTiming, SeqTimingLoaders, loadSeqTiming } from "./Animation";

// The timings of exactly the sequences an encounter declares (see ActorAssets), read from its pack
// when it loads. Only the load-time composition asks it for timings, so a sequence the game uses
// without declaring it fails while the encounter loads rather than when something first plays it.
export type SeqCatalog = {
    readonly get: (seqId: number) => SeqTiming;
};

export function loadSeqCatalog(
    declaredSeqIds: Iterable<number>,
    loaders: SeqTimingLoaders,
): SeqCatalog {
    const timings = new Map<number, SeqTiming>();
    for (const seqId of declaredSeqIds) {
        timings.set(seqId, loadSeqTiming(seqId, loaders));
    }
    return {
        get: (seqId) => {
            const timing = timings.get(seqId);
            if (!timing) {
                throw new Error(
                    `Seq ${seqId} is used by the game but not declared in ActorAssets, so the encounter's pack does not hold it`,
                );
            }
            return timing;
        },
    };
}
