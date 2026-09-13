import { CombatEventKind, applyDamage, applyHeal } from "./CombatEvent";
import { Affects, damagePayload } from "./Effect";
import { EncounterScriptKind, WardensP3Script } from "./Encounter";
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
import { Enemy } from "./Enemy";
import { EnemyTypeId } from "./EnemyType";
import { EnergySiphonState, energySiphonRecallStrikes, settleEnergySiphon } from "./EnergySiphon";
import { Player } from "./Player";
import {
    ENERGY_SIPHON_LAUNCH_FLIGHT,
    ENERGY_SIPHON_LEECH_SPEC,
    ENERGY_SIPHON_RECALL_FLIGHT,
    ProjectileImpact,
    ProjectileSpec,
    ProjectileTarget,
    WARDENS_PULLED_TILE_FLIGHT,
    timedProjectileSpec,
} from "./Projectile";
import { TILE_SIZE, Terrain } from "./Terrain";
import { VisualEffect, VisualEffectKind } from "./VisualEffect";
import { WardenP3Animations } from "./WardenP3Animations";
import {
    WARDEN_P3_INITIAL_ARENA_FLOOR,
    WardenP3ArenaFloor,
    nearestSolidWardenP3Tile,
    pullWardenP3ArenaTile,
    wardenP3ArenaTerrain,
} from "./WardenP3Arena";
import {
    ParsedWardenP3Timing,
    PhantomAttackRelease,
    WARDEN_P3_HAZARD_TIMING,
    WardenP3Command,
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
import { WARDEN_P3_LIGHTNING, wardenP3LightningTargets } from "./WardenP3Enrage";
import {
    FloorSlam,
    floorSlamEndsAtSeconds,
    floorSlamTilesArriving,
    wardenP3SlamShockwave,
} from "./WardenP3FloorSlam";
import {
    BABA_PHANTOM_ROCK_FALL,
    WARDEN_P3_PHANTOM_DAMAGE,
    ZEBAK_PHANTOM_SHOTS,
    ZebakPhantomShot,
    babaPhantomRockTargets,
    wardenPhantomEnemyTypeId,
} from "./WardenP3Phantoms";
import { WardenP3SiphonLayout, validateWardenP3SiphonLayout } from "./WardenP3SiphonLayout";
import { WorldContext } from "./WorldContext";
import { FlightOrigin, directionToRotation } from "./projectileMath";

// A hit on one floor tile once its telegraph runs out. A Ba-Ba rock's graphic plays its whole fall
// from the drop, so only a lightning bolt brings a graphic of its own to the strike.
type PendingTileStrike = {
    readonly tile: WardenP3Tile;
    readonly strikesAtSeconds: number;
    readonly damage: number;
    readonly strikeEffect: VisualEffectKind | undefined;
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

export function startWardensP3Encounter(
    world: WorldContext,
    script: WardensP3Script,
): WardenP3Runtime {
    const { wardenSpawn, phantomSpawns, startPhase, siphonLayout } = script;
    const wardenId = world.spawnEnemyAtExactPosition(
        wardenSpawn.x,
        wardenSpawn.y,
        wardenSpawn.level,
        world.animations.enemyType(EnemyTypeId.TUMEKENS_WARDEN),
    );
    for (const phantomSpawn of phantomSpawns) {
        world.encounterActors.push(
            createPhantomActor(
                world.allocateActorId(),
                (phantomSpawn.x + 2.5) * TILE_SIZE,
                (phantomSpawn.y + 2.5) * TILE_SIZE,
                0,
                world.animations.enemyType(wardenPhantomEnemyTypeId(phantomSpawn.phantom)),
                0,
            ),
        );
    }
    const platformFacing = directionToRotation(0, 1);
    world.findEnemy(wardenId)!.rotation = platformFacing;
    for (const actor of world.encounterActors) {
        if (actor.kind === EncounterActorKind.PHANTOM) {
            actor.rotation = platformFacing;
        }
    }
    return new WardenP3Runtime(world, wardenId, siphonLayout, startPhase);
}

export class WardenP3Runtime implements EncounterScript {
    private readonly animations: WardenP3Animations;
    private readonly timing: ParsedWardenP3Timing;
    private state: WardenP3State;
    private siphonStatus = WardenSiphonStatus.NONE;
    private siphonWindow: SiphonWindow | undefined = undefined;
    private siphonStrikes: readonly PendingSiphonStrike[] = [];
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

    constructor(
        private readonly world: WorldContext,
        private readonly wardenId: number,
        private readonly siphonLayout: WardenP3SiphonLayout,
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
        return wardenP3ArenaTerrain(base, this.floor);
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
        this.resolveTileStrikes();
        this.resolveEnergySiphonStrikes(warden);
    }

    private energySiphonActors(): EnergySiphonActor[] {
        return this.world.encounterActors.filter(
            (actor): actor is EnergySiphonActor => actor.kind === EncounterActorKind.ENERGY_SIPHON,
        );
    }

    // A landing siphon's idle restarts so every leech pulse after it falls on the idle's leech frame.
    private advanceEnergySiphons(warden: Enemy): void {
        const timeSeconds = this.world.timeSeconds;
        for (const siphon of this.energySiphonActors()) {
            if (siphon.siphon.state !== EnergySiphonState.IN_FLIGHT) {
                continue;
            }
            const settled = settleEnergySiphon(siphon.siphon, timeSeconds);
            if (settled.state === EnergySiphonState.IN_FLIGHT) {
                continue;
            }
            siphon.siphon = settled;
            siphon.animation.restart(siphon.type.seqs.idle);
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
    private throwEnergySiphons(warden: Enemy): void {
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
        for (const spawn of this.siphonLayout.spawns) {
            const siphon = createEnergySiphonActor(
                world.allocateActorId(),
                (spawn.x + 0.5) * TILE_SIZE,
                (spawn.y + 0.5) * TILE_SIZE,
                spawn.level,
                siphonType,
                spawn.rotation,
                { state: EnergySiphonState.IN_FLIGHT, landsAtSeconds },
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

    private resolveTileStrikes(): void {
        const timeSeconds = this.world.timeSeconds;
        const due = this.tileStrikes.filter((strike) => timeSeconds >= strike.strikesAtSeconds);
        for (const strike of due) {
            if (strike.strikeEffect !== undefined) {
                this.spawnTileEffect(strike.strikeEffect, strike.tile);
            }
            this.damagePlayerOnTile(strike.tile, strike.damage);
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
                warden.playScriptedSeq(this.animations.slams[command.tempo][command.target].seq);
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
                this.throwEnergySiphons(warden);
                return;
            case "RESOLVE_ENERGY_SIPHONS":
                this.recallEnergySiphons(warden, command.reversalDamage);
                return;
            case "ACTIVATE_PHANTOM":
                this.activePhantoms = [...this.activePhantoms, command.phantom];
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
            case "PULL_ARENA_TILE":
                this.pullArenaTile(warden, player);
                return;
            case "COMPLETE_ENCOUNTER":
                this.world.events.push({ kind: CombatEventKind.ENCOUNTER_CLEARED });
                return;
        }
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
                this.throwZebakPhantomShot(warden, player, ZEBAK_PHANTOM_SHOTS[release.style]);
                return;
            case WardenPhantom.BABA:
                this.dropBabaPhantomRocks(player);
                return;
        }
    }

    // The phantoms are the Warden's own attacks in another boss's shape, so the Warden is the shot's
    // caster (its faction and level) and the phantom only lends the launch point.
    private throwZebakPhantomShot(warden: Enemy, player: Player, shot: ZebakPhantomShot): void {
        const phantom = this.phantomActor(WardenPhantom.ZEBAK);
        const start: FlightOrigin = {
            x: phantom.x,
            y: phantom.y,
            height:
                this.world.terrain.getHeight(phantom.level, phantom.x, phantom.y) +
                encounterActorProjectileLaunchHeight(phantom),
        };
        const impact: ProjectileImpact = {
            caster: warden,
            affects: Affects.HOSTILE,
            payloads: [damagePayload(WARDEN_P3_PHANTOM_DAMAGE[WardenPhantom.ZEBAK])],
            hitEffect: shot.hitEffect,
        };
        this.world.launchProjectile(shot.spec, impact, start, {
            kind: "POINT",
            x: player.x,
            y: player.y,
        });
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
            })),
        ];
    }

    private pullArenaTile(warden: Enemy, player: Player): void {
        const pull = pullWardenP3ArenaTile(this.floor, this.world.random);
        this.floor = pull.floor;
        const x = (pull.tile.x + 0.5) * TILE_SIZE;
        const y = (pull.tile.y + 0.5) * TILE_SIZE;
        this.launchFlight(
            warden,
            timedProjectileSpec(
                WARDENS_PULLED_TILE_FLIGHT,
                this.animations.pulledTileFlightSeconds,
            ),
            { x, y, height: this.world.terrain.getHeight(pull.tile.level, x, y) },
            { kind: "COMBATANT", combatant: warden },
        );
        if (!isSameWardenTile(playerWardenTile(player), pull.tile)) {
            return;
        }
        const refuge = nearestSolidWardenP3Tile(this.floor, pull.tile);
        player.x = (refuge.x + 0.5) * TILE_SIZE;
        player.y = (refuge.y + 0.5) * TILE_SIZE;
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
                {
                    kind: "POINT",
                    x: (tile.x + 0.5) * TILE_SIZE,
                    y: (tile.y + 0.5) * TILE_SIZE,
                    level: tile.level,
                    rotation: 0,
                },
                0,
                this.world.animations.effects[kind],
                holdUntilSeconds,
            ),
        );
    }
}
