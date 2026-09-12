// The XTEA key of each encrypted map archive, by archive id.
export type XteaMap = Map<number, number[]>;

// Keys arrive as JSON objects, whose keys are strings.
export function xteaMapFromRecord(record: Readonly<Record<string, readonly number[]>>): XteaMap {
    return new Map(Object.keys(record).map((key) => [parseInt(key), Array.from(record[key])]));
}
