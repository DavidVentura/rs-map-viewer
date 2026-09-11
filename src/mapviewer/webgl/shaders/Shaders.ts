import { ACTOR_INSTANCE_TEXELS } from "../actor/ActorInstanceData";
import { NPC_INSTANCE_TEXELS } from "../npc/NpcInstanceData";
import { ProgramSource, ShaderDefine, prependDefines } from "./ShaderUtil";
import actorVertShader from "./actor.vert.glsl";
import frameFxaaFragShader from "./frame-fxaa.frag.glsl";
import frameFxaaVertShader from "./frame-fxaa.vert.glsl";
import frameFragShader from "./frame.frag.glsl";
import frameVertShader from "./frame.vert.glsl";
import mainFragShader from "./main.frag.glsl";
import mainVertShader from "./main.vert.glsl";
import npcVertShader from "./npc.vert.glsl";

export function createProgram(
    vertShader: string,
    fragShader: string,
    hasMultiDraw: boolean,
    discardAlpha: boolean,
): ProgramSource {
    const defines: string[] = [];
    if (hasMultiDraw) {
        defines.push("MULTI_DRAW");
    }
    if (discardAlpha) {
        defines.push("DISCARD_ALPHA");
    }
    return [prependDefines(vertShader, defines), prependDefines(fragShader, defines)];
}

export function createMainProgram(hasMultiDraw: boolean, discardAlpha: boolean): ProgramSource {
    return createProgram(mainVertShader, mainFragShader, hasMultiDraw, discardAlpha);
}

export function createNpcProgram(hasMultiDraw: boolean, discardAlpha: boolean): ProgramSource {
    const defines: ShaderDefine[] = [
        "NPC_PROGRAM",
        { name: "NPC_INSTANCE_TEXELS", value: NPC_INSTANCE_TEXELS },
    ];
    if (hasMultiDraw) {
        defines.push("MULTI_DRAW");
    }
    if (discardAlpha) {
        defines.push("DISCARD_ALPHA");
    }
    return [prependDefines(npcVertShader, defines), prependDefines(mainFragShader, defines)];
}

export function createActorProgram(hasMultiDraw: boolean, discardAlpha: boolean): ProgramSource {
    const defines: ShaderDefine[] = [
        "NPC_PROGRAM",
        { name: "ACTOR_INSTANCE_TEXELS", value: ACTOR_INSTANCE_TEXELS },
    ];
    if (hasMultiDraw) {
        defines.push("MULTI_DRAW");
    }
    if (discardAlpha) {
        defines.push("DISCARD_ALPHA");
    }
    return [prependDefines(actorVertShader, defines), prependDefines(mainFragShader, defines)];
}

export const FRAME_PROGRAM = [frameVertShader, frameFragShader];
export const FRAME_FXAA_PROGRAM = [frameFxaaVertShader, frameFxaaFragShader];
