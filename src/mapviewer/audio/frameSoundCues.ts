import { AnimationProgress } from "../game/Animation";
import { TILE_SIZE } from "../game/Terrain";
import { FrameSound, SeqFrameSounds } from "./FrameSounds";

export type SoundPoint = {
    readonly x: number;
    readonly y: number;
};

// The sounds of every frame an animation entered after the `previous` reading, up to and including
// the `current` one, laps included. Without a previous reading of the same play, the play's first
// frame counts as entered too.
export function crossedFrameSounds(
    sounds: SeqFrameSounds,
    previous: AnimationProgress | undefined,
    current: AnimationProgress,
): FrameSound[] {
    const samePlay = previous !== undefined && previous.play === current.play;
    if (samePlay && previous.seqId !== current.seqId) {
        throw new Error(
            `Play ${current.play} switched from seq ${previous.seqId} to ${current.seqId}`,
        );
    }
    if (samePlay && current.framesEntered < previous.framesEntered) {
        throw new Error(
            `Seq ${current.seqId} went back from frame entry ${previous.framesEntered}`,
        );
    }
    const cues: FrameSound[] = [];
    const firstEntered = samePlay ? previous.framesEntered + 1 : 0;
    for (let entered = firstEntered; entered <= current.framesEntered; entered++) {
        const sound = sounds.byFrame.get(entered % sounds.frameCount);
        if (sound) {
            cues.push(sound);
        }
    }
    return cues;
}

// The client places a sound on the tile centre its source's position rounds down to from half a
// tile back.
function soundTileCentre(position: number): number {
    return Math.floor((position - TILE_SIZE / 2) / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
}

// The client's area sound volume, as a fraction of full: the Manhattan distance from the source
// to the listener, less the first tile, fades it linearly to silence at `rangeTiles`, and past
// that the sound is dropped (0). A range of 0 is not positional.
export function frameSoundGain(
    rangeTiles: number,
    source: SoundPoint,
    listener: SoundPoint,
): number {
    if (rangeTiles === 0) {
        return 1;
    }
    const range = rangeTiles * TILE_SIZE;
    const dx = Math.abs(soundTileCentre(source.x) - listener.x);
    const dy = Math.abs(soundTileCentre(source.y) - listener.y);
    const distance = Math.max(0, dx + dy - TILE_SIZE);
    if (distance > range) {
        return 0;
    }
    return (range - distance) / range;
}
