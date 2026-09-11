export type ProgramSource = [string, string];

// A bare name is a feature flag; a valued define carries a TypeScript constant into the shader so
// both sides share one definition.
export type ShaderDefine = string | { readonly name: string; readonly value: number };

export function prependDefines(source: string, defines: readonly ShaderDefine[]): string {
    const header = "#version 300 es";

    const newHeader = defines.reduce<string>((acc, define) => {
        if (typeof define === "string") {
            return acc + "#define " + define + " 1\n";
        }
        return acc + "#define " + define.name + " " + define.value + "\n";
    }, header + "\n");

    return source.replace(header, newHeader);
}
