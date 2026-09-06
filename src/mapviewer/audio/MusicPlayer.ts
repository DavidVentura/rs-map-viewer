const DEFAULT_VOLUME = 0.5;

// Autoplay policies reject play() before a user gesture, so playback only ever starts from
// unlock() (called on the first pointerdown/keydown on the canvas) or from setTrack()/setEnabled()
// once unlock() has already happened.
export class MusicPlayer {
    private readonly audio: HTMLAudioElement = new Audio();
    private unlocked = false;
    private enabled = true;
    private trackFile?: string;

    constructor() {
        this.audio.loop = true;
        this.audio.preload = "none";
        this.audio.volume = DEFAULT_VOLUME;
    }

    get element(): HTMLAudioElement {
        return this.audio;
    }

    get volume(): number {
        return this.audio.volume;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    setVolume(volume: number): void {
        this.audio.volume = Math.min(1, Math.max(0, volume));
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.audio.pause();
        } else if (this.unlocked && this.trackFile) {
            this.play();
        }
    }

    setTrack(file: string): void {
        if (this.trackFile === file) {
            return;
        }
        this.trackFile = file;
        this.audio.src = "/" + file;
        if (this.unlocked) {
            this.play();
        }
    }

    unlock(): void {
        if (this.unlocked) {
            return;
        }
        this.unlocked = true;
        if (this.trackFile) {
            this.play();
        }
    }

    private play(): void {
        if (!this.enabled) {
            return;
        }
        this.audio.play().catch((err) => {
            console.error("Failed to start music playback", err);
        });
    }
}
