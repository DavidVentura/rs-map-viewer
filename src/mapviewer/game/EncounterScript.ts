import { EncounterScriptKind } from "./Encounter";
import { Terrain } from "./Terrain";
import { WardenP3ArenaFloor } from "./WardenP3Arena";
import {
    WardenP3Command,
    WardenP3Intermission,
    WardenPhantom,
    WardenSlamTarget,
} from "./WardenP3Director";
import { FloorSlam } from "./WardenP3FloorSlam";

export type WardenP3RenderState = {
    readonly kind: EncounterScriptKind.WARDENS_P3;
    readonly commands: readonly WardenP3Command[];
    readonly aimedSlamTarget: WardenSlamTarget | undefined;
    readonly resolvedSlamTarget: WardenSlamTarget | undefined;
    readonly activeIntermission: WardenP3Intermission | undefined;
    readonly activePhantoms: readonly WardenPhantom[];
    readonly arenaFloor: WardenP3ArenaFloor;
    readonly floorSlams: readonly FloorSlam[];
};

export type EncounterScriptRenderState = WardenP3RenderState;

export interface EncounterScript {
    readonly renderState: EncounterScriptRenderState;
    step(): void;
    overlayTerrain(base: Terrain): Terrain;
}
