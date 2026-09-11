#version 300 es

#include "./includes/multi-draw.glsl";

#define TEXTURE_ANIM_UNIT (1.0f / 128.0f)

#define PI  3.141592653589793238462643383279
#define TAU 6.283185307179586476925286766559
// TAU / 2048.0
#define RS_TO_RADIANS 0.00306796157

#define FOG_CORNER_ROUNDING 8.0

#define INTERACT_TYPE_ENEMY 4u

precision highp float;

layout(std140, column_major) uniform;

uniform highp isampler2D u_textureMaterials;

#include "./includes/scene-uniforms.glsl";

uniform float u_timeLoaded;

uniform int u_highlightId;

uniform highp usampler2D u_actorDataTexture;
uniform highp usampler2D u_actorInfluences;
uniform highp sampler2D u_actorMatrices;

layout(location = 0) in uvec3 a_vertex;
layout(location = 1) in uint a_skinning;

out vec4 v_color;
out vec2 v_texCoord;
flat out uint v_texId;
flat out float v_alphaCutOff;
out float v_fogAmount;
out float v_highlight;

#include "./includes/branchless-logic.glsl";
#include "./includes/hsl-to-rgb.glsl";
#include "./includes/unpack-float.glsl";
#include "./includes/fog.glsl";

#include "./includes/material.glsl";

#include "./includes/vertex.glsl";

// Keep in sync with ACTOR_INSTANCE_TEXELS in ActorInstanceData.ts: each instance occupies this
// many consecutive RGBA32UI texels (a plain rotation/level/interactId/interactType texel, plus a
// second texel whose r-channel carries pitch - the first texel's packed component has no bits
// left to spare).
#define ACTOR_INSTANCE_TEXELS 2

struct ActorInfo {
    vec2 worldPos;
    float groundHeight;
    uint level;
    uint rotation;
    uint interactId;
    uint interactType;
    uint pitch;
    uint matrixOffset;
    uint alphaOffset;
};

ivec2 getDataTexCoordFromIndex(int index) {
    return ivec2(index % 16, index / 16);
}

ActorInfo decodeActorInfo(int index) {
    int instanceIndex = index + gl_InstanceID;
    uvec4 data = texelFetch(
        u_actorDataTexture,
        getDataTexCoordFromIndex(instanceIndex * ACTOR_INSTANCE_TEXELS),
        0
    );
    uvec4 data2 = texelFetch(
        u_actorDataTexture,
        getDataTexCoordFromIndex(instanceIndex * ACTOR_INSTANCE_TEXELS + 1),
        0
    );

    ActorInfo info;

    info.worldPos = vec2(float(data.r), float(data.g));
    info.groundHeight = float(int(data.b));

    info.interactType = data.a & 0x7u;
    info.level = (data.a >> 3) & 0x3u;
    info.rotation = (data.a >> 5) & 0x7FFu;
    info.interactId = data.a >> 16;

    info.pitch = data2.r & 0x7FFu;
    info.matrixOffset = data2.g;
    info.alphaOffset = data2.b;

    return info;
}

ivec2 getActorTableCoord(uint index, int width) {
    return ivec2(int(index % uint(width)), int(index / uint(width)));
}

vec3 skinPosition(vec3 position, ActorInfo actorInfo) {
    uint influenceStart = a_skinning & 0xFFFFFu;
    uint influenceCount = ((a_skinning >> 20u) & 0xFu) + 1u;
    int influenceWidth = textureSize(u_actorInfluences, 0).x;
    int matrixWidth = textureSize(u_actorMatrices, 0).x;
    vec3 result = vec3(0.0);
    for (uint index = 0u; index < influenceCount; index++) {
        uint influence = texelFetch(u_actorInfluences, getActorTableCoord(influenceStart + index, influenceWidth), 0).r;
        uint matrixIndex = influence & 0xFFFFu;
        float weight = float((influence >> 16u) & 0xFFu) / 255.0;
        uint matrixOffset = actorInfo.matrixOffset + matrixIndex * 3u;
        vec4 row0 = texelFetch(u_actorMatrices, getActorTableCoord(matrixOffset, matrixWidth), 0);
        vec4 row1 = texelFetch(u_actorMatrices, getActorTableCoord(matrixOffset + 1u, matrixWidth), 0);
        vec4 row2 = texelFetch(u_actorMatrices, getActorTableCoord(matrixOffset + 2u, matrixWidth), 0);
        vec4 point = vec4(position, 1.0);
        result += vec3(dot(row0, point), dot(row1, point), dot(row2, point)) * weight;
    }
    return result;
}

float animatedAlpha(float renderedAlpha, ActorInfo actorInfo) {
    uint alphaLabel = a_skinning >> 24u;
    if (alphaLabel == 0u) {
        return renderedAlpha;
    }
    vec3 transform = texelFetch(
        u_actorMatrices,
        getActorTableCoord(
            actorInfo.alphaOffset + alphaLabel - 1u,
            textureSize(u_actorMatrices, 0).x
        ),
        0
    ).rgb;
    float sourceAlpha = 255.0 - renderedAlpha * 255.0;
    return (255.0 - clamp(sourceAlpha + transform.x, transform.y, transform.z)) / 255.0;
}

mat4 rotationY( in float angle ) {
    return mat4(cos(angle),		0,		sin(angle),	0,
                         0,		1.0,			 0,	0,
                -sin(angle),	0,		cos(angle),	0,
                        0, 		0,				0,	1);
}

// Pitches the model about its local left/right axis (perpendicular to its forward/heading axis),
// applied before rotationY so a projectile's nose tilts in its own flight plane before that plane
// is yawed to face its world-space heading.
mat4 rotationX( in float angle ) {
    return mat4(1.0,		0,				0,			0,
                0,		cos(angle),		sin(angle),	0,
                0,		-sin(angle),	cos(angle),	0,
                0,		0,				0,			1);
}

void main() {
    Vertex vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, u_brightness);

    v_color = vertex.color;

    Material material = getMaterial(vertex.textureId);
    vec2 textureAnimation = vec2(material.animU, material.animV);

    if (u_isNewTextureAnim > 0.5) {
        v_texCoord = vertex.texCoord + mod(mod(u_currentTime, 128.0) * textureAnimation / 64.0, 1.0);
    } else {
        v_texCoord = vertex.texCoord + (u_currentTime / 0.02) * textureAnimation * TEXTURE_ANIM_UNIT;
    }
    v_texId = vertex.textureId;
    v_alphaCutOff = material.alphaCutOff;

    ActorInfo actorInfo = decodeActorInfo(DRAW_ID);
    vertex.pos = skinPosition(vertex.pos, actorInfo);
    vertex.color.a = animatedAlpha(vertex.color.a, actorInfo);
    v_color = vertex.color;

    v_highlight = float(
        u_highlightId != 0 &&
        actorInfo.interactType == INTERACT_TYPE_ENEMY &&
        int(actorInfo.interactId) == u_highlightId
    );

    vec4 localPos = vec4(vertex.pos, 1.0)
        * rotationX(float(actorInfo.pitch) * RS_TO_RADIANS)
        * rotationY(float(actorInfo.rotation) * RS_TO_RADIANS)
        + vec4(actorInfo.worldPos.x, 0, actorInfo.worldPos.y, 0.0);

    localPos.y -= actorInfo.groundHeight;

    localPos /= vec4(vec3(128.0), 1.0);

    float loadAlpha = smoothstep(0.0, 1.0, min((u_currentTime - u_timeLoaded), 1.0));
    float isLoading = when_neq(loadAlpha, 1.0);

    float dist = -sdRoundedBox(
        vec2(localPos.x - u_cameraPos.x, localPos.z - u_cameraPos.y),
        vec2(u_renderDistance),
        FOG_CORNER_ROUNDING
    );

    float fogDepth = min(u_fogDepth, u_renderDistance);

    v_fogAmount = fogFactorLinear(dist, 0.0, fogDepth);
    v_fogAmount = isLoading * max(1.0 - loadAlpha, v_fogAmount) +
        (1.0 - isLoading) * v_fogAmount;

    gl_Position = u_viewMatrix * localPos;
    gl_Position.z += float(actorInfo.level) * 0.005 + (float(vertex.priority) + 20.0) * 0.0007;
    gl_Position = u_projectionMatrix * gl_Position;
    if (vertex.color.a <= (1.0 / 255.0)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
}
