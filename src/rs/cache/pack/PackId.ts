declare const packIdBrand: unique symbol;

// The sha256 of a pack's bytes, in lowercase hex: packs are named by their content, so a pack id
// names the same bytes forever.
export type PackId = string & { readonly [packIdBrand]: true };

const PACK_ID_PATTERN = /^[0-9a-f]{64}$/;

export function parsePackId(value: string): PackId | undefined {
    return PACK_ID_PATTERN.test(value) ? (value as PackId) : undefined;
}
