// Layout written by SkinnedMeshBuilder and SkinPaletteBuilder: a_skinning packs
// influenceStart (20 bits) | influenceCount - 1 (4 bits) | alphaLabel (8 bits, 0 = none).
uniform highp usampler2D u_skinInfluences;
uniform highp sampler2D u_skinMatrices;

layout(location = 1) in uint a_skinning;

ivec2 getSkinTableCoord(uint index, int width) {
    return ivec2(int(index % uint(width)), int(index / uint(width)));
}

vec3 skinPosition(vec3 position, uint matrixOffset) {
    uint influenceStart = a_skinning & 0xFFFFFu;
    uint influenceCount = ((a_skinning >> 20u) & 0xFu) + 1u;
    int influenceWidth = textureSize(u_skinInfluences, 0).x;
    int matrixWidth = textureSize(u_skinMatrices, 0).x;
    vec4 point = vec4(position, 1.0);
    vec3 result = vec3(0.0);
    for (uint index = 0u; index < influenceCount; index++) {
        uint influence = texelFetch(
            u_skinInfluences,
            getSkinTableCoord(influenceStart + index, influenceWidth),
            0
        ).r;
        uint matrixIndex = influence & 0xFFFFu;
        float weight = float((influence >> 16u) & 0xFFu) / 255.0;
        uint rowOffset = matrixOffset + matrixIndex * 3u;
        vec4 row0 = texelFetch(u_skinMatrices, getSkinTableCoord(rowOffset, matrixWidth), 0);
        vec4 row1 = texelFetch(u_skinMatrices, getSkinTableCoord(rowOffset + 1u, matrixWidth), 0);
        vec4 row2 = texelFetch(u_skinMatrices, getSkinTableCoord(rowOffset + 2u, matrixWidth), 0);
        result += vec3(dot(row0, point), dot(row1, point), dot(row2, point)) * weight;
    }
    return result;
}

float skinAlpha(float renderedAlpha, uint alphaOffset) {
    uint alphaLabel = a_skinning >> 24u;
    if (alphaLabel == 0u) {
        return renderedAlpha;
    }
    vec3 transform = texelFetch(
        u_skinMatrices,
        getSkinTableCoord(alphaOffset + alphaLabel - 1u, textureSize(u_skinMatrices, 0).x),
        0
    ).rgb;
    float sourceAlpha = 255.0 - renderedAlpha * 255.0;
    return (255.0 - clamp(sourceAlpha + transform.x, transform.y, transform.z)) / 255.0;
}

// Every corner of a face shares its alpha label, so a face faded out by its sequence moves all
// three corners outside the clip volume together.
vec4 hideFadedSkinnedVertex(vec4 clipPosition, float alpha) {
    return alpha <= (1.0 / 255.0) ? vec4(2.0, 2.0, 2.0, 1.0) : clipPosition;
}
