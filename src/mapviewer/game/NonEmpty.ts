export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export function nonEmpty<T>(values: readonly T[]): NonEmptyReadonlyArray<T> {
    if (values.length === 0) {
        throw new RangeError("Expected at least one value");
    }
    return [values[0], ...values.slice(1)];
}
