import { Waveform, decodeSoundEffect } from "./SoundEffect";

class BlobWriter {
    private readonly bytes: number[] = [];

    u8(value: number): this {
        this.bytes.push(value & 0xff);
        return this;
    }

    u16(value: number): this {
        return this.u8(value >> 8).u8(value);
    }

    i32(value: number): this {
        return this.u16(value >>> 16).u16(value & 0xffff);
    }

    // Values below 128 take one byte.
    smallSmart(value: number): this {
        return this.u8(value);
    }

    envelope(form: number, start: number, end: number, breakpoints: [number, number][]): this {
        this.u8(form).i32(start).i32(end).u8(breakpoints.length);
        for (const [position, level] of breakpoints) {
            this.u16(position).u16(level);
        }
        return this;
    }

    build(): Int8Array {
        return Int8Array.from(this.bytes, (byte) => (byte << 24) >> 24);
    }
}

// Pitch and volume envelopes, no modulation or gate, the given oscillators, echo, timing.
function instrumentHead(writer: BlobWriter): BlobWriter {
    return writer
        .envelope(Waveform.SINE, 440, 880, [
            [0, 0],
            [65535, 65535],
        ])
        .envelope(Waveform.OFF, 0, 0, [[65535, 40000]])
        .u8(0)
        .u8(0)
        .u8(0)
        .smallSmart(100)
        .u8(64 + 12)
        .smallSmart(5)
        .smallSmart(50)
        .u8(64 - 3)
        .smallSmart(0)
        .smallSmart(0)
        .smallSmart(30)
        .smallSmart(60)
        .u16(250)
        .u16(40);
}

describe("decodeSoundEffect", () => {
    it("decodes an instrument's envelopes, oscillators and timing, and the loop", () => {
        const writer = new BlobWriter().u8(0);
        instrumentHead(writer).u8(0);
        for (let slot = 2; slot < 10; slot++) {
            writer.u8(0);
        }
        writer.u16(20).u16(120);

        const sound = decodeSoundEffect(writer.build());

        expect(sound.loop).toEqual({ startMs: 20, endMs: 120 });
        expect(sound.instruments).toHaveLength(1);
        const [instrument] = sound.instruments;
        expect(instrument.pitch).toEqual({
            form: Waveform.SINE,
            start: 440,
            end: 880,
            breakpoints: [
                { position: 0, level: 0 },
                { position: 65535, level: 65535 },
            ],
        });
        expect(instrument.volume.breakpoints).toEqual([{ position: 65535, level: 40000 }]);
        expect(instrument.pitchModulation).toBeUndefined();
        expect(instrument.volumeModulation).toBeUndefined();
        expect(instrument.gate).toBeUndefined();
        expect(instrument.oscillators).toEqual([
            { volume: 100, pitch: 12, delay: 5 },
            { volume: 50, pitch: -3, delay: 0 },
        ]);
        expect(instrument.echoDelayMs).toBe(30);
        expect(instrument.echoFeedback).toBe(60);
        expect(instrument.durationMs).toBe(250);
        expect(instrument.offsetMs).toBe(40);
        expect(instrument.filter).toBeUndefined();
    });

    it("decodes a filter's interpolated pairs and its envelope", () => {
        const writer = new BlobWriter();
        instrumentHead(writer)
            // One forward pair, two feedback pairs.
            .u8((1 << 4) | 2)
            .u16(100)
            .u16(100)
            // Only the second feedback pair moves.
            .u8(1 << (4 + 1))
            .u16(1000)
            .u16(2000)
            .u16(3000)
            .u16(4000)
            .u16(5000)
            .u16(6000)
            .u16(7000)
            .u16(8000)
            .u8(1)
            .u16(65535)
            .u16(32768);
        for (let slot = 1; slot < 10; slot++) {
            writer.u8(0);
        }
        writer.u16(0).u16(0);

        const { filter } = decodeSoundEffect(writer.build()).instruments[0];

        expect(filter).toEqual({
            sides: [
                {
                    start: [{ phase: 1000, magnitude: 2000 }],
                    end: [{ phase: 1000, magnitude: 2000 }],
                },
                {
                    start: [
                        { phase: 3000, magnitude: 4000 },
                        { phase: 5000, magnitude: 6000 },
                    ],
                    end: [
                        { phase: 3000, magnitude: 4000 },
                        { phase: 7000, magnitude: 8000 },
                    ],
                },
            ],
            unity: [100, 100],
            envelope: [{ position: 65535, level: 32768 }],
        });
    });

    it("rejects bytes left over after the loop", () => {
        const writer = new BlobWriter();
        for (let slot = 0; slot < 10; slot++) {
            writer.u8(0);
        }
        writer.u16(0).u16(0).u8(7);
        expect(() => decodeSoundEffect(writer.build())).toThrow();
    });
});
