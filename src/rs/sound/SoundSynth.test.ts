import { Envelope, Instrument, SoundEffect, Waveform } from "./SoundEffect";
import { mixSoundEffect, msToSamples, repeatSoundLoop } from "./SoundSynth";

function flat(form: Waveform, value: number, level: number): Envelope {
    return {
        form,
        start: value,
        end: value,
        breakpoints: [
            { position: 0, level },
            { position: 65535, level },
        ],
    };
}

function ramp(from: number, to: number): Envelope {
    return {
        form: Waveform.OFF,
        start: 0,
        end: 0,
        breakpoints: [
            { position: 0, level: from },
            { position: 65535, level: to },
        ],
    };
}

// A 441 Hz square wave at full volume: its phase steps 655 of 32768 per sample, so it flips sign
// every 25 or so samples.
function squareInstrument(overrides: Partial<Instrument> = {}): Instrument {
    return {
        pitch: flat(Waveform.SQUARE, 441, 0),
        volume: flat(Waveform.OFF, 0, 65535),
        oscillators: [{ volume: 100, pitch: 0, delay: 0 }],
        echoDelayMs: 0,
        echoFeedback: 0,
        durationMs: 100,
        offsetMs: 0,
        ...overrides,
    };
}

function sound(...instruments: Instrument[]): SoundEffect {
    return { instruments, loop: { startMs: 0, endMs: 0 } };
}

describe("mixSoundEffect", () => {
    it("renders a square wave at full scale for the instrument's duration", () => {
        const mixed = mixSoundEffect(sound(squareInstrument()));
        expect(mixed).toHaveLength(msToSamples(100));
        expect(mixed[0]).toBe(127);
        expect(mixed[25]).toBe(127);
        expect(mixed[26]).toBe(-128);
        expect(mixed[50]).toBe(-128);
        expect(mixed[51]).toBe(127);
    });

    it("starts an instrument after its offset", () => {
        const mixed = mixSoundEffect(sound(squareInstrument({ offsetMs: 20 })));
        const offset = msToSamples(20);
        expect(mixed).toHaveLength(msToSamples(120));
        expect(mixed.subarray(0, offset).every((sample) => sample === 0)).toBe(true);
        expect(mixed[offset]).toBe(127);
    });

    it("follows the volume envelope's ramp", () => {
        const mixed = mixSoundEffect(sound(squareInstrument({ volume: ramp(0, 65535) })));
        const peak = (from: number, to: number) =>
            Math.max(...Array.from(mixed.subarray(from, to), Math.abs));
        const quarter = mixed.length / 4;
        expect(peak(0, quarter)).toBeLessThan(40);
        expect(peak(3 * quarter, mixed.length)).toBeGreaterThan(90);
    });

    it("clips instruments that sum past full scale instead of wrapping", () => {
        const mixed = mixSoundEffect(sound(squareInstrument(), squareInstrument()));
        expect(mixed[0]).toBe(127);
        expect(mixed[30]).toBe(-128);
    });

    it("renders nothing for an instrument under 10 ms", () => {
        const mixed = mixSoundEffect(sound(squareInstrument({ durationMs: 9 })));
        expect(mixed.every((sample) => sample === 0)).toBe(true);
    });
});

describe("repeatSoundLoop", () => {
    const MIXED = Int8Array.from({ length: 100 }, (_, index) => index);
    // Samples 22 to 44.
    const LOOP = { startMs: 1, endMs: 2 };

    it("plays the loop again for every extra play, then the tail", () => {
        const repeated = repeatSoundLoop(MIXED, LOOP, 3);
        expect(repeated).toHaveLength(100 + 2 * 22);
        expect(Array.from(repeated.subarray(42, 47))).toEqual([42, 43, 22, 23, 24]);
        expect(Array.from(repeated.subarray(64, 68))).toEqual([42, 43, 22, 23]);
        expect(Array.from(repeated.subarray(86, 90))).toEqual([42, 43, 44, 45]);
        expect(repeated[repeated.length - 1]).toBe(99);
    });

    it("plays once when asked for one play", () => {
        expect(repeatSoundLoop(MIXED, LOOP, 1)).toBe(MIXED);
    });

    it("plays a sound without a loop once however many plays are asked", () => {
        expect(repeatSoundLoop(MIXED, { startMs: 0, endMs: 0 }, 4)).toBe(MIXED);
    });

    it("rejects a play count below one", () => {
        expect(() => repeatSoundLoop(MIXED, LOOP, 0)).toThrow();
    });
});
