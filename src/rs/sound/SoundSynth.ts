import JavaRandom from "java-random";

import {
    EnvelopeBreakpoint,
    Filter,
    FilterPair,
    Gate,
    Instrument,
    Modulation,
    SoundEffect,
    SoundLoop,
    Waveform,
} from "./SoundEffect";

// A port of the client's tone generator (SoundEffect.mix, Instrument.synthesize, SoundEnvelope's
// stepping and AudioFilter.compute). Java's 32-bit int wrap-around and float rounding are kept
// with Math.imul, `| 0` and Math.fround, since the sounds are authored against them.

export const SOUND_SAMPLE_RATE = 22050;

const WAVE_TABLE_SIZE = 32768;
const WAVE_PHASE_MASK = WAVE_TABLE_SIZE - 1;
const NOISE_PHASE_DIVISOR = 2607;
const SINE_TABLE_STEP = 5215.1903;
const OSCILLATOR_DETUNE_STEP = 1.0057929410678534;
// Instrument.synthesize renders nothing for anything shorter.
const MIN_INSTRUMENT_DURATION_MS = 10;
const FILTER_RECOMPUTE_INTERVAL = 128;

const NOISE_TABLE = buildNoiseTable();
const SINE_TABLE = buildSineTable();

function buildNoiseTable(): Int32Array {
    const random = new JavaRandom(0);
    const table = new Int32Array(WAVE_TABLE_SIZE);
    for (let index = 0; index < WAVE_TABLE_SIZE; index++) {
        table[index] = (random.nextInt() & 2) - 1;
    }
    return table;
}

function buildSineTable(): Int32Array {
    const table = new Int32Array(WAVE_TABLE_SIZE);
    for (let index = 0; index < WAVE_TABLE_SIZE; index++) {
        table[index] = Math.trunc(Math.sin(index / SINE_TABLE_STEP) * 16384);
    }
    return table;
}

// Java's (int) cast of a double: truncates, saturates, and maps NaN to 0.
function doubleToInt(value: number): number {
    if (Number.isNaN(value)) {
        return 0;
    }
    return Math.max(-2147483648, Math.min(2147483647, Math.trunc(value)));
}

// Java's (int)((long)a * (long)b >> 16) for ints a and b.
function mulShift16(a: number, b: number): number {
    const product = a * b;
    if (Number.isSafeInteger(product)) {
        return Math.floor(product / 65536) | 0;
    }
    return Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> 16n));
}

export function msToSamples(ms: number): number {
    return Math.trunc((ms * SOUND_SAMPLE_RATE) / 1000);
}

// SoundEnvelope's reset() state and doStep(): ramps linearly between breakpoints spread over
// `length` steps and returns the level in 1/65536ths.
class EnvelopeCursor {
    private stepsToBreakpoint = 0;
    private breakpointIndex = 0;
    private stepsTaken = 0;
    private increment = 0;
    private amplitude = 0;

    constructor(private readonly breakpoints: readonly EnvelopeBreakpoint[]) {
        if (breakpoints.length === 0) {
            throw new Error("A sound envelope without breakpoints cannot be stepped");
        }
    }

    next(length: number): number {
        if (this.stepsTaken >= this.stepsToBreakpoint) {
            this.amplitude = this.breakpoints[this.breakpointIndex++].level << 15;
            if (this.breakpointIndex >= this.breakpoints.length) {
                this.breakpointIndex = this.breakpoints.length - 1;
            }
            const target = this.breakpoints[this.breakpointIndex];
            this.stepsToBreakpoint = doubleToInt((target.position / 65536) * length);
            if (this.stepsToBreakpoint > this.stepsTaken) {
                this.increment = Math.trunc(
                    ((target.level << 15) - this.amplitude) /
                        (this.stepsToBreakpoint - this.stepsTaken),
                );
            }
        }
        this.amplitude = (this.amplitude + this.increment) | 0;
        this.stepsTaken++;
        return (this.amplitude - this.increment) >> 15;
    }
}

function evaluateWave(phase: number, amplitude: number, form: Waveform): number {
    switch (form) {
        case Waveform.SQUARE:
            return (phase & WAVE_PHASE_MASK) < WAVE_TABLE_SIZE / 2 ? amplitude : -amplitude | 0;
        case Waveform.SINE:
            return Math.imul(SINE_TABLE[phase & WAVE_PHASE_MASK], amplitude) >> 14;
        case Waveform.SAW:
            return ((Math.imul(amplitude, phase & WAVE_PHASE_MASK) >> 14) - amplitude) | 0;
        case Waveform.NOISE:
            return Math.imul(
                amplitude,
                NOISE_TABLE[((phase / NOISE_PHASE_DIVISOR) | 0) & WAVE_PHASE_MASK],
            );
        case Waveform.OFF:
            return 0;
    }
}

type FilterCoefficients = {
    readonly order: number;
    readonly coefficients: Int32Array;
};

// AudioFilter.method1022: a pole's radius from its magnitude in 1/65536ths of a decibel step.
function poleRadius(start: FilterPair, end: FilterPair, t: number): number {
    const magnitude = Math.fround(
        Math.fround(
            Math.fround(start.magnitude) + Math.fround(t * (end.magnitude - start.magnitude)),
        ) * Math.fround(0.0015258789),
    );
    return Math.fround(1 - Math.fround(Math.pow(10, Math.fround(-magnitude / 20))));
}

// AudioFilter.method1023 and normalize: a pole's angle from its pitch in octaves above C1.
function poleAngle(start: FilterPair, end: FilterPair, t: number): number {
    const octaves = Math.fround(
        Math.fround(Math.fround(start.phase) + Math.fround(t * (end.phase - start.phase))) *
            Math.fround(1.2207031e-4),
    );
    const frequency = Math.fround(Math.fround(32.703197) * Math.fround(Math.pow(2, octaves)));
    return Math.fround(Math.fround(frequency * Math.fround(3.1415927)) / 11025);
}

function unityGain(filter: Filter, t: number): number {
    const [start, end] = filter.unity;
    const decibels = Math.fround(
        Math.fround(Math.fround(start) + Math.fround((end - start) * t)) *
            Math.fround(0.0030517578),
    );
    return Math.fround(Math.pow(0.1, Math.fround(decibels / 20)));
}

// AudioFilter.compute: multiplies out the side's pole pairs into polynomial coefficients in
// 1/65536ths. The feed-forward side (0) also carries the unity gain.
function filterCoefficients(filter: Filter, side: 0 | 1, t: number): FilterCoefficients {
    const { start, end } = filter.sides[side];
    const pairCount = start.length;
    if (pairCount === 0) {
        return { order: 0, coefficients: new Int32Array(0) };
    }
    const terms = new Float32Array(pairCount * 2);
    const firstRadius = poleRadius(start[0], end[0], t);
    terms[0] = Math.fround(
        Math.fround(-2 * firstRadius) * Math.fround(Math.cos(poleAngle(start[0], end[0], t))),
    );
    terms[1] = Math.fround(firstRadius * firstRadius);
    for (let pair = 1; pair < pairCount; pair++) {
        const radius = poleRadius(start[pair], end[pair], t);
        const linear = Math.fround(
            Math.fround(-2 * radius) * Math.fround(Math.cos(poleAngle(start[pair], end[pair], t))),
        );
        const squared = Math.fround(radius * radius);
        terms[pair * 2 + 1] = Math.fround(terms[pair * 2 - 1] * squared);
        terms[pair * 2] = Math.fround(
            Math.fround(terms[pair * 2 - 1] * linear) + Math.fround(terms[pair * 2 - 2] * squared),
        );
        for (let term = pair * 2 - 1; term >= 2; term--) {
            terms[term] = Math.fround(
                terms[term] +
                    Math.fround(
                        Math.fround(terms[term - 1] * linear) +
                            Math.fround(terms[term - 2] * squared),
                    ),
            );
        }
        terms[1] = Math.fround(terms[1] + Math.fround(Math.fround(terms[0] * linear) + squared));
        terms[0] = Math.fround(terms[0] + linear);
    }
    if (side === 0) {
        const gain = unityGain(filter, t);
        for (let term = 0; term < terms.length; term++) {
            terms[term] = Math.fround(terms[term] * gain);
        }
    }
    const coefficients = new Int32Array(terms.length);
    for (let term = 0; term < terms.length; term++) {
        coefficients[term] = doubleToInt(Math.fround(terms[term] * 65536));
    }
    return { order: terms.length, coefficients };
}

function forwardMultiplier(filter: Filter, t: number): number {
    return doubleToInt(Math.fround(unityGain(filter, t) * 65536));
}

// The filter's time-varying IIR pass from Instrument.synthesize, run in place: outputs overwrite
// the samples already consumed, and the coefficients follow the envelope every 128 samples.
function applyFilter(samples: Int32Array, filter: Filter): void {
    const count = samples.length;
    const envelope = new EnvelopeCursor(filter.envelope);
    let envelopeLevel = envelope.next(count + 1);
    let t = Math.fround(envelopeLevel / 65536);
    let forward = filterCoefficients(filter, 0, t);
    let feedback = filterCoefficients(filter, 1, t);
    let multiplier = forwardMultiplier(filter, t);
    if (count < forward.order + feedback.order) {
        return;
    }

    const filteredSample = (index: number, feedbackTerms: number): number => {
        let value = mulShift16(samples[index + forward.order], multiplier);
        for (let term = 0; term < forward.order; term++) {
            value =
                (value +
                    mulShift16(
                        samples[index + forward.order - 1 - term],
                        forward.coefficients[term],
                    )) |
                0;
        }
        for (let term = 0; term < feedbackTerms; term++) {
            value =
                (value - mulShift16(samples[index - 1 - term], feedback.coefficients[term])) | 0;
        }
        return value;
    };

    let index = 0;
    const warmUpEnd = Math.min(feedback.order, count - forward.order);
    while (index < warmUpEnd) {
        samples[index] = filteredSample(index, index);
        envelopeLevel = envelope.next(count + 1);
        index++;
    }

    let blockEnd = FILTER_RECOMPUTE_INTERVAL;
    for (;;) {
        blockEnd = Math.min(blockEnd, count - forward.order);
        while (index < blockEnd) {
            samples[index] = filteredSample(index, feedback.order);
            envelopeLevel = envelope.next(count + 1);
            index++;
        }
        if (index >= count - forward.order) {
            break;
        }
        t = Math.fround(envelopeLevel / 65536);
        forward = filterCoefficients(filter, 0, t);
        feedback = filterCoefficients(filter, 1, t);
        multiplier = forwardMultiplier(filter, t);
        blockEnd += FILTER_RECOMPUTE_INTERVAL;
    }

    // The input has run out, so the tail keeps only the forward terms that still reach it.
    while (index < count) {
        let value = 0;
        for (let term = index + forward.order - count; term < forward.order; term++) {
            value =
                (value +
                    mulShift16(
                        samples[index + forward.order - 1 - term],
                        forward.coefficients[term],
                    )) |
                0;
        }
        for (let term = 0; term < feedback.order; term++) {
            value =
                (value - mulShift16(samples[index - 1 - term], feedback.coefficients[term])) | 0;
        }
        samples[index] = value;
        envelope.next(count + 1);
        index++;
    }
}

type OscillatorVoice = {
    readonly delay: number;
    readonly volumeStep: number;
    readonly pitchStep: number;
    readonly pitchBaseStep: number;
    phase: number;
};

type LfoState = {
    readonly rate: EnvelopeCursor;
    readonly depth: EnvelopeCursor;
    readonly form: Waveform;
    readonly step: number;
    readonly baseStep: number;
    phase: number;
};

function lfoState(modulation: Modulation | undefined, samplesPerMs: number): LfoState | undefined {
    if (!modulation) {
        return undefined;
    }
    const { rate, depth } = modulation;
    return {
        rate: new EnvelopeCursor(rate.breakpoints),
        depth: new EnvelopeCursor(depth.breakpoints),
        form: rate.form,
        step: doubleToInt((((rate.end - rate.start) | 0) * 32.768) / samplesPerMs),
        baseStep: doubleToInt((rate.start * 32.768) / samplesPerMs),
        phase: 0,
    };
}

// Advances the LFO one sample and returns its signed output.
function stepLfo(lfo: LfoState, count: number): number {
    const rate = lfo.rate.next(count);
    const depth = lfo.depth.next(count);
    const value = evaluateWave(lfo.phase, depth, lfo.form) >> 1;
    lfo.phase = (lfo.phase + lfo.baseStep + (Math.imul(rate, lfo.step) >> 16)) | 0;
    return value;
}

function applyGate(samples: Int32Array, gate: Gate): void {
    const count = samples.length;
    const silent = new EnvelopeCursor(gate.silent.breakpoints);
    const sounding = new EnvelopeCursor(gate.sounding.breakpoints);
    // Both stretches scale by the silent envelope's range, as the client does.
    const range = (gate.silent.end - gate.silent.start) | 0;
    let elapsed = 0;
    let muted = true;
    for (let index = 0; index < count; index++) {
        const silentLevel = silent.next(count);
        const soundingLevel = sounding.next(count);
        const level = muted ? silentLevel : soundingLevel;
        const threshold = ((Math.imul(level, range) >> 8) + gate.silent.start) | 0;
        elapsed += 256;
        if (elapsed >= threshold) {
            elapsed = 0;
            muted = !muted;
        }
        if (muted) {
            samples[index] = 0;
        }
    }
}

function applyEcho(samples: Int32Array, delaySamples: number, feedback: number): void {
    for (let index = delaySamples; index < samples.length; index++) {
        samples[index] += (Math.imul(samples[index - delaySamples], feedback) / 100) | 0;
    }
}

// Instrument.synthesize: `count` 16-bit samples of the instrument stretched over `durationMs`.
function synthesizeInstrument(
    instrument: Instrument,
    count: number,
    durationMs: number,
): Int32Array {
    const samples = new Int32Array(count);
    if (durationMs < MIN_INSTRUMENT_DURATION_MS) {
        return samples;
    }
    const samplesPerMs = count / durationMs;
    const { pitch, volume } = instrument;
    const pitchCursor = new EnvelopeCursor(pitch.breakpoints);
    const volumeCursor = new EnvelopeCursor(volume.breakpoints);
    const pitchLfo = lfoState(instrument.pitchModulation, samplesPerMs);
    const volumeLfo = lfoState(instrument.volumeModulation, samplesPerMs);
    const pitchRange = (pitch.end - pitch.start) | 0;
    const voices: OscillatorVoice[] = instrument.oscillators.map((oscillator) => ({
        delay: doubleToInt(oscillator.delay * samplesPerMs),
        volumeStep: Math.trunc((oscillator.volume << 14) / 100),
        pitchStep: doubleToInt(
            (pitchRange * 32.768 * Math.pow(OSCILLATOR_DETUNE_STEP, oscillator.pitch)) /
                samplesPerMs,
        ),
        pitchBaseStep: doubleToInt((pitch.start * 32.768) / samplesPerMs),
        phase: 0,
    }));

    for (let index = 0; index < count; index++) {
        let pitchLevel = pitchCursor.next(count);
        let volumeLevel = volumeCursor.next(count);
        if (pitchLfo) {
            pitchLevel = (pitchLevel + stepLfo(pitchLfo, count)) | 0;
        }
        if (volumeLfo) {
            volumeLevel = Math.imul(volumeLevel, stepLfo(volumeLfo, count) + 32768) >> 15;
        }
        for (const voice of voices) {
            const target = voice.delay + index;
            if (target >= count) {
                continue;
            }
            samples[target] += evaluateWave(
                voice.phase,
                Math.imul(volumeLevel, voice.volumeStep) >> 15,
                pitch.form,
            );
            voice.phase =
                (voice.phase +
                    (Math.imul(pitchLevel, voice.pitchStep) >> 16) +
                    voice.pitchBaseStep) |
                0;
        }
    }

    if (instrument.gate) {
        applyGate(samples, instrument.gate);
    }
    if (instrument.echoDelayMs > 0 && instrument.echoFeedback > 0) {
        applyEcho(
            samples,
            doubleToInt(instrument.echoDelayMs * samplesPerMs),
            instrument.echoFeedback,
        );
    }
    if (instrument.filter) {
        applyFilter(samples, instrument.filter);
    }
    for (let index = 0; index < count; index++) {
        samples[index] = Math.max(-32768, Math.min(32767, samples[index]));
    }
    return samples;
}

// SoundEffect.mix: every instrument at its offset, summed into signed 8-bit samples at
// SOUND_SAMPLE_RATE with clipping after each addition.
export function mixSoundEffect(sound: SoundEffect): Int8Array {
    const lengthMs = Math.max(
        0,
        ...sound.instruments.map((instrument) => instrument.durationMs + instrument.offsetMs),
    );
    const mixed = new Int8Array(msToSamples(lengthMs));
    for (const instrument of sound.instruments) {
        const count = msToSamples(instrument.durationMs);
        const offset = msToSamples(instrument.offsetMs);
        const samples = synthesizeInstrument(instrument, count, instrument.durationMs);
        for (let index = 0; index < count; index++) {
            let value = (samples[index] >> 8) + mixed[index + offset];
            if (((value + 128) & -256) !== 0) {
                value = (value >> 31) ^ 127;
            }
            mixed[index + offset] = value;
        }
    }
    return mixed;
}

// What RawPcmStream plays for a sound set to `plays` plays: through the loop's end, the loop again
// for every extra play, then the rest. A sound without a loop plays once however many are asked.
export function repeatSoundLoop(mixed: Int8Array, loop: SoundLoop, plays: number): Int8Array {
    if (!Number.isInteger(plays) || plays < 1) {
        throw new RangeError(`A sound plays a positive whole number of times, got ${plays}`);
    }
    const start = msToSamples(loop.startMs);
    const end = msToSamples(loop.endMs);
    if (plays === 1 || end <= start) {
        return mixed;
    }
    if (end > mixed.length) {
        throw new RangeError(`Sound loop ends at sample ${end}, past its ${mixed.length} samples`);
    }
    const loopLength = end - start;
    const repeated = new Int8Array(mixed.length + (plays - 1) * loopLength);
    repeated.set(mixed.subarray(0, end), 0);
    for (let repeat = 1; repeat < plays; repeat++) {
        repeated.set(mixed.subarray(start, end), end + (repeat - 1) * loopLength);
    }
    repeated.set(mixed.subarray(end), end + (plays - 1) * loopLength);
    return repeated;
}
