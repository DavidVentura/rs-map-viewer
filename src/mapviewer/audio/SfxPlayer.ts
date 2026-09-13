import { SfxClip, sfxClipPath } from "./FrameSounds";

const DEFAULT_VOLUME = 0.5;
// The synthesised effects come out near full scale while the music is mastered around 20 dB
// quieter, so the effects sit 18 dB down for both volume sliders to mean the same listening level.
const MIX_GAIN = 0.125;
// The client drops new sounds while 50 are queued or playing.
const MAX_VOICES = 50;
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53];

function isOgg(bytes: ArrayBuffer): boolean {
    const head = new Uint8Array(bytes, 0, Math.min(OGG_MAGIC.length, bytes.byteLength));
    return OGG_MAGIC.every((byte, index) => head[index] === byte);
}

// Plays the encounter's pre-rendered frame sounds (see render-sfx) through Web Audio. Autoplay
// policies keep the context suspended until a user gesture, so nothing plays before unlock(),
// called alongside the music's on the first pointerdown/keydown on the canvas.
export class SfxPlayer {
    private readonly clips = new Map<string, AudioBuffer>();
    private readonly output: GainNode;
    private unlocked = false;
    private enabled = true;
    private voices = 0;
    private currentVolume = DEFAULT_VOLUME;

    constructor(private readonly context: AudioContext) {
        this.output = context.createGain();
        this.output.gain.value = DEFAULT_VOLUME * MIX_GAIN;
        this.output.connect(context.destination);
    }

    get volume(): number {
        return this.currentVolume;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    setVolume(volume: number): void {
        this.currentVolume = Math.min(1, Math.max(0, volume));
        this.output.gain.value = this.currentVolume * MIX_GAIN;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    async load(clips: readonly SfxClip[]): Promise<void> {
        const loaded = await Promise.all(
            clips.map(async (clip) => [sfxClipPath(clip), await this.fetchClip(clip)] as const),
        );
        for (const [path, buffer] of loaded) {
            this.clips.set(path, buffer);
        }
    }

    unlock(): void {
        if (this.unlocked) {
            return;
        }
        this.unlocked = true;
        this.context.resume().catch((err) => {
            console.error("Failed to start sound effect playback", err);
        });
    }

    // `gain` scales the clip under the player's own volume.
    play(clip: SfxClip, gain: number): void {
        const buffer = this.clips.get(sfxClipPath(clip));
        if (!buffer) {
            throw new Error(`Sound effect ${clip.soundId} was not loaded with the encounter`);
        }
        if (!this.unlocked || !this.enabled || this.voices >= MAX_VOICES) {
            return;
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        const voiceGain = this.context.createGain();
        voiceGain.gain.value = gain;
        source.connect(voiceGain).connect(this.output);
        this.voices++;
        source.onended = () => {
            this.voices--;
            voiceGain.disconnect();
        };
        source.start();
    }

    private async fetchClip(clip: SfxClip): Promise<AudioBuffer> {
        const path = sfxClipPath(clip);
        const response = await fetch(`/${path}`);
        const bytes = response.ok ? await response.arrayBuffer() : undefined;
        // The dev server answers a missing file with the app's index.html, not a 404.
        if (!bytes || !isOgg(bytes)) {
            throw new Error(`Sound effect /${path} is missing; run npm run render-sfx`);
        }
        return this.context.decodeAudioData(bytes);
    }
}
