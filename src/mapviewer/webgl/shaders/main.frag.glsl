#version 300 es

precision highp float;

layout(std140, column_major) uniform;

#include "./includes/scene-uniforms.glsl";

uniform highp sampler2DArray u_textures;

in vec4 v_color;
in vec2 v_texCoord;
flat in uint v_texId;
flat in float v_alphaCutOff;
in float v_fogAmount;
flat in vec4 v_interactId;
#ifdef NPC_PROGRAM
in float v_highlight;
#else
in float v_roofHidden;
#endif

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 interactId;

void main() {
#ifndef NPC_PROGRAM
    if (v_roofHidden > 0.5) {
        discard;
    }
#endif
    vec4 textureColor = texture(u_textures, vec3(v_texCoord, v_texId)).bgra;
    fragColor = pow(textureColor, vec4(vec3(u_brightness), 1.0)) *
        vec4(round(v_color.rgb * u_colorBanding) / u_colorBanding, v_color.a);
#ifdef DISCARD_ALPHA
    if ((v_texId == 0u && fragColor.a < 0.01) || (textureColor.a < v_alphaCutOff)) {
        discard;
    }
#endif
#ifdef NPC_PROGRAM
    fragColor.rgb = mix(fragColor.rgb, vec3(1.0), v_highlight * 0.35);
#endif
    fragColor = mix(fragColor, u_skyColor, v_fogAmount);
    interactId = v_interactId;
}
