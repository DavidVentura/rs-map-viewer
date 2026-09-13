import { ByteBuffer } from "../io/ByteBuffer";

declare const soundEffectIdBrand: unique symbol;

// An archive id in the sound effects index (IndexType.DAT2.soundEffects), as frame sounds name it.
export type SoundEffectId = number & { readonly [soundEffectIdBrand]: true };

export function createSoundEffectId(value: number): SoundEffectId {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`Sound effect id must be a positive integer, got ${value}`);
    }
    return value as SoundEffectId;
}

// The client's Instrument.evaluateWave shapes.
export enum Waveform {
    OFF = 0,
    SQUARE = 1,
    SINE = 2,
    SAW = 3,
    NOISE = 4,
}

// A breakpoint of a piecewise linear envelope: `position` is where it sits along the instrument's
// duration and `level` the value it ramps to, both in 1/65536ths.
export type EnvelopeBreakpoint = {
    readonly position: number;
    readonly level: number;
};

export type Envelope = {
    readonly form: Waveform;
    readonly start: number;
    readonly end: number;
    readonly breakpoints: readonly EnvelopeBreakpoint[];
};

// A low-frequency oscillator bending pitch or volume: `rate` sweeps its frequency, `depth` its
// amplitude, and `rate.form` is its shape.
export type Modulation = {
    readonly rate: Envelope;
    readonly depth: Envelope;
};

// Chops the output on and off; the envelopes set how long each silent and each sounding stretch
// lasts over the instrument's duration.
export type Gate = {
    readonly silent: Envelope;
    readonly sounding: Envelope;
};

export type Oscillator = {
    // Percent of the volume envelope.
    readonly volume: number;
    // Detune in steps of 1.0057929410678534, a tenth of a semitone.
    readonly pitch: number;
    // Milliseconds after the instrument starts.
    readonly delay: number;
};

export type FilterPair = {
    readonly phase: number;
    readonly magnitude: number;
};

// One of the filter's two sides (0 feeds forward, 1 feeds back): its pole pairs at the start and
// at the end of the filter envelope.
export type FilterSide = {
    readonly start: readonly FilterPair[];
    readonly end: readonly FilterPair[];
};

export type Filter = {
    readonly sides: readonly [FilterSide, FilterSide];
    readonly unity: readonly [number, number];
    // Interpolates every pair and the unity gain from start to end.
    readonly envelope: readonly EnvelopeBreakpoint[];
};

export type Instrument = {
    readonly pitch: Envelope;
    readonly volume: Envelope;
    readonly pitchModulation?: Modulation;
    readonly volumeModulation?: Modulation;
    readonly gate?: Gate;
    readonly oscillators: readonly Oscillator[];
    readonly echoDelayMs: number;
    // Percent of the signal fed back by the echo.
    readonly echoFeedback: number;
    readonly durationMs: number;
    readonly offsetMs: number;
    readonly filter?: Filter;
};

// Milliseconds from the start of the mixed sound; a frame sound played more than once repeats this
// stretch, and an empty one means it never repeats.
export type SoundLoop = {
    readonly startMs: number;
    readonly endMs: number;
};

export type SoundEffect = {
    // In the order the client mixes them, which matters since every addition clips.
    readonly instruments: readonly Instrument[];
    readonly loop: SoundLoop;
};

const INSTRUMENT_SLOTS = 10;
// Older clients sized their oscillator arrays for 5, but the decode loop always read up to 10 and
// the newest sounds in the cache do use more than 5.
const MAX_OSCILLATORS = 10;
// AudioFilter's pair arrays hold 4 per side.
const MAX_FILTER_PAIRS = 4;

// A SoundEnvelope that only ever had decodeSegments called on it keeps its constructor's ramp.
const DEFAULT_FILTER_ENVELOPE: readonly EnvelopeBreakpoint[] = [
    { position: 0, level: 0 },
    { position: 65535, level: 65535 },
];

// evaluateWave renders every form byte outside 1-4 as silence, and the cache does hold some.
function decodeWaveform(value: number): Waveform {
    return value >= Waveform.SQUARE && value <= Waveform.NOISE ? value : Waveform.OFF;
}

function decodeBreakpoints(buffer: ByteBuffer): EnvelopeBreakpoint[] {
    const count = buffer.readUnsignedByte();
    return Array.from({ length: count }, () => ({
        position: buffer.readUnsignedShort(),
        level: buffer.readUnsignedShort(),
    }));
}

function decodeEnvelope(buffer: ByteBuffer): Envelope {
    const form = decodeWaveform(buffer.readUnsignedByte());
    const start = buffer.readInt();
    const end = buffer.readInt();
    return { form, start, end, breakpoints: decodeBreakpoints(buffer) };
}

// An optional part starts with its first envelope's form byte, so a 0 there stands for the whole
// part being absent.
function decodeOptionalPart<T>(
    buffer: ByteBuffer,
    decodePart: (buffer: ByteBuffer) => T,
): T | undefined {
    if (buffer.getUnsignedByte(buffer.offset) === 0) {
        buffer.offset++;
        return undefined;
    }
    return decodePart(buffer);
}

function decodeOscillators(buffer: ByteBuffer): Oscillator[] {
    const oscillators: Oscillator[] = [];
    for (let index = 0; index < MAX_OSCILLATORS; index++) {
        const volume = buffer.readUnsignedSmart();
        if (volume === 0) {
            break;
        }
        const pitch = buffer.readSmart2();
        const delay = buffer.readUnsignedSmart();
        oscillators.push({ volume, pitch, delay });
    }
    return oscillators;
}

function decodeFilterPairs(buffer: ByteBuffer, count: number): FilterPair[] {
    return Array.from({ length: count }, () => ({
        phase: buffer.readUnsignedShort(),
        magnitude: buffer.readUnsignedShort(),
    }));
}

function decodeFilter(buffer: ByteBuffer): Filter | undefined {
    const pairCounts = buffer.readUnsignedByte();
    if (pairCounts === 0) {
        return undefined;
    }
    const counts = [pairCounts >> 4, pairCounts & 0xf] as const;
    for (const count of counts) {
        if (count > MAX_FILTER_PAIRS) {
            throw new Error(`Sound filter side has ${count} pairs, more than ${MAX_FILTER_PAIRS}`);
        }
    }
    const unity = [buffer.readUnsignedShort(), buffer.readUnsignedShort()] as const;
    const interpolated = buffer.readUnsignedByte();
    const starts = counts.map((count) => decodeFilterPairs(buffer, count));
    const ends = starts.map((sidePairs, side) =>
        sidePairs.map((start, pair) =>
            (interpolated & ((1 << (side * 4)) << pair)) !== 0
                ? decodeFilterPairs(buffer, 1)[0]
                : start,
        ),
    );
    const envelope =
        interpolated !== 0 || unity[1] !== unity[0]
            ? decodeBreakpoints(buffer)
            : DEFAULT_FILTER_ENVELOPE;
    return {
        sides: [
            { start: starts[0], end: ends[0] },
            { start: starts[1], end: ends[1] },
        ],
        unity,
        envelope,
    };
}

function decodeInstrument(buffer: ByteBuffer): Instrument {
    const pitch = decodeEnvelope(buffer);
    const volume = decodeEnvelope(buffer);
    const pitchModulation = decodeOptionalPart(buffer, (part) => ({
        rate: decodeEnvelope(part),
        depth: decodeEnvelope(part),
    }));
    const volumeModulation = decodeOptionalPart(buffer, (part) => ({
        rate: decodeEnvelope(part),
        depth: decodeEnvelope(part),
    }));
    const gate = decodeOptionalPart(buffer, (part) => ({
        silent: decodeEnvelope(part),
        sounding: decodeEnvelope(part),
    }));
    const oscillators = decodeOscillators(buffer);
    const echoDelayMs = buffer.readUnsignedSmart();
    const echoFeedback = buffer.readUnsignedSmart();
    const durationMs = buffer.readUnsignedShort();
    const offsetMs = buffer.readUnsignedShort();
    const filter = decodeFilter(buffer);
    return {
        pitch,
        volume,
        pitchModulation,
        volumeModulation,
        gate,
        oscillators,
        echoDelayMs,
        echoFeedback,
        durationMs,
        offsetMs,
        filter,
    };
}

// The client's SoundEffect(Buffer) with Instrument.decode, SoundEnvelope.decode and
// AudioFilter's decode.
export function decodeSoundEffect(data: Int8Array): SoundEffect {
    const buffer = new ByteBuffer(data);
    const instruments: Instrument[] = [];
    for (let slot = 0; slot < INSTRUMENT_SLOTS; slot++) {
        const instrument = decodeOptionalPart(buffer, decodeInstrument);
        if (instrument) {
            instruments.push(instrument);
        }
    }
    const loop = { startMs: buffer.readUnsignedShort(), endMs: buffer.readUnsignedShort() };
    if (buffer.offset !== data.length) {
        throw new Error(
            `Sound effect has ${data.length - buffer.offset} bytes left after decoding`,
        );
    }
    return { instruments, loop };
}
