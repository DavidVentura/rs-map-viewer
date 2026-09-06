import { Archive } from "../../src/rs/cache/Archive";
import { ByteBuffer } from "../../src/rs/io/ByteBuffer";

// DBTable/DBRow config format, per RuneLite's DBTableLoader/DBRowLoader
// (net.runelite.cache.definitions.loaders). OSRS's "Music" dbtable has id 44:
// col 0 sortname (string), 1 displayname (string), 2 unlockhint (string),
// 3 duration (int, seconds), 4 midi (int, track id in the musicTracks index),
// 5 variable (int,int), 6 automaticUnlock (bool), 7 area (int), 8 areaDefault (int),
// 9 hidden (bool), 10 holiday (int), 11 secondaryTrack (dbrow), 12 parentTrack (dbrow),
// 13 releaseType (int), 14 relatedContent (int).
export const MUSIC_TABLE_ID = 44;
export const COL_SORTNAME = 0;
export const COL_MIDI = 4;

const SCRIPT_VAR_TYPE_STRING = 36;

export type DbRow = {
    tableId: number;
    columnValues: ((number | string)[] | undefined)[];
};

function readDbRowColumnFields(buf: ByteBuffer, types: number[]) {
    const fieldCount = buf.readUnsignedSmart();
    const values: (number | string)[] = [];
    for (let f = 0; f < fieldCount; f++) {
        for (const type of types) {
            if (type === SCRIPT_VAR_TYPE_STRING) {
                values.push(buf.readString());
            } else {
                values.push(buf.readInt());
            }
        }
    }
    return values;
}

export function decodeDbRow(buf: ByteBuffer): DbRow {
    let tableId = -1;
    const columnValues: ((number | string)[] | undefined)[] = [];
    while (true) {
        const opcode = buf.readUnsignedByte();
        if (opcode === 0) {
            break;
        }
        if (opcode === 3) {
            buf.readUnsignedByte(); // column count, unused: we key by columnId below
            for (
                let columnId = buf.readUnsignedByte();
                columnId !== 255;
                columnId = buf.readUnsignedByte()
            ) {
                const columnTypeCount = buf.readUnsignedByte();
                const types: number[] = [];
                for (let i = 0; i < columnTypeCount; i++) {
                    types.push(buf.readUnsignedSmart());
                }
                columnValues[columnId] = readDbRowColumnFields(buf, types);
            }
        } else if (opcode === 4) {
            // varint2: little-endian base-128 groups, continuation bit is the high bit
            let value = 0;
            let bits = 0;
            let read: number;
            do {
                read = buf.readUnsignedByte();
                value |= (read & 0x7f) << bits;
                bits += 7;
            } while (read > 127);
            tableId = value;
        } else {
            throw new Error("Unexpected dbrow opcode " + opcode);
        }
    }
    return { tableId, columnValues };
}

/**
 * OSRS's music track cache files (index 6) are not standard MIDI. They are Jagex's own
 * compact encoding: a type-tag stream (one byte per event, low nibble = event type,
 * upper nibble = channel, with the literal values 7 and 23 reserved as end-of-track and
 * set-tempo markers), followed by a delta-time varint per event, followed by one
 * contiguous byte array per (event type, and for controller changes, per controller
 * number) holding delta-encoded parameter values. This mirrors the real client's
 * MusicTrack(Buffer) constructor (see net.runelite deobfuscated "MusicTrack.java" /
 * OpenOSRS's copy), which performs this exact transcode into a real SMF byte stream
 * before handing it to MidiFileReader. We reproduce that transcode here so the output
 * is a standard .mid file any player/synth can read.
 */
export function convertJagexTrackToStandardMidi(src: Int8Array): Buffer {
    let footerOffset = src.length - 3;
    const trackCount = src[footerOffset++] & 0xff;
    const division = ((src[footerOffset] & 0xff) << 8) | (src[footerOffset + 1] & 0xff);

    let offset = 0;

    let tempoCount = 0;
    let ccCount = 0;
    let noteOnCount = 0;
    let noteOffCount = 0;
    let pitchBendCount = 0;
    let channelPressureCount = 0;
    let polyAftertouchCount = 0;
    let programChangeCount = 0;

    for (let t = 0; t < trackCount; t++) {
        while (true) {
            const b = src[offset++] & 0xff;
            const nibble = b & 15;
            if (b === 7) {
                break;
            } else if (b === 23) {
                tempoCount++;
            } else if (nibble === 0) {
                noteOnCount++;
            } else if (nibble === 1) {
                noteOffCount++;
            } else if (nibble === 2) {
                ccCount++;
            } else if (nibble === 3) {
                pitchBendCount++;
            } else if (nibble === 4) {
                channelPressureCount++;
            } else if (nibble === 5) {
                polyAftertouchCount++;
            } else if (nibble === 6) {
                programChangeCount++;
            } else {
                throw new Error("Unexpected music event nibble " + nibble);
            }
        }
    }
    const typeStreamEnd = offset;

    const readVarIntSeq = () => {
        let b = src[offset++];
        let value = 0;
        while (b < 0) {
            value = (value | (b & 127)) << 7;
            b = src[offset++];
        }
        return value | b;
    };

    const totalDeltaVarInts =
        trackCount +
        tempoCount +
        ccCount +
        noteOnCount +
        noteOffCount +
        pitchBendCount +
        channelPressureCount +
        polyAftertouchCount +
        programChangeCount;
    for (let i = 0; i < totalDeltaVarInts; i++) {
        readVarIntSeq();
    }

    const ccNumberStreamStart = offset;
    let ctrl = 0;
    let cc1 = 0,
        cc33 = 0,
        cc7 = 0,
        cc39 = 0,
        cc10 = 0,
        cc42 = 0,
        cc99 = 0,
        cc98 = 0,
        cc101 = 0,
        cc100 = 0,
        ccSpecial = 0,
        ccOther = 0;
    let programOrBankSelectCount = programChangeCount;
    for (let i = 0; i < ccCount; i++) {
        ctrl = (ctrl + (src[offset++] & 0xff)) & 127;
        if (ctrl !== 0 && ctrl !== 32) {
            if (ctrl === 1) cc1++;
            else if (ctrl === 33) cc33++;
            else if (ctrl === 7) cc7++;
            else if (ctrl === 39) cc39++;
            else if (ctrl === 10) cc10++;
            else if (ctrl === 42) cc42++;
            else if (ctrl === 99) cc99++;
            else if (ctrl === 98) cc98++;
            else if (ctrl === 101) cc101++;
            else if (ctrl === 100) cc100++;
            else if (![64, 65, 120, 121, 123].includes(ctrl)) ccOther++;
            else ccSpecial++;
        } else {
            programOrBankSelectCount++;
        }
    }

    const pCcSpecial = offset;
    offset += ccSpecial;
    const pPolyPressure = offset;
    offset += polyAftertouchCount;
    const pChannelPressure = offset;
    offset += channelPressureCount;
    const pPitchBendMsb = offset;
    offset += pitchBendCount;
    const pCc1 = offset;
    offset += cc1;
    const pCc7 = offset;
    offset += cc7;
    const pCc10 = offset;
    offset += cc10;
    const pNote = offset;
    offset += noteOnCount + noteOffCount + polyAftertouchCount;
    const pNoteOnVelocity = offset;
    offset += noteOnCount;
    const pCcOther = offset;
    offset += ccOther;
    const pNoteOffVelocity = offset;
    offset += noteOffCount;
    const pCc33 = offset;
    offset += cc33;
    const pCc39 = offset;
    offset += cc39;
    const pCc42 = offset;
    offset += cc42;
    const pProgramOrBankSelect = offset;
    offset += programOrBankSelectCount;
    const pPitchBendLsb = offset;
    offset += pitchBendCount;
    const pCc99 = offset;
    offset += cc99;
    const pCc98 = offset;
    offset += cc98;
    const pCc101 = offset;
    offset += cc101;
    const pCc100 = offset;
    offset += cc100;
    const pTempo = offset;
    offset += tempoCount * 3;

    const out: number[] = [];
    const writeU8 = (v: number) => out.push(v & 0xff);
    const writeU16 = (v: number) => {
        writeU8(v >> 8);
        writeU8(v);
    };
    const writeU32 = (v: number) => {
        writeU8(v >>> 24);
        writeU8(v >>> 16);
        writeU8(v >>> 8);
        writeU8(v);
    };
    const writeVarInt = (v: number) => {
        let buffer = v & 0x7f;
        while ((v >>>= 7) > 0) {
            buffer <<= 8;
            buffer |= 0x80 | (v & 0x7f);
        }
        while (true) {
            writeU8(buffer & 0xff);
            if (buffer & 0x80) {
                buffer >>>= 8;
            } else {
                break;
            }
        }
    };

    writeU32(0x4d546864); // "MThd"
    writeU32(6);
    writeU16(trackCount > 1 ? 1 : 0);
    writeU16(trackCount);
    writeU16(division);

    offset = typeStreamEnd;
    let typeStreamPtr = 0;
    let notePtr = pNote;
    let velOnPtr = pNoteOnVelocity;
    let velOffPtr = pNoteOffVelocity;
    let ctrlPtr = ccNumberStreamStart;
    let pitchBendLsbPtr = pPitchBendLsb;
    let pitchBendMsbPtr = pPitchBendMsb;
    let channelPressurePtr = pChannelPressure;
    let polyPressurePtr = pPolyPressure;
    let programPtr = pProgramOrBankSelect;
    let tempoPtr = pTempo;
    let cc1Ptr = pCc1;
    let cc7Ptr = pCc7;
    let cc10Ptr = pCc10;
    let cc33Ptr = pCc33;
    let cc39Ptr = pCc39;
    let cc42Ptr = pCc42;
    let cc99Ptr = pCc99;
    let cc98Ptr = pCc98;
    let cc101Ptr = pCc101;
    let cc100Ptr = pCc100;
    let ccOtherPtr = pCcOther;
    let ccSpecialPtr = pCcSpecial;
    const perControllerValue = new Int32Array(128);

    let runningChannel = 0;
    let noteCum = 0;
    let velOnCum = 0;
    let velOffCum = 0;
    let ctrlCum = 0;
    let pitchBendCum = 0;
    let channelPressureCum = 0;
    let polyPressureCum = 0;

    for (let track = 0; track < trackCount; track++) {
        writeU32(0x4d54726b); // "MTrk"
        const trackLengthPos = out.length;
        writeU32(0); // placeholder, backpatched below
        const trackDataStart = out.length;

        let prevNibble = -1;
        while (true) {
            const delta = readVarIntSeq();
            writeVarInt(delta);

            const eventByte = src[typeStreamPtr++] & 0xff;
            const changed = eventByte !== prevNibble;
            prevNibble = eventByte & 15;

            if (eventByte === 7) {
                // Meta events never use running status in standard SMF, unlike channel
                // voice messages below. Jagex's own encoder elides this 0xff when the
                // previous event's nibble was already 7 (i.e. a tempo event immediately
                // followed by end-of-track), which their own non-spec-compliant decoder
                // tolerates but a real synth would not, so we always emit it here.
                writeU8(0xff);
                writeU8(0x2f);
                writeU8(0x00);
                break;
            }

            if (eventByte === 23) {
                writeU8(0xff);
                writeU8(0x51);
                writeU8(0x03);
                writeU8(src[tempoPtr++]);
                writeU8(src[tempoPtr++]);
                writeU8(src[tempoPtr++]);
                continue;
            }

            runningChannel ^= eventByte >> 4;
            switch (prevNibble) {
                case 0: // note on
                    if (changed) writeU8(runningChannel + 0x90);
                    noteCum = (noteCum + src[notePtr++]) & 127;
                    velOnCum = (velOnCum + src[velOnPtr++]) & 127;
                    writeU8(noteCum);
                    writeU8(velOnCum);
                    break;
                case 1: // note off
                    if (changed) writeU8(runningChannel + 0x80);
                    noteCum = (noteCum + src[notePtr++]) & 127;
                    velOffCum = (velOffCum + src[velOffPtr++]) & 127;
                    writeU8(noteCum);
                    writeU8(velOffCum);
                    break;
                case 2: {
                    // control change
                    if (changed) writeU8(runningChannel + 0xb0);
                    ctrlCum = (ctrlCum + src[ctrlPtr++]) & 127;
                    writeU8(ctrlCum);
                    let delta8: number;
                    if (ctrlCum !== 0 && ctrlCum !== 32) {
                        if (ctrlCum === 1) delta8 = src[cc1Ptr++];
                        else if (ctrlCum === 33) delta8 = src[cc33Ptr++];
                        else if (ctrlCum === 7) delta8 = src[cc7Ptr++];
                        else if (ctrlCum === 39) delta8 = src[cc39Ptr++];
                        else if (ctrlCum === 10) delta8 = src[cc10Ptr++];
                        else if (ctrlCum === 42) delta8 = src[cc42Ptr++];
                        else if (ctrlCum === 99) delta8 = src[cc99Ptr++];
                        else if (ctrlCum === 98) delta8 = src[cc98Ptr++];
                        else if (ctrlCum === 101) delta8 = src[cc101Ptr++];
                        else if (ctrlCum === 100) delta8 = src[cc100Ptr++];
                        else if (![64, 65, 120, 121, 123].includes(ctrlCum))
                            delta8 = src[ccOtherPtr++];
                        else delta8 = src[ccSpecialPtr++];
                    } else {
                        delta8 = src[programPtr++];
                    }
                    perControllerValue[ctrlCum] = (perControllerValue[ctrlCum] + delta8) & 127;
                    writeU8(perControllerValue[ctrlCum]);
                    break;
                }
                case 3: // pitch bend
                    if (changed) writeU8(runningChannel + 0xe0);
                    pitchBendCum += src[pitchBendLsbPtr++];
                    pitchBendCum += src[pitchBendMsbPtr++] << 7;
                    writeU8(pitchBendCum & 127);
                    writeU8((pitchBendCum >> 7) & 127);
                    break;
                case 4: // channel pressure
                    if (changed) writeU8(runningChannel + 0xd0);
                    channelPressureCum = (channelPressureCum + src[channelPressurePtr++]) & 127;
                    writeU8(channelPressureCum);
                    break;
                case 5: // polyphonic key pressure
                    if (changed) writeU8(runningChannel + 0xa0);
                    noteCum = (noteCum + src[notePtr++]) & 127;
                    polyPressureCum = (polyPressureCum + src[polyPressurePtr++]) & 127;
                    writeU8(noteCum);
                    writeU8(polyPressureCum);
                    break;
                case 6: // program change
                    if (changed) writeU8(runningChannel + 0xc0);
                    writeU8(src[programPtr++]);
                    break;
                default:
                    throw new Error("Unexpected music event type " + prevNibble);
            }
        }

        const trackLength = out.length - trackDataStart;
        out[trackLengthPos] = (trackLength >>> 24) & 0xff;
        out[trackLengthPos + 1] = (trackLength >>> 16) & 0xff;
        out[trackLengthPos + 2] = (trackLength >>> 8) & 0xff;
        out[trackLengthPos + 3] = trackLength & 0xff;
    }

    return Buffer.from(out);
}

export function validateStandardMidi(midi: Buffer): {
    trackChunks: number;
    format: number;
    division: number;
} {
    if (midi.length < 14 || midi.toString("ascii", 0, 4) !== "MThd") {
        throw new Error("Missing MThd header");
    }
    const headerLength = midi.readUInt32BE(4);
    const format = midi.readUInt16BE(8);
    const numTracks = midi.readUInt16BE(10);
    const division = midi.readUInt16BE(12);

    let offset = 8 + headerLength;
    let trackChunks = 0;
    while (offset < midi.length) {
        const tag = midi.toString("ascii", offset, offset + 4);
        const length = midi.readUInt32BE(offset + 4);
        offset += 8;
        if (tag === "MTrk") {
            const trackEnd = offset + length;
            if (trackEnd > midi.length) {
                throw new Error(
                    `MTrk chunk ${trackChunks} overruns file (end=${trackEnd}, file=${midi.length})`,
                );
            }
            if (
                midi[trackEnd - 3] !== 0xff ||
                midi[trackEnd - 2] !== 0x2f ||
                midi[trackEnd - 1] !== 0x00
            ) {
                throw new Error(`MTrk chunk ${trackChunks} does not end with FF 2F 00`);
            }
            trackChunks++;
        }
        offset += length;
    }
    if (trackChunks !== numTracks) {
        throw new Error(`Header declares ${numTracks} tracks but found ${trackChunks} MTrk chunks`);
    }
    return { trackChunks, format, division };
}

export function findMusicRowByName(
    dbRowArchive: Archive,
    name: string,
): { rowId: number; row: DbRow } {
    for (const rowId of dbRowArchive.fileIds) {
        const file = dbRowArchive.getFile(rowId);
        if (!file) {
            continue;
        }
        const row = decodeDbRow(file.getDataAsBuffer());
        if (row.tableId !== MUSIC_TABLE_ID) {
            continue;
        }
        if (row.columnValues[COL_SORTNAME]?.[0] === name) {
            return { rowId, row };
        }
    }
    throw new Error(`No music dbrow found with sortname "${name}"`);
}
