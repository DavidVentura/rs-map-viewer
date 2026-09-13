export class AudioFeedback {
    constructor(private readonly context: AudioContext) {}

    async playLevelUp(): Promise<void> {
        await this.context.resume();
        const now = this.context.currentTime;
        const gain = this.context.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
        gain.connect(this.context.destination);

        for (const [index, frequency] of [523.25, 659.25, 783.99].entries()) {
            const oscillator = this.context.createOscillator();
            oscillator.frequency.value = frequency;
            oscillator.connect(gain);
            oscillator.start(now + index * 0.08);
            oscillator.stop(now + 0.45);
        }
    }
}
