import { CombatEventKind, applyDamage, applyHeal } from "./CombatEvent";
import { Affects } from "./Effect";
import {
    EncounterScriptKind,
    WardenP3Sounds,
    WardenPhantomSpawn,
    WardensP3Script,
} from "./Encounter";
import {
    EncounterActor,
    EncounterActorKind,
    EnergySiphonActor,
    createEnergySiphonActor,
    createPhantomActor,
    encounterActorProjectileLaunchHeight,
    playEncounterActorSeq,
} from "./EncounterActor";
import { EncounterScript, WardenP3RenderState } from "./EncounterScript";
import { Enemy, EnemyState } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import { EnergySiphonState, energySiphonRecallStrikes, settleEnergySiphon } from "./EnergySiphon";
import { nonEmpty } from "./NonEmpty";
import { Player } from "./Player";
import {
    ENERGY_SIPHON_LAUNCH_FLIGHT,
    ENERGY_SIPHON_LEECH_SPEC,
    ENERGY_SIPHON_RECALL_FLIGHT,
    ProjectileSpec,
    ProjectileTarget,
    WARDENS_PULLED_TILE_FLIGHT,
    timedProjectileSpec,
} from "./Projectile";
import { SoundPlay } from "./SoundCue";
import { TILE_SIZE, Terrain } from "./Terrain";
import { VisualEffect, VisualEffectKind } from "./VisualEffect";
import { WardenP3Animations } from "./WardenP3Animations";
import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    WardenP3ArenaTileOccupancy,
    nearestOpenWardenP3Tile,
    pullWardenP3ArenaTiles,
    wardenP3ArenaTerrain,
    wardenP3ArenaTile,
    wardenP3TileOccupancy,
} from "./WardenP3Arena";
import {
    ParsedWardenP3Timing,
    PhantomAttackRelease,
    WARDEN_P3_HAZARD_TIMING,
    WardenP3Command,
    WardenP3Intermission,
    WardenP3Phase,
    WardenP3StartPhase,
    WardenP3State,
    WardenP3Tile,
    WardenPhantom,
    WardenSiphonStatus,
    WardenSlamTarget,
    beginWardenP3,
    parseWardenP3Timing,
    stepWardenP3,
    wardenP3HealthFloorFraction,
} from "./WardenP3Director";
import {
    WARDEN_P3_LIGHTNING,
    WARDEN_P3_PULLED_TILE_SKY,
    wardenP3LightningTargets,
    wardenP3PulledTileSkyPoint,
} from "./WardenP3Enrage";
import {
    FloorSlam,
    floorSlamEndsAtSeconds,
    floorSlamTilesArriving,
    wardenP3SlamShockwave,
} from "./WardenP3FloorSlam";
import {
    BABA_PHANTOM_ROCK_FALL,
    WARDEN_P3_PHANTOM_DAMAGE,
    ZEBAK_PHANTOM_SHOT,
    ZebakPhantomPiece,
    babaPhantomRockTargets,
    wardenPhantomEnemyTypeId,
} from "./WardenP3Phantoms";
import { WardenP3SiphonLayout, validateWardenP3SiphonLayout } from "./WardenP3SiphonLayout";
import {
    WardenP3SkullSwarm,
    validateWardenP3SkullSwarm,
    wardenP3SkullSwarmTiles,
} from "./WardenP3SkullSwarm";
import { WorldContext } from "./WorldContext";
import { FlightOrigin, FlightPoint, directionToRotation } from "./projectileMath";

// A hit on one floor tile once its telegraph runs out. A Ba-Ba rock's graphic plays its whole fall
// from the drop, so only a lightning bolt or Zebak's shot brings a graphic of its own to the strike.
type PendingTileStrike = {
    readonly tile: WardenP3Tile;
    readonly strikesAtSeconds: number;
    readonly damage: number;
    readonly strikeEffect: VisualEffectKind | undefined;
    readonly strikeSound: SoundPlay;
};

// Zebak's jug on its way up to burst over the tile the player stood on when it was thrown.
type RisingZebakJug = {
    readonly burstsAtSeconds: number;
    readonly burstTile: WardenP3Tile;
    readonly piece: ZebakPhantomPiece;
};

// Opened when the Warden throws its siphons. The deadline counts from their landing, so the time
// they spend in flight, where they cannot be struck, never eats into the player's window.
type SiphonWindow = {
    readonly deadlineAtSeconds: number;
    readonly nextLeechAtSeconds: number;
};

type PendingSiphonStrike = {
    readonly arrivesAtSeconds: number;
    readonly damage: number;
};

function playerWardenTile(player: Player): WardenP3Tile {
    return {
        x: Math.floor(player.x / TILE_SIZE),
        y: Math.floor(player.y / TILE_SIZE),
        level: player.level,
    };
}

function isSameWardenTile(a: WardenP3Tile, b: WardenP3Tile): boolean {
    return a.x === b.x && a.y === b.y && a.level === b.level;
}

function wardenTileCentre(tile: WardenP3Tile): FlightPoint {
    return { x: (tile.x + 0.5) * TILE_SIZE, y: (tile.y + 0.5) * TILE_SIZE };
}

export function startWardensP3Encounter(
    world: WorldContext,
    script: WardensP3Script,
): WardenP3Runtime {
    const { wardenSpawn, phantomSpawns, startPhase, siphonLayout, skullSwarm, sounds } = script;
    const wardenId = world.spawnEnemyAtExactPosition(
        wardenSpawn.x,
        wardenSpawn.y,
        wardenSpawn.level,
        world.animations.enemyType(EnemyTypeId.TUMEKENS_WARDEN),
    );
    world.findEnemy(wardenId)!.rotation = directionToRotation(0, 1);
    return new WardenP3Runtime(
        world,
        wardenId,
        siphonLayout,
        skullSwarm,
        phantomSpawns,
        sounds,
        startPhase,
    );
}

export class WardenP3Runtime implements EncounterScript {
    private readonly animations: WardenP3Animations;
    private readonly timing: ParsedWardenP3Timing;
    private state: WardenP3State;
    private siphonStatus = WardenSiphonStatus.NONE;
    private siphonWindow: SiphonWindow | undefined = undefined;
    private siphonStrikes: readonly PendingSiphonStrike[] = [];
    private skullSwarmIds: readonly number[] = [];
    private commands: readonly WardenP3Command[];
    private aimedSlamTarget: WardenSlamTarget | undefined = undefined;
    private resolvedSlamTarget: WardenSlamTarget | undefined = undefined;
    private activePhantoms: readonly WardenPhantom[] = [];
    private floor: WardenP3ArenaFloor = WARDEN_P3_INITIAL_ARENA_FLOOR;
    // Slams whose front is still travelling or whose last tiles are still settling.
    private floorSlams: readonly FloorSlam[] = [];
    // Arrivals up to this time have already hit, so each tile's arrival is resolved exactly once
    // even when it lands on a step boundary.
    private floorSlamsResolvedUntilSeconds: number;
    private tileStrikes: readonly PendingTileStrike[] = [];
    private risingZebakJugs: readonly RisingZebakJug[] = [];

    constructor(
        private readonly world: WorldContext,
        private readonly wardenId: number,
        private readonly siphonLayout: WardenP3SiphonLayout,
        private readonly skullSwarm: WardenP3SkullSwarm,
        private readonly phantomSpawns: readonly WardenPhantomSpawn[],
        private readonly sounds: WardenP3Sounds,
        startPhase: WardenP3StartPhase,
    ) {
        const warden = world.findEnemy(wardenId);
        if (!warden) {
            throw new Error(`Cannot start Wardens P3 without Warden enemy ${wardenId}`);
        }
        const player = world.player;
        if (!player) {
            throw new Error("Cannot start Wardens P3 without a player");
        }
        validateWardenP3SiphonLayout(siphonLayout);
        validateWardenP3SkullSwarm(skullSwarm);
        this.animations = world.animations.wardenP3();
        this.timing = parseWardenP3Timing({
            ...WARDEN_P3_HAZARD_TIMING,
            slams: this.animations.slams,
            stances: this.animations.stances,
            phantomAttacks: this.animations.phantoms.attacks,
            siphonLaunchSeconds: this.animations.siphons.launchSeconds,
        });
        const opening = beginWardenP3(startPhase, world.timeSeconds, warden.maxHealth, this.timing);
        warden.invulnerable = false;
        warden.health = opening.wardenHealthFraction * warden.maxHealth;
        warden.healthFloor = wardenP3HealthFloorFraction(opening.nextState) * warden.maxHealth;
        this.state = opening.nextState;
        this.commands = opening.commands;
        this.floorSlamsResolvedUntilSeconds = world.timeSeconds;
        for (const command of opening.commands) {
            this.dispatchCommand(warden, player, command);
        }
    }

    get renderState(): WardenP3RenderState {
        return {
            kind: EncounterScriptKind.WARDENS_P3,
            commands: this.commands,
            aimedSlamTarget: this.aimedSlamTarget,
            resolvedSlamTarget: this.resolvedSlamTarget,
            activeIntermission:
                this.state.phase === WardenP3Phase.SIPHONS ? this.state.intermission : undefined,
            activePhantoms: this.activePhantoms,
            arenaFloor: this.floor,
            floorSlams: this.floorSlams,
        };
    }

    overlayTerrain(base: Terrain): Terrain {
        return wardenP3ArenaTerrain(base, this.floor, this.landedSiphonTiles());
    }

    resolveSiphons(status: Exclude<WardenSiphonStatus, WardenSiphonStatus.NONE>): void {
        if (this.state.phase !== WardenP3Phase.SIPHONS) {
            throw new Error("Cannot resolve Wardens siphons outside a siphon intermission");
        }
        this.siphonStatus = status;
    }

    step(): void {
        const world = this.world;
        const player = world.player;
        if (!player) {
            return;
        }
        // The Warden's corpse despawns after the fight is won, and nothing is left to direct.
        if (this.state.phase === WardenP3Phase.COMPLETE) {
            return;
        }
        const warden = world.findEnemy(this.wardenId);
        if (!warden) {
            throw new Error(`Wardens P3 lost Warden enemy ${this.wardenId}`);
        }
        this.advanceEnergySiphons(warden);
        const result = stepWardenP3(
            this.state,
            {
                timeSeconds: world.timeSeconds,
                wardenHealth: { current: warden.health, maximum: warden.maxHealth },
                siphonStatus: this.currentSiphonStatus(),
                arenaFloor: this.floor,
            },
            this.timing,
        );
        this.state = result.nextState;
        warden.healthFloor = wardenP3HealthFloorFraction(this.state) * warden.maxHealth;
        this.commands = result.commands;
        this.siphonStatus = WardenSiphonStatus.NONE;
        for (const command of result.commands) {
            this.dispatchCommand(warden, player, command);
        }
        this.resolveFloorSlamArrivals();
        this.burstRisingZebakJugs(warden, player);
        this.resolveTileStrikes();
        this.resolveEnergySiphonStrikes(warden);
    }

    private energySiphonActors(): EnergySiphonActor[] {
        return this.world.encounterActors.filter(
            (actor): actor is EnergySiphonActor => actor.kind === EncounterActorKind.ENERGY_SIPHON,
        );
    }

    // A siphon in flight is still in the air, so only a landed one stands in the way.
    private landedSiphonTiles(): WardenP3Tile[] {
        return this.energySiphonActors()
            .filter((siphon) => siphon.siphon.state !== EnergySiphonState.IN_FLIGHT)
            .map((siphon) => ({
                x: Math.floor(siphon.x / TILE_SIZE),
                y: Math.floor(siphon.y / TILE_SIZE),
                level: siphon.level,
            }));
    }

    // A landing siphon's idle restarts so every leech pulse after it falls on the idle's leech frame.
    private advanceEnergySiphons(warden: Enemy): void {
        const timeSeconds = this.world.timeSeconds;
        const landing = this.energySiphonActors().filter(
            (siphon) =>
                settleEnergySiphon(siphon.siphon, timeSeconds).state !== siphon.siphon.state,
        );
        for (const siphon of landing) {
            siphon.siphon = settleEnergySiphon(siphon.siphon, timeSeconds);
            siphon.animation.restart(siphon.type.seqs.idle);
        }
        if (landing.length > 0) {
            this.world.playSound({
                sound: this.sounds.siphonLanding,
                points: nonEmpty(landing.map(({ x, y }) => ({ x, y }))),
            });
            this.movePlayerOffOccupiedTile();
        }
        const window = this.siphonWindow;
        if (!window || timeSeconds < window.nextLeechAtSeconds) {
            return;
        }
        this.siphonWindow = {
            ...window,
            nextLeechAtSeconds:
                window.nextLeechAtSeconds + this.animations.siphons.leech.intervalSeconds,
        };
        for (const siphon of this.energySiphonActors()) {
            if (siphon.siphon.state !== EnergySiphonState.HOSTILE) {
                continue;
            }
            this.launchFlight(warden, ENERGY_SIPHON_LEECH_SPEC, this.siphonLaunchPoint(siphon), {
                kind: "COMBATANT",
                combatant: warden,
            });
        }
    }

    private resolveEnergySiphonStrikes(warden: Enemy): void {
        const timeSeconds = this.world.timeSeconds;
        const arrived = this.siphonStrikes.filter(
            (strike) => timeSeconds >= strike.arrivesAtSeconds,
        );
        for (const strike of arrived) {
            applyDamage(warden, strike.damage, this.world.events);
        }
        this.siphonStrikes = this.siphonStrikes.filter(
            (strike) => timeSeconds < strike.arrivesAtSeconds,
        );
    }

    // The siphons leave the Warden's chest together and land together, each as its tile's shadow
    // reaches the landing frame.
    private throwEnergySiphons(warden: Enemy, intermission: WardenP3Intermission): void {
        const world = this.world;
        const { siphons } = this.animations;
        const landsAtSeconds = world.timeSeconds + siphons.flightSeconds;
        this.siphonWindow = {
            deadlineAtSeconds: landsAtSeconds + this.siphonLayout.deadlineSeconds,
            nextLeechAtSeconds: landsAtSeconds + siphons.leech.firstSeconds,
        };
        const siphonType = world.animations.enemyType(EnemyTypeId.ENERGY_SIPHON);
        const launch = timedProjectileSpec(ENERGY_SIPHON_LAUNCH_FLIGHT, siphons.flightSeconds);
        const chest: FlightOrigin = {
            x: warden.x,
            y: warden.y,
            height:
                world.terrain.getHeight(warden.level, warden.x, warden.y) +
                warden.projectileLaunchHeight,
        };
        for (const spawn of this.siphonLayout.spawnsByIntermission[intermission]) {
            const siphon = createEnergySiphonActor(
                world.allocateActorId(),
                (spawn.x + 0.5) * TILE_SIZE,
                (spawn.y + 0.5) * TILE_SIZE,
                spawn.level,
                siphonType,
                spawn.rotation,
                { state: EnergySiphonState.IN_FLIGHT, landsAtSeconds },
                siphons.turnUnitsPerSecond,
            );
            this.spawnTileEffect(siphons.landingShadow, spawn, landsAtSeconds);
            this.launchFlight(warden, launch, chest, {
                kind: "POINT",
                x: siphon.x,
                y: siphon.y,
            });
            world.encounterActors.push(siphon);
        }
    }

    private releaseSkullSwarm(player: Player, intermission: WardenP3Intermission): void {
        const world = this.world;
        const skullType = world.animations.enemyType(EnemyTypeId.WARDENS_SKULL);
        const tiles = wardenP3SkullSwarmTiles(
            this.floor,
            playerWardenTile(player),
            this.skullSwarm,
            intermission,
            world.random,
        );
        this.skullSwarmIds = tiles.map((tile) => {
            const centre = wardenTileCentre(tile);
            return world.spawnEnemy(centre.x, centre.y, tile.level, skullType);
        });
    }

    // Every siphon flies back into the Warden during its release, whether or not it was reversed;
    // only the reversed ones strike it as they arrive.
    private recallEnergySiphons(warden: Enemy, reversalDamage: number): void {
        const world = this.world;
        const { recallSeconds } = this.animations.siphons;
        const arrivesAtSeconds = world.timeSeconds + recallSeconds;
        const recall = timedProjectileSpec(ENERGY_SIPHON_RECALL_FLIGHT, recallSeconds);
        const siphons = this.energySiphonActors();
        for (const siphon of siphons) {
            this.launchFlight(warden, recall, this.siphonLaunchPoint(siphon), {
                kind: "COMBATANT",
                combatant: warden,
            });
        }
        const strikes = energySiphonRecallStrikes(
            siphons.map((siphon) => siphon.siphon),
            reversalDamage,
        );
        this.siphonStrikes = [
            ...this.siphonStrikes,
            ...strikes.map((damage) => ({ arrivesAtSeconds, damage })),
        ];
        this.siphonWindow = undefined;
        world.encounterActors = world.encounterActors.filter(
            (actor) => actor.kind !== EncounterActorKind.ENERGY_SIPHON,
        );
    }

    private siphonLaunchPoint(siphon: EnergySiphonActor): FlightOrigin {
        return {
            x: siphon.x,
            y: siphon.y,
            height:
                this.world.terrain.getHeight(siphon.level, siphon.x, siphon.y) +
                encounterActorProjectileLaunchHeight(siphon),
        };
    }

    // A siphon flight only pictures where the energy goes: landing, leeching, the deadline and the
    // strikes all run on the runtime's own timers, so a flight dropped at the projectile cap costs
    // nothing but the picture. A pulled tile's flight is the same, the tile having left the floor
    // the moment it was pulled.
    private launchFlight(
        warden: Enemy,
        spec: ProjectileSpec,
        start: FlightOrigin,
        target: ProjectileTarget,
    ): void {
        this.world.launchProjectile(
            spec,
            { caster: warden, affects: Affects.SELF, payloads: [] },
            start,
            target,
        );
    }

    // A tile hurts the player only as the front reaches it, so stepping onto tiles the front has
    // already passed is safe.
    private resolveFloorSlamArrivals(): void {
        const timeSeconds = this.world.timeSeconds;
        for (const slam of this.floorSlams) {
            const arriving = floorSlamTilesArriving(
                slam,
                this.floorSlamsResolvedUntilSeconds,
                timeSeconds,
            );
            for (const tile of arriving) {
                this.damagePlayerOnTile(tile, 30);
            }
        }
        this.floorSlamsResolvedUntilSeconds = timeSeconds;
        this.floorSlams = this.floorSlams.filter(
            (slam) => timeSeconds < floorSlamEndsAtSeconds(slam),
        );
    }

    // A volley's strikes land together, so each sound plays once, heard from every tile it struck.
    private resolveTileStrikes(): void {
        const timeSeconds = this.world.timeSeconds;
        const due = this.tileStrikes.filter((strike) => timeSeconds >= strike.strikesAtSeconds);
        for (const strike of due) {
            if (strike.strikeEffect !== undefined) {
                this.spawnTileEffect(strike.strikeEffect, strike.tile);
            }
            this.damagePlayerOnTile(strike.tile, strike.damage);
        }
        for (const sound of new Set(due.map((strike) => strike.strikeSound))) {
            const struck = due.filter((strike) => strike.strikeSound === sound);
            this.world.playSound({
                sound,
                points: nonEmpty(struck.map((strike) => wardenTileCentre(strike.tile))),
            });
        }
        this.tileStrikes = this.tileStrikes.filter(
            (strike) => timeSeconds < strike.strikesAtSeconds,
        );
    }

    // The player reverses siphons in its own update, earlier in the same step, so the last reversal
    // resolves the intermission within that step.
    private currentSiphonStatus(): WardenSiphonStatus {
        if (this.siphonStatus !== WardenSiphonStatus.NONE) {
            return this.siphonStatus;
        }
        if (
            this.skullSwarmIds.length > 0 &&
            this.skullSwarmIds.every((id) => {
                // A slain skull's corpse despawns after it lingers.
                const skull = this.world.findEnemy(id);
                return skull === undefined || skull.state === EnemyState.DEAD;
            })
        ) {
            return WardenSiphonStatus.SWARM_CLEARED;
        }
        const siphons = this.energySiphonActors();
        if (
            siphons.length > 0 &&
            siphons.every((siphon) => siphon.siphon.state === EnergySiphonState.REVERSED)
        ) {
            return WardenSiphonStatus.ALL_REVERSED;
        }
        if (
            this.siphonWindow !== undefined &&
            this.world.timeSeconds >= this.siphonWindow.deadlineAtSeconds
        ) {
            return WardenSiphonStatus.DEADLINE_EXPIRED;
        }
        return WardenSiphonStatus.NONE;
    }

    private dispatchCommand(warden: Enemy, player: Player, command: WardenP3Command): void {
        switch (command.kind) {
            case "BEGIN_SLAM":
                this.aimedSlamTarget = command.target;
                warden.playScriptedSeq(this.animations.slams[command.target].seq);
                return;
            case "RESOLVE_FLOOR_SLAM":
                this.resolvedSlamTarget = command.target;
                this.floorSlams = [
                    ...this.floorSlams,
                    {
                        shockwave: wardenP3SlamShockwave(command.target),
                        startsAtSeconds: this.world.timeSeconds,
                    },
                ];
                return;
            case "CHANGE_WARDEN_STANCE": {
                const stance = this.animations.stances[command.stance];
                warden.playScriptedSeq(stance.transition);
                warden.holdScriptedIdle(stance.hold);
                return;
            }
            case "SET_WARDEN_VULNERABILITY":
                warden.invulnerable = !command.vulnerable;
                return;
            case "SPAWN_ENERGY_SIPHONS":
                // The siphons are on hold while a skull swarm is tried in their place.
                // this.throwEnergySiphons(warden, command.intermission);
                this.releaseSkullSwarm(player, command.intermission);
                return;
            case "RESOLVE_ENERGY_SIPHONS":
                this.recallEnergySiphons(warden, command.reversalDamage);
                this.skullSwarmIds = [];
                return;
            case "ACTIVATE_PHANTOM":
                this.activePhantoms = [...this.activePhantoms, command.phantom];
                this.spawnPhantom(command.phantom);
                return;
            case "BEGIN_PHANTOM_ATTACK": {
                const phantom = this.phantomActor(command.phantom);
                phantom.rotation = directionToRotation(player.x - phantom.x, player.y - phantom.y);
                playEncounterActorSeq(
                    phantom,
                    this.animations.phantoms.attacks[command.phantom].seq,
                );
                return;
            }
            case "RELEASE_PHANTOM_ATTACK":
                this.releasePhantomAttack(warden, player, command.release);
                return;
            case "ENTER_ENRAGE":
                applyHeal(warden, command.healAmount, this.world.events);
                return;
            case "CALL_LIGHTNING":
                this.callLightning();
                return;
            case "PULL_ARENA_TILES":
                this.pullArenaTiles(warden, command.count);
                return;
            case "COMPLETE_ENCOUNTER":
                this.world.events.push({ kind: CombatEventKind.ENCOUNTER_CLEARED });
                return;
        }
    }

    // A phantom only joins the arena at the intermission that wakes it, then attacks from there.
    private spawnPhantom(phantom: WardenPhantom): void {
        const spawn = this.phantomSpawns.find((candidate) => candidate.phantom === phantom);
        if (!spawn) {
            throw new Error(`Wardens P3 declares no spawn for the ${phantom} phantom`);
        }
        this.world.encounterActors.push(
            createPhantomActor(
                this.world.allocateActorId(),
                (spawn.x + 2.5) * TILE_SIZE,
                (spawn.y + 2.5) * TILE_SIZE,
                spawn.level,
                this.world.animations.enemyType(wardenPhantomEnemyTypeId(phantom)),
                directionToRotation(0, 1),
            ),
        );
    }

    private phantomActor(phantom: WardenPhantom): EncounterActor {
        const typeId = wardenPhantomEnemyTypeId(phantom);
        const actor = this.world.encounterActors.find(
            (candidate) =>
                candidate.kind === EncounterActorKind.PHANTOM && candidate.type.id === typeId,
        );
        if (!actor) {
            throw new Error(`Wardens P3 has no ${phantom} phantom to attack with`);
        }
        return actor;
    }

    private releasePhantomAttack(
        warden: Enemy,
        player: Player,
        release: PhantomAttackRelease,
    ): void {
        switch (release.phantom) {
            case WardenPhantom.ZEBAK:
                this.throwZebakJug(warden, player, ZEBAK_PHANTOM_SHOT.pieces[release.style]);
                return;
            case WardenPhantom.BABA:
                this.dropBabaPhantomRocks(player);
                return;
        }
    }

    // The phantoms are the Warden's own attacks in another boss's shape, so the Warden is the jug's
    // caster (its faction and level) and the phantom only lends the launch point. The jug only
    // pictures the shot on its way up; its burst runs on the runtime's own timer.
    private throwZebakJug(warden: Enemy, player: Player, piece: ZebakPhantomPiece): void {
        const phantom = this.phantomActor(WardenPhantom.ZEBAK);
        const { riseSeconds } = this.animations.phantoms.zebakShot;
        const burstTile = playerWardenTile(player);
        this.launchFlight(
            warden,
            timedProjectileSpec(ZEBAK_PHANTOM_SHOT.jug, riseSeconds),
            {
                x: phantom.x,
                y: phantom.y,
                height:
                    this.world.terrain.getHeight(phantom.level, phantom.x, phantom.y) +
                    encounterActorProjectileLaunchHeight(phantom),
            },
            { kind: "POINT", ...wardenTileCentre(burstTile) },
        );
        this.risingZebakJugs = [
            ...this.risingZebakJugs,
            { burstsAtSeconds: this.world.timeSeconds + riseSeconds, burstTile, piece },
        ];
    }

    private burstRisingZebakJugs(warden: Enemy, player: Player): void {
        const timeSeconds = this.world.timeSeconds;
        const bursting = this.risingZebakJugs.filter((jug) => timeSeconds >= jug.burstsAtSeconds);
        for (const jug of bursting) {
            this.burstZebakJug(warden, player, jug);
        }
        this.risingZebakJugs = this.risingZebakJugs.filter(
            (jug) => timeSeconds < jug.burstsAtSeconds,
        );
    }

    // What falls out of the burst aims at the centre of the tile the player stands on then, under a
    // shadow held until it lands, so stepping off that tile before the landing dodges it.
    private burstZebakJug(warden: Enemy, player: Player, jug: RisingZebakJug): void {
        const world = this.world;
        const { fallShadow, fallSeconds } = this.animations.phantoms.zebakShot;
        const burst = wardenTileCentre(jug.burstTile);
        const level = jug.burstTile.level;
        world.visualEffects.push(
            new VisualEffect(
                ZEBAK_PHANTOM_SHOT.burstEffect,
                { kind: "POINT", ...burst, level, rotation: 0 },
                ZEBAK_PHANTOM_SHOT.burstHeight,
                world.animations.effects[ZEBAK_PHANTOM_SHOT.burstEffect],
            ),
        );
        world.playSound({ sound: this.sounds.zebakShotBurst, points: [burst] });
        const target = playerWardenTile(player);
        const landsAtSeconds = world.timeSeconds + fallSeconds;
        this.spawnTileEffect(fallShadow, target, landsAtSeconds);
        this.launchFlight(
            warden,
            timedProjectileSpec(jug.piece.fall, fallSeconds),
            {
                ...burst,
                height:
                    world.terrain.getHeight(level, burst.x, burst.y) +
                    ZEBAK_PHANTOM_SHOT.burstHeight,
            },
            { kind: "POINT", ...wardenTileCentre(target) },
        );
        this.tileStrikes = [
            ...this.tileStrikes,
            {
                tile: target,
                strikesAtSeconds: landsAtSeconds,
                damage: WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.ZEBAK],
                strikeEffect: jug.piece.landingEffect,
                strikeSound: this.sounds.zebakShotLanding,
            },
        ];
    }

    // Each rock's graphic plays its whole fall from the moment it drops, so its shadow is held until
    // the graphic's landing frame, where the rock hits.
    private dropBabaPhantomRocks(player: Player): void {
        const { rockFall } = this.animations.phantoms;
        const targets = babaPhantomRockTargets(
            this.floor,
            playerWardenTile(player),
            BABA_PHANTOM_ROCK_FALL.extraRockCount,
            this.world.random,
        );
        const strikesAtSeconds = this.world.timeSeconds + rockFall.landingSeconds;
        for (const tile of targets) {
            this.spawnTileEffect(BABA_PHANTOM_ROCK_FALL.shadow.kind, tile, strikesAtSeconds);
            this.spawnTileEffect(rockFall.effect, tile);
        }
        this.tileStrikes = [
            ...this.tileStrikes,
            ...targets.map((tile) => ({
                tile,
                strikesAtSeconds,
                damage: WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.BABA],
                strikeEffect: undefined,
                strikeSound: this.sounds.babaRockLanding,
            })),
        ];
    }

    // Each bolt's warning is held on its tile until the bolt strikes there.
    private callLightning(): void {
        const targets = wardenP3LightningTargets(
            this.floor,
            WARDEN_P3_LIGHTNING.boltCount,
            this.world.random,
        );
        const strikesAtSeconds = this.world.timeSeconds + WARDEN_P3_LIGHTNING.warningSeconds;
        for (const tile of targets) {
            this.spawnTileEffect(WARDEN_P3_LIGHTNING.warning, tile, strikesAtSeconds);
        }
        this.tileStrikes = [
            ...this.tileStrikes,
            ...targets.map((tile) => ({
                tile,
                strikesAtSeconds,
                damage: WARDEN_P3_LIGHTNING.damage,
                strikeEffect: WARDEN_P3_LIGHTNING.strike,
                strikeSound: this.sounds.lightningStrike,
            })),
        ];
    }

    private pullArenaTiles(warden: Enemy, count: number): void {
        const world = this.world;
        const pull = pullWardenP3ArenaTiles(this.floor, count, world.random);
        this.floor = pull.floor;
        const flight = timedProjectileSpec(
            WARDENS_PULLED_TILE_FLIGHT,
            this.animations.pulledTileFlightSeconds,
        );
        for (const tile of pull.tiles) {
            const centre = wardenTileCentre(tile);
            this.launchFlight(
                warden,
                flight,
                { ...centre, height: world.terrain.getHeight(tile.level, centre.x, centre.y) },
                { kind: "POINT", ...wardenP3PulledTileSkyPoint(tile, WARDEN_P3_PULLED_TILE_SKY) },
            );
        }
        this.movePlayerOffOccupiedTile();
    }

    // A player left standing where the floor went or a siphon landed could never walk off again, so
    // they are set down on the nearest open floor, unhurt.
    private movePlayerOffOccupiedTile(): void {
        const player = this.world.player;
        if (!player) {
            return;
        }
        const standing = playerWardenTile(player);
        const occupied = this.landedSiphonTiles();
        const tile = wardenP3ArenaTile(standing.x, standing.y);
        const onPulledFloor =
            wardenP3TileOccupancy(this.floor, tile) === WardenP3ArenaTileOccupancy.DESTROYED_FLOOR;
        if (!onPulledFloor && !occupied.some((other) => isSameWardenTile(other, standing))) {
            return;
        }
        const refuge = wardenTileCentre(nearestOpenWardenP3Tile(this.floor, occupied, tile));
        player.x = refuge.x;
        player.y = refuge.y;
    }

    private damagePlayerOnTile(tile: WardenP3Tile, damage: number): void {
        const player = this.world.player;
        if (player && isSameWardenTile(playerWardenTile(player), tile)) {
            applyDamage(player, damage, this.world.events);
        }
    }

    private spawnTileEffect(
        kind: VisualEffectKind,
        tile: WardenP3Tile,
        holdUntilSeconds?: number,
    ): void {
        this.world.visualEffects.push(
            new VisualEffect(
                kind,
                { kind: "POINT", ...wardenTileCentre(tile), level: tile.level, rotation: 0 },
                0,
                this.world.animations.effects[kind],
                holdUntilSeconds,
            ),
        );
    }
}
