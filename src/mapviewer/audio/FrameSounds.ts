import { SeqSoundEffect } from "../../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SoundEffectId, createSoundEffectId } from "../../rs/sound/SoundEffect";
import { actorAssets } from "../assets/ActorAssets";
import { declaredSeqIds } from "../assets/cacheRoots";
import { Encounter } from "../game/Encounter";
import { SeqCatalog } from "../game/SeqCatalog";

// A sound a sequence plays when one of its frames is entered.
export type FrameSound = {
    readonly soundId: SoundEffectId;
    // Every play after the first repeats only the sound's own loop (see repeatSoundLoop).
    readonly plays: number;
    // Tiles over which the sound fades out around its source; 0 plays it at full volume anywhere.
    readonly rangeTiles: number;
};

export type SeqFrameSounds = {
    // The frames the game plays of the sequence (see SeqTiming).
    readonly frameCount: number;
    readonly byFrame: ReadonlyMap<number, FrameSound>;
};

// The frame sounds of an encounter's sequences, keyed by seq id. A sequence without any is absent.
export type SeqSoundCatalog = ReadonlyMap<number, SeqFrameSounds>;

// A rendered file: a sound at a play count, since repeats are rendered into it (see render-sfx).
export type SfxClip = Pick<FrameSound, "soundId" | "plays">;

export const SFX_DIR = "audio/sfx";

// Relative to the public root.
export function sfxClipPath(clip: SfxClip): string {
    const repeats = clip.plays === 1 ? "" : `-x${clip.plays}`;
    return `${SFX_DIR}/${clip.soundId}${repeats}.opus`;
}

// Every sequence an encounter plays, whose sounds render-sfx renders. The animation viewer's
// ranges are left out since they hold arbitrary sequences nothing renders sounds for, so the
// viewer only plays the sounds of the encounter it previews.
export function soundSeqIds(encounter: Encounter): readonly number[] {
    return declaredSeqIds(actorAssets(encounter));
}

function parseFrameSound(
    seqId: number,
    frame: number,
    effects: readonly SeqSoundEffect[],
): FrameSound {
    const where = `Seq ${seqId} frame ${frame}`;
    // The cache weights a frame's sounds against each other, and how the client picks among them
    // is unknown, so only frames with a single sound are supported.
    if (effects.length !== 1) {
        throw new Error(`${where} has ${effects.length} sounds; only one per frame is supported`);
    }
    const [effect] = effects;
    if (effect.retain !== 0) {
        throw new Error(
            `${where} sound ${effect.id} sets retain ${effect.retain}, which is not supported`,
        );
    }
    if (effect.loops < 1) {
        throw new Error(`${where} sound ${effect.id} plays ${effect.loops} times`);
    }
    return {
        soundId: createSoundEffectId(effect.id),
        plays: effect.loops,
        rangeTiles: effect.location,
    };
}

// Resolved while the encounter loads, like the SeqCatalog, so a sound the game cannot play fails
// then rather than when its frame is first entered.
export function loadSeqSoundCatalog(
    seqIds: Iterable<number>,
    seqTypeLoader: SeqTypeLoader,
    timings: SeqCatalog,
): SeqSoundCatalog {
    const catalog = new Map<number, SeqFrameSounds>();
    for (const seqId of seqIds) {
        const { frameSounds } = seqTypeLoader.load(seqId);
        if (!frameSounds || frameSounds.size === 0) {
            continue;
        }
        const frameCount = timings.get(seqId).frameTicks.length;
        const byFrame = new Map<number, FrameSound>();
        for (const [frame, effects] of frameSounds) {
            if (frame >= frameCount) {
                throw new Error(
                    `Seq ${seqId} plays a sound on frame ${frame}, past the ${frameCount} frames the game plays of it`,
                );
            }
            byFrame.set(frame, parseFrameSound(seqId, frame, effects));
        }
        catalog.set(seqId, { frameCount, byFrame });
    }
    return catalog;
}

export function sfxClips(catalog: SeqSoundCatalog): SfxClip[] {
    const clips = new Map<string, SfxClip>();
    for (const { byFrame } of catalog.values()) {
        for (const { soundId, plays } of byFrame.values()) {
            const clip = { soundId, plays };
            clips.set(sfxClipPath(clip), clip);
        }
    }
    return [...clips.values()];
}
