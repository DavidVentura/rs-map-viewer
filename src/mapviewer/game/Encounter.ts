import { MapSquareCoord } from "../../rs/map/MapSquareCoord";
import { Scene } from "../../rs/scene/Scene";
import { WeaponStyle } from "./Ability";
import { EnemyTypeId } from "./EnemyType";
import { EquipmentGrant, styleSetGrant } from "./Equipment";
import {
    Interaction,
    WorldObject,
    WorldObjectKind,
    createInteraction,
    createInteractionId,
    createWorldObject,
    createWorldObjectId,
    createWorldPosition,
} from "./Interaction";
import { TransformableGroundDecorations, isTileInMapSquare } from "./LocTransform";
import { Phase, createPhase, createPhaseId } from "./Phase";
import { createRewardId, createUpgradeChoiceReward } from "./Reward";
import { createNamedEquipmentGrantReward } from "./Reward";
import {
    WARDEN_P3_ARENA_ROW_COUNT,
    WARDEN_P3_FLOOR_DECORATIONS,
    WARDEN_P3_SOLO_SIPHON_LAYOUT,
    WARDEN_P3_SPAWN_TILE,
} from "./WardenP3Arena";
import { WardenP3Arena } from "./WardenP3Director";
import { WardenP3SiphonLayout, validateWardenP3SiphonLayout } from "./WardenP3SiphonLayout";
import { UpgradeId } from "./upgrades";

export type { MapSquareCoord };

export enum EncounterId {
    LUMBRIDGE = "lumbridge",
    FIGHT_CAVES = "fightcaves",
    QUICK_CAVE = "quickcave",
    SANDBOX = "sandbox",
    WARDENS_P3 = "wardensp3",
}

export type PlayerSpawn = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type EnemySpawnPoint = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
};

export type WaveGroup = {
    readonly enemyTypeId: EnemyTypeId;
    readonly count: number;
};

// A wave is due once the previous wave has died down to at most maxPreviousAliveFraction of its
// spawned size, or maxElapsedSeconds have passed since the previous wave started, whichever comes
// first. This lets later waves overlap the tail of earlier ones instead of waiting for a clear. It
// then starts delaySeconds after becoming due, so even a fast clear leaves a breather.
export type WaveStartCondition = {
    readonly maxPreviousAliveFraction: number;
    readonly maxElapsedSeconds: number;
    readonly delaySeconds: number;
};

export type WaveModifiers = {
    readonly healthMultiplier?: number;
    readonly speedMultiplier?: number;
};

export type Wave = {
    readonly groups: readonly WaveGroup[];
    readonly startCondition: WaveStartCondition;
    readonly modifiers?: WaveModifiers;
    // A boss wave only starts once every earlier wave has died down to nothing (its own
    // startCondition is ignored), and no later wave starts until it is itself cleared: it never
    // overlaps with what comes before or after it. See WaveDirector's stepWaveDirector.
    readonly boss?: boolean;
};

export enum EncounterSpawnMode {
    // A fixed set of enemies, one per enemySpawns point, that respawn at their own spawn point
    // after a delay (the current Lumbridge behavior). Always exactly one, never-ending wave.
    STATIC_RESPAWN = "static_respawn",
    // WaveDirector-driven: enemySpawns is a location pool the director draws from, dead enemies
    // do not respawn, and the encounter ends once every wave is spawned and cleared.
    WAVES = "waves",
    // The animation viewer's debug mode: no waves and no static roster. The NPC_SEQS preview's one
    // enemy is spawned directly by the renderer with a previewSeq set; the SPOT_ANIMS preview
    // spawns no enemy at all, only a hovering gfx at enemySpawns[0] (see AnimPreview.ts).
    PREVIEW = "preview",
    SCRIPTED = "scripted",
}

// Pitch and yaw in RS angle units (2048 per turn); pitch is negative looking down.
export type CameraFraming = {
    readonly pitch: number;
    readonly yaw: number;
};

type EncounterCommon = {
    readonly id: EncounterId;
    readonly mapSquares: readonly MapSquareCoord[];
    readonly playerSpawn: PlayerSpawn;
    readonly enemySpawns: readonly EnemySpawnPoint[];
    readonly enemyTypeIds: readonly EnemyTypeId[];
    readonly waves: readonly Wave[];
    readonly ambientNpcs: boolean;
    readonly musicFile: string;
    readonly initialCamera: CameraFraming;
    readonly maximumRenderedLevel: number;
    readonly transformableGroundDecorations: readonly TransformableGroundDecorations[];
};

export type WaveEncounter = EncounterCommon & {
    readonly spawnMode: EncounterSpawnMode.WAVES;
    readonly phases: readonly [Phase, ...Phase[]];
    readonly worldObjects: readonly WorldObject[];
    readonly interactions: readonly Interaction[];
};

export type StaticRespawnEncounter = EncounterCommon & {
    readonly spawnMode: EncounterSpawnMode.STATIC_RESPAWN;
    readonly phases: readonly [];
    readonly worldObjects: readonly [];
    readonly interactions: readonly [];
};

export type PreviewEncounter = EncounterCommon & {
    readonly spawnMode: EncounterSpawnMode.PREVIEW;
    readonly phases: readonly [];
    readonly worldObjects: readonly [];
    readonly interactions: readonly [];
};

export enum EncounterScriptKind {
    WARDENS_P3 = "wardens_p3",
}

export type WardenPhantomSpawn = {
    readonly x: number;
    readonly y: number;
    readonly level: number;
    readonly enemyTypeId: EnemyTypeId;
};

export type WardensP3Script = {
    readonly kind: EncounterScriptKind.WARDENS_P3;
    readonly wardenSpawn: EnemySpawnPoint;
    readonly phantomSpawns: readonly WardenPhantomSpawn[];
    readonly arena: WardenP3Arena;
    readonly siphonLayout: WardenP3SiphonLayout;
};

export type ScriptedEncounter = EncounterCommon & {
    readonly spawnMode: EncounterSpawnMode.SCRIPTED;
    readonly script: WardensP3Script;
    readonly phases: readonly [];
    readonly worldObjects: readonly [];
    readonly interactions: readonly [];
};

export type Encounter =
    | WaveEncounter
    | StaticRespawnEncounter
    | PreviewEncounter
    | ScriptedEncounter;

function assertUnique(values: readonly string[], description: string): void {
    if (new Set(values).size !== values.length) {
        throw new RangeError(`An encounter cannot contain duplicate ${description}`);
    }
}

// One shared lever starts every phase and one shared chest hands out every phase's rewards, so
// several interactions (one per phase) legitimately target the same object - what must stay unique
// is each interaction's own id (checked in validateEncounter) and each declared object's id.
function validatePhaseInteractions(encounter: WaveEncounter): void {
    const phaseIds = new Set(encounter.phases.map((phase) => phase.id));
    const actionCounts = new Map<string, { start: number; rewards: number }>();
    for (const phase of encounter.phases) {
        actionCounts.set(phase.id, { start: 0, rewards: 0 });
    }

    const objectsById = new Map(encounter.worldObjects.map((object) => [object.id, object]));
    const leverCount = encounter.worldObjects.filter(
        (object) => object.kind === WorldObjectKind.LEVER,
    ).length;
    const chestCount = encounter.worldObjects.filter(
        (object) => object.kind === WorldObjectKind.CHEST,
    ).length;
    if (leverCount !== 1) {
        throw new RangeError("An encounter with phases requires exactly one lever");
    }
    if (chestCount !== 1) {
        throw new RangeError("An encounter with phases requires exactly one chest");
    }

    for (const interaction of encounter.interactions) {
        const object = objectsById.get(interaction.objectId);
        if (!object) {
            throw new RangeError(
                `Interaction ${interaction.id} references an undeclared world object`,
            );
        }
        if (!phaseIds.has(interaction.action.phaseId)) {
            throw new RangeError(
                `Interaction ${interaction.id} references an unknown phase ${interaction.action.phaseId}`,
            );
        }
        const expectedKind =
            interaction.action.kind === "START_PHASE"
                ? WorldObjectKind.LEVER
                : WorldObjectKind.CHEST;
        if (object.kind !== expectedKind) {
            throw new RangeError(`Interaction ${interaction.id} must target a ${expectedKind}`);
        }
        const counts = actionCounts.get(interaction.action.phaseId);
        if (!counts) {
            throw new Error(`Missing action counts for phase ${interaction.action.phaseId}`);
        }
        if (interaction.action.kind === "START_PHASE") {
            counts.start++;
        } else {
            counts.rewards++;
        }
    }

    for (const phase of encounter.phases) {
        const counts = actionCounts.get(phase.id);
        if (!counts) {
            throw new Error(`Missing action counts for phase ${phase.id}`);
        }
        if (counts.start !== 1) {
            throw new RangeError(`Phase ${phase.id} requires exactly one start interaction`);
        }
        const expectedRewardInteractions = phase.rewards.length === 0 ? 0 : 1;
        if (counts.rewards !== expectedRewardInteractions) {
            throw new RangeError(
                `Phase ${phase.id} requires ${expectedRewardInteractions} reward interaction`,
            );
        }
    }
}

function validateTransformableGroundDecorations(
    encounter: Encounter,
    declaration: TransformableGroundDecorations,
): void {
    if (
        !Number.isInteger(declaration.level) ||
        declaration.level < 0 ||
        declaration.level > encounter.maximumRenderedLevel
    ) {
        throw new RangeError(
            `Transformable ground decorations must sit on a rendered level (0..${encounter.maximumRenderedLevel})`,
        );
    }
    if (declaration.locIds.length === 0) {
        throw new RangeError("Transformable ground decorations must name at least one loc id");
    }
    assertUnique(
        declaration.tiles.map((tile) => `${tile.x},${tile.y}`),
        "transformable ground decoration tiles",
    );
    for (const tile of declaration.tiles) {
        if (!encounter.mapSquares.some((square) => isTileInMapSquare(tile, square))) {
            throw new RangeError(
                `Transformable ground decoration tile ${tile.x},${tile.y} lies outside the encounter's map squares`,
            );
        }
    }
}

function validateScriptedEncounter(encounter: ScriptedEncounter): void {
    switch (encounter.script.kind) {
        case EncounterScriptKind.WARDENS_P3:
            if (!encounter.enemyTypeIds.includes(EnemyTypeId.TUMEKENS_WARDEN)) {
                throw new RangeError("Wardens P3 requires Tumeken's Warden in its enemy types");
            }
            validateWardenP3SiphonLayout(encounter.script.siphonLayout);
            return;
    }
}

export function validateEncounter(encounter: Encounter): void {
    if (
        !Number.isInteger(encounter.maximumRenderedLevel) ||
        encounter.maximumRenderedLevel < 0 ||
        encounter.maximumRenderedLevel >= Scene.MAX_LEVELS
    ) {
        throw new RangeError(
            `Encounter maximum rendered level must be within 0..${Scene.MAX_LEVELS - 1}`,
        );
    }
    for (const declaration of encounter.transformableGroundDecorations) {
        validateTransformableGroundDecorations(encounter, declaration);
    }
    assertUnique(encounter.enemyTypeIds, "enemy type ids");
    for (const wave of encounter.waves) {
        for (const group of wave.groups) {
            if (!encounter.enemyTypeIds.includes(group.enemyTypeId)) {
                throw new RangeError(`Wave references undeclared enemy type ${group.enemyTypeId}`);
            }
        }
    }

    if (encounter.spawnMode !== EncounterSpawnMode.WAVES) {
        if (encounter.phases.length !== 0 || encounter.interactions.length !== 0) {
            throw new RangeError("Only wave encounters can declare phases or interactions");
        }
        if (encounter.spawnMode === EncounterSpawnMode.SCRIPTED && encounter.waves.length !== 0) {
            throw new RangeError("Scripted encounters cannot declare waves");
        }
        if (encounter.spawnMode === EncounterSpawnMode.SCRIPTED) {
            validateScriptedEncounter(encounter);
        }
        return;
    }

    assertUnique(
        encounter.phases.map((phase) => phase.id),
        "phase ids",
    );
    assertUnique(
        encounter.worldObjects.map((object) => String(object.id)),
        "world object ids",
    );
    assertUnique(
        encounter.interactions.map((interaction) => interaction.id),
        "interaction ids",
    );
    assertUnique(
        encounter.phases.flatMap((phase) => phase.rewards.map((reward) => reward.id)),
        "reward ids",
    );

    const phaseWaves = encounter.phases.flatMap((phase) => phase.waves);
    if (
        phaseWaves.length !== encounter.waves.length ||
        phaseWaves.some((wave, index) => wave !== encounter.waves[index])
    ) {
        throw new RangeError("Encounter phases must partition its waves in authored order");
    }
    validatePhaseInteractions(encounter);
}

function tileToWorld(tileX: number, tileY: number, tileCenter: boolean = false): [number, number] {
    const offset = tileCenter ? 64 : 0;
    return [tileX * 128 + offset, tileY * 128 + offset];
}

const DEFAULT_CAMERA_FRAMING: CameraFraming = { pitch: -245, yaw: 1862 };

const LUMBRIDGE_PLAYER_TILE = { x: 3237, y: 3225 };
const [lumbridgePlayerX, lumbridgePlayerY] = tileToWorld(
    LUMBRIDGE_PLAYER_TILE.x,
    LUMBRIDGE_PLAYER_TILE.y,
);

const LUMBRIDGE_GOBLIN_TILE_OFFSETS = [
    { x: 3, y: 1 },
    { x: -3, y: 1 },
    { x: 1, y: -3 },
    { x: -1, y: 3 },
];

// The player's square and the ring around it: the camera sees past one square's edges, and the
// world holds only the squares an encounter declares.
const LUMBRIDGE_MAP_SQUARES: readonly MapSquareCoord[] = [-1, 0, 1].flatMap((dx) =>
    [-1, 0, 1].map((dy) => ({
        mapX: (LUMBRIDGE_PLAYER_TILE.x >> 6) + dx,
        mapY: (LUMBRIDGE_PLAYER_TILE.y >> 6) + dy,
    })),
);

const LUMBRIDGE: StaticRespawnEncounter = {
    id: EncounterId.LUMBRIDGE,
    mapSquares: LUMBRIDGE_MAP_SQUARES,
    playerSpawn: { x: lumbridgePlayerX, y: lumbridgePlayerY, level: 0 },
    enemySpawns: LUMBRIDGE_GOBLIN_TILE_OFFSETS.map((offset) => {
        const [x, y] = tileToWorld(
            LUMBRIDGE_PLAYER_TILE.x + offset.x,
            LUMBRIDGE_PLAYER_TILE.y + offset.y,
            true,
        );
        return { x, y, level: 0 };
    }),
    enemyTypeIds: [EnemyTypeId.GOBLIN],
    spawnMode: EncounterSpawnMode.STATIC_RESPAWN,
    ambientNpcs: true,
    musicFile: "audio/harmony.opus",
    initialCamera: DEFAULT_CAMERA_FRAMING,
    maximumRenderedLevel: Scene.MAX_LEVELS - 1,
    transformableGroundDecorations: [],
    phases: [],
    worldObjects: [],
    interactions: [],
    waves: [
        {
            groups: [
                { enemyTypeId: EnemyTypeId.GOBLIN, count: LUMBRIDGE_GOBLIN_TILE_OFFSETS.length },
            ],
            startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0, delaySeconds: 0 },
        },
    ],
};

const FIGHT_CAVES_PLAYER_TILE = { x: 2398, y: 5078 };
const [fightCavesPlayerX, fightCavesPlayerY] = tileToWorld(
    FIGHT_CAVES_PLAYER_TILE.x,
    FIGHT_CAVES_PLAYER_TILE.y,
);

const FIGHT_CAVES_ENEMY_TILE_OFFSETS = [
    { x: 3, y: 1 },
    { x: -3, y: 1 },
    { x: 1, y: -3 },
    { x: -1, y: 3 },
    { x: 4, y: -2 },
    { x: -4, y: 2 },
    { x: 2, y: 4 },
    { x: -2, y: -4 },
];

const FIGHT_CAVES_EARLY_START: WaveStartCondition = {
    maxPreviousAliveFraction: 0.4,
    maxElapsedSeconds: 9,
    delaySeconds: 5,
};
const FIGHT_CAVES_LATE_START: WaveStartCondition = {
    maxPreviousAliveFraction: 0.25,
    maxElapsedSeconds: 7,
    delaySeconds: 5,
};

// TzTok-Jad, the finale: only starts once every earlier wave is fully dead (see Wave.boss), so its
// own startCondition numbers are never actually consulted.
const JAD_BOSS_WAVE: Wave = {
    groups: [{ enemyTypeId: EnemyTypeId.TZTOK_JAD, count: 1 }],
    startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: Infinity, delaySeconds: 0 },
    boss: true,
};

const AUTHORED_UPGRADE_CHOICES = [
    UpgradeId.DAMAGE_UP,
    UpgradeId.SWIFT_STRIKES,
    UpgradeId.QUICK_HANDS,
];

// HUMAN_LEVERDOWN: a generic humanoid lever-pull animation. The lever loc itself has no animation
// of its own in this cache, so it swaps between its up/down locs instead (see WORLD_OBJECT_BAKES
// in assets/ActorAssets.ts).
const LEVER_INTERACTION_ANIMATION_SEQ_ID = 834;
// HUMAN_OPENCHEST. Likewise, the chest swaps between its closed/open locs.
const CHEST_INTERACTION_ANIMATION_SEQ_ID = 536;

type PhaseDraft = {
    readonly id: string;
    readonly label: string;
    readonly waves: readonly Wave[];
    readonly grantsUpgrade: boolean;
    readonly guaranteedEquipment?: EquipmentGrant;
};

function createEncounterPhases(
    encounterPrefix: string,
    drafts: readonly [PhaseDraft, ...PhaseDraft[]],
): readonly [Phase, ...Phase[]] {
    const phases = drafts.map((draft) =>
        createPhase(
            createPhaseId(`${encounterPrefix}_${draft.id}`),
            draft.label,
            draft.waves,
            { kind: "ALL_WAVES_CLEARED" },
            [
                ...(draft.grantsUpgrade
                    ? [
                          createUpgradeChoiceReward(
                              createRewardId(`${encounterPrefix}_${draft.id}_upgrade`),
                              AUTHORED_UPGRADE_CHOICES,
                          ),
                      ]
                    : []),
                ...(draft.guaranteedEquipment
                    ? [
                          createNamedEquipmentGrantReward(
                              createRewardId(`${encounterPrefix}_${draft.id}_equipment`),
                              draft.guaranteedEquipment,
                          ),
                      ]
                    : []),
            ],
        ),
    );
    return [phases[0], ...phases.slice(1)];
}

const LEVER_WORLD_OBJECT_ID = createWorldObjectId(1);
const CHEST_WORLD_OBJECT_ID = createWorldObjectId(2);

export type EncounterWorldObjects = {
    readonly lever: WorldObject;
    readonly chest: WorldObject;
};

// One lever and one chest per encounter, a few tiles either side of the player spawn on the same
// row (flat cave floor, clear of every enemy spawn offset). The lever faces east so a player
// walking up from the spawn approaches from directly in front of it; the chest mirrors that facing
// west. See WorldObject.orientation/worldObjectApproachPose for how orientation drives both the
// object's own facing and the player's approach tile.
function createEncounterWorldObjects(playerSpawn: PlayerSpawn): EncounterWorldObjects {
    return {
        lever: createWorldObject(
            LEVER_WORLD_OBJECT_ID,
            WorldObjectKind.LEVER,
            createWorldPosition(playerSpawn.x - 5 * 128, playerSpawn.y, playerSpawn.level),
            1,
        ),
        chest: createWorldObject(
            CHEST_WORLD_OBJECT_ID,
            WorldObjectKind.CHEST,
            createWorldPosition(playerSpawn.x + 5 * 128, playerSpawn.y, playerSpawn.level),
            3,
        ),
    };
}

function createPhaseInteractions(
    encounterPrefix: string,
    phases: readonly [Phase, ...Phase[]],
    worldObjects: EncounterWorldObjects,
): readonly Interaction[] {
    const interactions: Interaction[] = [];
    for (const phase of phases) {
        interactions.push(
            createInteraction(
                createInteractionId(`${encounterPrefix}_${phase.id}_start`),
                worldObjects.lever.id,
                "Pull Lever",
                { kind: "START_PHASE", phaseId: phase.id },
                LEVER_INTERACTION_ANIMATION_SEQ_ID,
            ),
        );
        if (phase.rewards.length === 0) {
            continue;
        }
        interactions.push(
            createInteraction(
                createInteractionId(`${encounterPrefix}_${phase.id}_rewards`),
                worldObjects.chest.id,
                "Open Chest",
                { kind: "ACTIVATE_PHASE_REWARDS", phaseId: phase.id },
                CHEST_INTERACTION_ANIMATION_SEQ_ID,
            ),
        );
    }
    return interactions;
}

const FIGHT_CAVES_WAVES: readonly Wave[] = [
    {
        groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 4 }],
        startCondition: { maxPreviousAliveFraction: 1, maxElapsedSeconds: 0, delaySeconds: 0 },
    },
    {
        groups: [{ enemyTypeId: EnemyTypeId.TZ_KIH, count: 6 }],
        startCondition: FIGHT_CAVES_EARLY_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 8 },
            { enemyTypeId: EnemyTypeId.TZ_KEK, count: 1 },
        ],
        startCondition: FIGHT_CAVES_EARLY_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 10 },
            { enemyTypeId: EnemyTypeId.TOK_XIL, count: 1 },
        ],
        startCondition: FIGHT_CAVES_EARLY_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 10 },
            { enemyTypeId: EnemyTypeId.TZ_KEK, count: 2 },
            { enemyTypeId: EnemyTypeId.TOK_XIL, count: 1 },
        ],
        startCondition: FIGHT_CAVES_LATE_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 14 },
            { enemyTypeId: EnemyTypeId.TOK_XIL, count: 1 },
            { enemyTypeId: EnemyTypeId.KET_ZEK, count: 1 },
        ],
        startCondition: FIGHT_CAVES_LATE_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 14 },
            { enemyTypeId: EnemyTypeId.TZ_KEK, count: 2 },
            { enemyTypeId: EnemyTypeId.TOK_XIL, count: 1 },
            { enemyTypeId: EnemyTypeId.KET_ZEK, count: 1 },
        ],
        startCondition: FIGHT_CAVES_LATE_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 18 },
            { enemyTypeId: EnemyTypeId.TZ_KEK, count: 3 },
            { enemyTypeId: EnemyTypeId.TOK_XIL, count: 1 },
            { enemyTypeId: EnemyTypeId.KET_ZEK, count: 1 },
            { enemyTypeId: EnemyTypeId.YT_MEJKOT, count: 1 },
        ],
        startCondition: FIGHT_CAVES_LATE_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 20 },
            { enemyTypeId: EnemyTypeId.TZ_KEK, count: 3 },
            { enemyTypeId: EnemyTypeId.TOK_XIL, count: 1 },
            { enemyTypeId: EnemyTypeId.KET_ZEK, count: 1 },
            { enemyTypeId: EnemyTypeId.YT_MEJKOT, count: 1 },
        ],
        startCondition: FIGHT_CAVES_LATE_START,
    },
    {
        groups: [
            { enemyTypeId: EnemyTypeId.TZ_KIH, count: 24 },
            { enemyTypeId: EnemyTypeId.TZ_KEK, count: 4 },
            { enemyTypeId: EnemyTypeId.TOK_XIL, count: 1 },
            { enemyTypeId: EnemyTypeId.KET_ZEK, count: 1 },
            { enemyTypeId: EnemyTypeId.YT_MEJKOT, count: 1 },
        ],
        startCondition: FIGHT_CAVES_LATE_START,
        modifiers: { healthMultiplier: 1.15 },
    },
    JAD_BOSS_WAVE,
];

const FIGHT_CAVES_PHASES = createEncounterPhases("fight_caves", [
    {
        id: "opening",
        label: "Opening skirmish",
        waves: FIGHT_CAVES_WAVES.slice(0, 3),
        grantsUpgrade: true,
        guaranteedEquipment: styleSetGrant(WeaponStyle.RANGED, 1),
    },
    {
        id: "pressure",
        label: "Rising pressure",
        waves: FIGHT_CAVES_WAVES.slice(3, 6),
        grantsUpgrade: true,
        guaranteedEquipment: styleSetGrant(WeaponStyle.MELEE, 1),
    },
    {
        id: "gauntlet",
        label: "The gauntlet",
        waves: FIGHT_CAVES_WAVES.slice(6, 9),
        grantsUpgrade: true,
        guaranteedEquipment: styleSetGrant(WeaponStyle.MAGIC, 1),
    },
    { id: "finale", label: "TzTok-Jad", waves: FIGHT_CAVES_WAVES.slice(9), grantsUpgrade: false },
]);

const FIGHT_CAVES_WORLD_OBJECTS = createEncounterWorldObjects({
    x: fightCavesPlayerX,
    y: fightCavesPlayerY,
    level: 0,
});

const FIGHT_CAVES: WaveEncounter = {
    id: EncounterId.FIGHT_CAVES,
    mapSquares: [
        { mapX: 36, mapY: 78 },
        { mapX: 37, mapY: 78 },
        { mapX: 38, mapY: 78 },
        { mapX: 36, mapY: 79 },
        { mapX: 37, mapY: 79 },
        { mapX: 38, mapY: 79 },
        { mapX: 37, mapY: 80 },
        { mapX: 38, mapY: 80 },
    ],
    playerSpawn: { x: fightCavesPlayerX, y: fightCavesPlayerY, level: 0 },
    enemySpawns: FIGHT_CAVES_ENEMY_TILE_OFFSETS.map((offset) => {
        const [x, y] = tileToWorld(
            FIGHT_CAVES_PLAYER_TILE.x + offset.x,
            FIGHT_CAVES_PLAYER_TILE.y + offset.y,
            true,
        );
        return { x, y, level: 0 };
    }),
    enemyTypeIds: [
        EnemyTypeId.TZ_KIH,
        EnemyTypeId.TZ_KEK,
        EnemyTypeId.TOK_XIL,
        EnemyTypeId.KET_ZEK,
        EnemyTypeId.YT_MEJKOT,
        EnemyTypeId.TZTOK_JAD,
        EnemyTypeId.YT_HURKOT,
    ],
    spawnMode: EncounterSpawnMode.WAVES,
    ambientNpcs: false,
    musicFile: "audio/tzhaar.opus",
    initialCamera: DEFAULT_CAMERA_FRAMING,
    maximumRenderedLevel: Scene.MAX_LEVELS - 1,
    transformableGroundDecorations: [],
    waves: FIGHT_CAVES_WAVES,
    phases: FIGHT_CAVES_PHASES,
    worldObjects: [FIGHT_CAVES_WORLD_OBJECTS.lever, FIGHT_CAVES_WORLD_OBJECTS.chest],
    interactions: createPhaseInteractions(
        "fight_caves",
        FIGHT_CAVES_PHASES,
        FIGHT_CAVES_WORLD_OBJECTS,
    ),
};

const QUICK_CAVE_REGULAR_ENEMY_TYPE_IDS = [
    EnemyTypeId.TOK_XIL,
    EnemyTypeId.YT_MEJKOT,
    EnemyTypeId.KET_ZEK,
];
const QUICK_CAVE_ENEMY_TYPE_IDS = [
    ...QUICK_CAVE_REGULAR_ENEMY_TYPE_IDS,
    EnemyTypeId.TZTOK_JAD,
    EnemyTypeId.YT_HURKOT,
];

const QUICK_CAVE_WAVES: readonly Wave[] = [
    ...QUICK_CAVE_REGULAR_ENEMY_TYPE_IDS.map((enemyTypeId) => ({
        groups: [{ enemyTypeId, count: 1 }],
        startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: 600, delaySeconds: 0 },
    })),
    JAD_BOSS_WAVE,
];

const QUICK_CAVE_PHASES = createEncounterPhases("quick_cave", [
    {
        id: "ranged",
        label: "Ranged trial",
        waves: QUICK_CAVE_WAVES.slice(0, 1),
        grantsUpgrade: true,
    },
    {
        id: "healing",
        label: "Healing trial",
        waves: QUICK_CAVE_WAVES.slice(1, 2),
        grantsUpgrade: true,
    },
    { id: "mage", label: "Mage trial", waves: QUICK_CAVE_WAVES.slice(2, 3), grantsUpgrade: true },
    { id: "jad", label: "TzTok-Jad", waves: QUICK_CAVE_WAVES.slice(3), grantsUpgrade: false },
]);

const QUICK_CAVE: WaveEncounter = {
    ...FIGHT_CAVES,
    id: EncounterId.QUICK_CAVE,
    enemyTypeIds: QUICK_CAVE_ENEMY_TYPE_IDS,
    waves: QUICK_CAVE_WAVES,
    phases: QUICK_CAVE_PHASES,
    interactions: createPhaseInteractions(
        "quick_cave",
        QUICK_CAVE_PHASES,
        FIGHT_CAVES_WORLD_OBJECTS,
    ),
};

// The ranged, mage and boss roster at once, in a single wave with no gating: a sandbox for tuning
// projectiles, animations and effects against the enemies that have them. Yt-HurKot isn't listed here since it never spawns directly, only as one
// of TzTok-Jad's phase adds (see EnemyType.ts); it still needs to be in enemyTypeIds so the loader
// preloads it for when that phase triggers.
const SANDBOX_WAVE_ENEMY_TYPE_IDS = [
    EnemyTypeId.TOK_XIL,
    EnemyTypeId.KET_ZEK,
    EnemyTypeId.TZTOK_JAD,
];

// The only wave, so shouldStartWave's index-0 special case starts it immediately regardless of
// this startCondition (see WaveDirector's shouldStartWave), the same way JAD_BOSS_WAVE's numbers
// above are never consulted.
const SANDBOX_WAVE: Wave = {
    groups: SANDBOX_WAVE_ENEMY_TYPE_IDS.map((enemyTypeId) => ({ enemyTypeId, count: 1 })),
    startCondition: { maxPreviousAliveFraction: 0, maxElapsedSeconds: 0, delaySeconds: 0 },
};

const SANDBOX_PHASES = createEncounterPhases("sandbox", [
    { id: "assault", label: "Sandbox assault", waves: [SANDBOX_WAVE], grantsUpgrade: false },
]);

const SANDBOX: WaveEncounter = {
    ...FIGHT_CAVES,
    id: EncounterId.SANDBOX,
    enemyTypeIds: [...SANDBOX_WAVE_ENEMY_TYPE_IDS, EnemyTypeId.YT_HURKOT],
    waves: [SANDBOX_WAVE],
    phases: SANDBOX_PHASES,
    interactions: createPhaseInteractions("sandbox", SANDBOX_PHASES, FIGHT_CAVES_WORLD_OBJECTS),
};

const WARDENS_P3_PLAYER_TILE = { x: 3936, y: 5162 };
const [wardensP3PlayerX, wardensP3PlayerY] = tileToWorld(
    WARDENS_P3_PLAYER_TILE.x,
    WARDENS_P3_PLAYER_TILE.y,
    true,
);
const [wardensP3WardenX, wardensP3WardenY] = tileToWorld(
    WARDEN_P3_SPAWN_TILE.x,
    WARDEN_P3_SPAWN_TILE.y,
    true,
);

const WARDENS_P3_PHANTOM_SPAWNS: readonly WardenPhantomSpawn[] = [
    { x: 3925, y: 5152, level: 0, enemyTypeId: EnemyTypeId.ZEBAK_PHANTOM },
    { x: 3943, y: 5152, level: 0, enemyTypeId: EnemyTypeId.BABA_PHANTOM },
];

const WARDENS_P3: ScriptedEncounter = {
    id: EncounterId.WARDENS_P3,
    mapSquares: [{ mapX: 61, mapY: 80 }],
    playerSpawn: { x: wardensP3PlayerX, y: wardensP3PlayerY, level: 0 },
    enemySpawns: [{ x: wardensP3WardenX, y: wardensP3WardenY, level: 0 }],
    enemyTypeIds: [
        EnemyTypeId.TUMEKENS_WARDEN,
        EnemyTypeId.ZEBAK_PHANTOM,
        EnemyTypeId.BABA_PHANTOM,
        EnemyTypeId.ENERGY_SIPHON,
    ],
    spawnMode: EncounterSpawnMode.SCRIPTED,
    ambientNpcs: false,
    musicFile: "audio/amascuts-promise.opus",
    initialCamera: { pitch: -245, yaw: 1024 },
    maximumRenderedLevel: 1,
    transformableGroundDecorations: [WARDEN_P3_FLOOR_DECORATIONS],
    waves: [],
    phases: [],
    worldObjects: [],
    interactions: [],
    script: {
        kind: EncounterScriptKind.WARDENS_P3,
        wardenSpawn: { x: wardensP3WardenX, y: wardensP3WardenY, level: 0 },
        phantomSpawns: WARDENS_P3_PHANTOM_SPAWNS,
        arena: { furthestRowFromWarden: WARDEN_P3_ARENA_ROW_COUNT },
        siphonLayout: WARDEN_P3_SOLO_SIPHON_LAYOUT,
    },
};

export const ENCOUNTERS: Readonly<Record<EncounterId, Encounter>> = {
    [EncounterId.LUMBRIDGE]: LUMBRIDGE,
    [EncounterId.FIGHT_CAVES]: FIGHT_CAVES,
    [EncounterId.QUICK_CAVE]: QUICK_CAVE,
    [EncounterId.SANDBOX]: SANDBOX,
    [EncounterId.WARDENS_P3]: WARDENS_P3,
};

export function getEncounter(id: EncounterId): Encounter {
    return ENCOUNTERS[id];
}

export function parseEncounterId(value: string | null): EncounterId {
    const match = Object.values(EncounterId).find((id) => id === value);
    return match ?? EncounterId.LUMBRIDGE;
}

// 3 tiles north of the player spawn: the fixed offset the animation viewer uses for its one
// preview enemy (NPC_SEQS mode) or its hovering gfx (SPOT_ANIMS mode).
const PREVIEW_ENEMY_TILE_OFFSET = 3;

// Builds a debug overlay on top of a normal encounter (reusing its map squares, player spawn and
// music) that spawns nothing on its own: the renderer spawns the NPC_SEQS preview's one enemy (or,
// for SPOT_ANIMS, nothing) directly, using enemySpawns[0] below purely as its fixed spot/to size
// the actor buffer.
export function buildPreviewEncounter(base: Encounter): PreviewEncounter {
    const enemySpawn: EnemySpawnPoint = {
        x: base.playerSpawn.x,
        y: base.playerSpawn.y + PREVIEW_ENEMY_TILE_OFFSET * 128,
        level: base.playerSpawn.level,
    };
    return {
        ...base,
        spawnMode: EncounterSpawnMode.PREVIEW,
        ambientNpcs: false,
        enemyTypeIds: [EnemyTypeId.PREVIEW],
        enemySpawns: [enemySpawn],
        waves: [],
        phases: [],
        worldObjects: [],
        interactions: [],
    };
}
