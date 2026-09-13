import { SoundEffectId } from "../../rs/sound/SoundEffect";

// A synthesised sound effect as the client plays it.
export type SoundPlay = {
    readonly soundId: SoundEffectId;
    // Every play after the first repeats only the sound's own loop (see repeatSoundLoop).
    readonly plays: number;
    // Tiles over which the sound fades out around its source; 0 plays it at full volume anywhere.
    readonly rangeTiles: number;
};

// A sound the game plays at one of its own moments, where the OSRS server would send it: the cache
// ties sounds only to animation frames, and a graphic's sequence carries none.
export type SoundCue = {
    readonly sound: SoundPlay;
    readonly x: number;
    readonly y: number;
};
