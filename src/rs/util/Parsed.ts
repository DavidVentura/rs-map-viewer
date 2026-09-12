// JSON from outside the process parses into one of these: a typed value or the first problem found.
export type Parsed<T> =
    | { readonly kind: "PARSED"; readonly value: T }
    | { readonly kind: "INVALID"; readonly reason: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInteger(
    what: string,
    value: unknown,
    min: number,
    max: number,
): Parsed<number> {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return { kind: "INVALID", reason: `Invalid ${what} ${JSON.stringify(value)}` };
    }
    return { kind: "PARSED", value };
}

// A record is refused on its first bad field, since the rest of a malformed record can't be trusted.
export function parseRecord<T>(
    what: string,
    fields: readonly string[],
    value: unknown,
    parseFields: (record: Record<string, unknown>) => Parsed<T>,
): Parsed<T> {
    if (!isRecord(value)) {
        return { kind: "INVALID", reason: `Invalid ${what} ${JSON.stringify(value)}` };
    }
    const extra = Object.keys(value).find((key) => !fields.includes(key));
    if (extra !== undefined) {
        return { kind: "INVALID", reason: `Unexpected ${what} field ${extra}` };
    }
    return parseFields(value);
}

export function parseList<T>(
    field: string,
    value: unknown,
    parseItem: (item: unknown) => Parsed<T>,
): Parsed<T[]> {
    if (!Array.isArray(value)) {
        return { kind: "INVALID", reason: `${field} is not an array` };
    }
    const items: T[] = [];
    for (let i = 0; i < value.length; i++) {
        const parsed = parseItem(value[i]);
        if (parsed.kind === "INVALID") {
            return { kind: "INVALID", reason: `${field}[${i}]: ${parsed.reason}` };
        }
        items.push(parsed.value);
    }
    return { kind: "PARSED", value: items };
}
