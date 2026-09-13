import { WeaponStyle } from "../game/Ability";
import { SeqTiming, sequenceDurationSeconds, sequenceTimeToFrameSeconds } from "../game/Animation";
import { Encounter, EncounterScriptKind, EncounterSpawnMode } from "../game/Encounter";
import { EncounterAnimations } from "../game/EncounterAnimations";
import { EnemyTypeId, ResolvedEnemyType, getEnemyType, resolveEnemyType } from "../game/EnemyType";
import { Player, StanceSeqs } from "../game/Player";
import { ProjectileKind } from "../game/Projectile";
import { SeqCatalog } from "../game/SeqCatalog";
import { VisualEffectKind } from "../game/VisualEffect";
import {
    ResolvedWardenPhantomAttack,
    ResolvedWardenSlam,
    ResolvedWardenZebakShot,
    WardenP3AnimationIds,
    WardenP3Animations,
    WardenPhantomAnimationIds,
    WardenPhantomAttackSeq,
    WardenSiphonAnimationIds,
    WardenSiphonAnimations,
    WardenSlamSeq,
    WardenZebakShotIds,
} from "../game/WardenP3Animations";
import { WardenStance } from "../game/WardenP3Director";
import { resolvePlayerLoadouts } from "../game/abilities";
import { ActorAssets, AnimatedSpotAnimBake, ProjectileBake } from "./ActorAssets";

function mapRecord<K extends string | number, A, B>(
    record: Readonly<Record<K, A>>,
    map: (value: A) => B,
): Record<K, B> {
    return Object.fromEntries(
        Object.entries<A>(record).map(([key, value]) => [key, map(value)]),
    ) as Record<K, B>;
}

function lookup<K, V>(
    resolved: ReadonlyMap<K, V>,
    description: string,
    declaredIn: string,
): (key: K) => V {
    return (key) => {
        const value = resolved.get(key);
        if (value === undefined) {
            throw new Error(`The game used ${description} ${key}, which is not in ${declaredIn}`);
        }
        return value;
    };
}

// A flight or fall runs from its sequence's start to the given frame, so the first frame would leave
// it no time to fly.
function flightFrameSeconds(seq: SeqTiming, frame: number, description: string): number {
    const seconds = sequenceTimeToFrameSeconds(seq, frame);
    if (seconds <= 0) {
        throw new RangeError(`${description} must come after sequence ${seq.seqId} starts`);
    }
    return seconds;
}

function resolveWardenSiphonAnimations(
    wardenIds: WardenP3AnimationIds,
    siphonIds: WardenSiphonAnimationIds,
    effects: Readonly<Record<VisualEffectKind, AnimatedSpotAnimBake>>,
    catalog: SeqCatalog,
): WardenSiphonAnimations {
    const siphonIdle = catalog.get(getEnemyType(EnemyTypeId.ENERGY_SIPHON).idleSeqId);
    const { landingShadow } = siphonIds;
    return {
        launchSeconds: sequenceTimeToFrameSeconds(
            catalog.get(wardenIds.stances[WardenStance.CHARGING].transitionSeqId),
            siphonIds.launchFrame,
        ),
        landingShadow: landingShadow.effect,
        flightSeconds: flightFrameSeconds(
            catalog.get(effects[landingShadow.effect].seq.seqId),
            landingShadow.landingFrame,
            "A siphon's landing",
        ),
        leech: {
            firstSeconds: sequenceTimeToFrameSeconds(siphonIdle, siphonIds.leechFrame),
            intervalSeconds: sequenceDurationSeconds(siphonIdle),
        },
        recallSeconds: flightFrameSeconds(
            catalog.get(wardenIds.stances[WardenStance.STANDING].transitionSeqId),
            siphonIds.recallFrame,
            "A siphon's recall",
        ),
        turnUnitsPerSecond: positiveRate(siphonIds.turnUnitsPerSecond, "A siphon's turn rate"),
    };
}

function positiveRate(rate: number, description: string): number {
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new RangeError(`${description} must be a finite positive number, got ${rate}`);
    }
    return rate;
}

function resolveZebakShot(
    ids: WardenZebakShotIds,
    assets: ActorAssets,
    catalog: SeqCatalog,
): ResolvedWardenZebakShot {
    if (!Number.isInteger(ids.jugTumbles) || ids.jugTumbles < 1) {
        throw new RangeError(
            `Zebak's jug must tumble a whole number of times, got ${ids.jugTumbles}`,
        );
    }
    const jugSeqId = projectileTravelSeqId(assets.projectiles[ProjectileKind.ZEBAK_PHANTOM_JUG]);
    if (jugSeqId === undefined) {
        throw new Error("Zebak's jug graphic must animate its tumble");
    }
    const { fallShadow } = ids;
    return {
        riseSeconds: ids.jugTumbles * sequenceDurationSeconds(catalog.get(jugSeqId)),
        fallShadow: fallShadow.effect,
        fallSeconds: flightFrameSeconds(
            catalog.get(assets.effects[fallShadow.effect].seq.seqId),
            fallShadow.landingFrame,
            "Zebak's shot landing",
        ),
    };
}

function pulledTileFlightSeconds(bake: ProjectileBake, catalog: SeqCatalog): number {
    const seqId = projectileTravelSeqId(bake);
    if (seqId === undefined) {
        throw new Error("A pulled Wardens P3 tile's graphic must animate its tumble");
    }
    return sequenceDurationSeconds(catalog.get(seqId));
}

// A slam's impact frame, a phantom attack's release frame, a rock's or Zebak's shot's landing frame
// or a siphon beat outside its sequence throws here, while the encounter loads.
function resolveWardenP3Animations(
    wardenIds: WardenP3AnimationIds,
    phantomIds: WardenPhantomAnimationIds,
    siphonIds: WardenSiphonAnimationIds,
    assets: ActorAssets,
    catalog: SeqCatalog,
): WardenP3Animations {
    const { effects } = assets;
    const resolveSlam = ({ seqId, impactFrame }: WardenSlamSeq): ResolvedWardenSlam => {
        const seq = catalog.get(seqId);
        return {
            seq,
            impactSeconds: sequenceTimeToFrameSeconds(seq, impactFrame),
            durationSeconds: sequenceDurationSeconds(seq),
        };
    };
    const resolvePhantomAttack = ({
        seqId,
        releaseFrame,
    }: WardenPhantomAttackSeq): ResolvedWardenPhantomAttack => {
        const seq = catalog.get(seqId);
        return {
            seq,
            releaseSeconds: sequenceTimeToFrameSeconds(seq, releaseFrame),
            durationSeconds: sequenceDurationSeconds(seq),
        };
    };
    const { rockFall } = phantomIds;
    return {
        slams: mapRecord(wardenIds.slams, resolveSlam),
        stances: mapRecord(wardenIds.stances, ({ transitionSeqId, holdSeqId }) => {
            const transition = catalog.get(transitionSeqId);
            return {
                transition,
                hold: catalog.get(holdSeqId),
                transitionSeconds: sequenceDurationSeconds(transition),
            };
        }),
        phantoms: {
            attacks: mapRecord(phantomIds.attacks, resolvePhantomAttack),
            rockFall: {
                effect: rockFall.effect,
                landingSeconds: sequenceTimeToFrameSeconds(
                    catalog.get(effects[rockFall.effect].seq.seqId),
                    rockFall.landingFrame,
                ),
            },
            zebakShot: resolveZebakShot(phantomIds.zebakShot, assets, catalog),
        },
        siphons: resolveWardenSiphonAnimations(wardenIds, siphonIds, effects, catalog),
        pulledTileFlightSeconds: pulledTileFlightSeconds(
            assets.projectiles[ProjectileKind.WARDENS_PULLED_TILE],
            catalog,
        ),
    };
}

function scriptAnimations(
    encounter: Encounter,
    assets: ActorAssets,
    catalog: SeqCatalog,
): WardenP3Animations | undefined {
    if (encounter.spawnMode !== EncounterSpawnMode.SCRIPTED) {
        return undefined;
    }
    switch (encounter.script.kind) {
        case EncounterScriptKind.WARDENS_P3:
            return resolveWardenP3Animations(
                encounter.script.wardenAnimations,
                encounter.script.phantomAnimations,
                encounter.script.siphonAnimations,
                assets,
                catalog,
            );
    }
}

function projectileTravelSeqId(bake: ProjectileBake): number | undefined {
    return bake.kind === "SPOT_ANIM" && bake.seq.kind === "ANIMATED" ? bake.seq.seqId : undefined;
}

// The composition point for every sequence the running encounter can play. assets is what the
// encounter's pack was declared from and catalog holds exactly its seq roots, so a sequence the game
// uses without declaring it throws here, while the encounter loads.
export function resolveEncounterAnimations(
    encounter: Encounter,
    assets: ActorAssets,
    catalog: SeqCatalog,
): EncounterAnimations {
    const stanceSeqsByTier = (style: WeaponStyle): readonly StanceSeqs[] =>
        assets.player.stancesByTier[style].map((ids) => ({
            idle: catalog.get(ids.idleSeqId),
            walk: catalog.get(ids.walkSeqId),
            run: catalog.get(ids.runSeqId),
        }));
    const enemyTypes = new Map<EnemyTypeId, ResolvedEnemyType>(
        assets.enemyTypes.map(({ enemyTypeId }) => [
            enemyTypeId,
            resolveEnemyType(getEnemyType(enemyTypeId), catalog),
        ]),
    );
    const wardenP3 = scriptAnimations(encounter, assets, catalog);
    const interactionSeqs = new Map(
        encounter.interactions.map((interaction) => [
            interaction.id,
            catalog.get(interaction.animationSeqId),
        ]),
    );
    return {
        player: {
            stances: {
                [WeaponStyle.MELEE]: stanceSeqsByTier(WeaponStyle.MELEE),
                [WeaponStyle.RANGED]: stanceSeqsByTier(WeaponStyle.RANGED),
                [WeaponStyle.MAGIC]: stanceSeqsByTier(WeaponStyle.MAGIC),
            },
            death: catalog.get(Player.DEATH_SEQ_ID),
            loadouts: resolvePlayerLoadouts(catalog),
        },
        enemyType: lookup(enemyTypes, "enemy type", "the encounter's enemyTypeIds"),
        interactionSeq: lookup(interactionSeqs, "interaction", "the encounter's interactions"),
        effects: mapRecord(assets.effects, (bake): SeqTiming => catalog.get(bake.seq.seqId)),
        projectileTravel: mapRecord(assets.projectiles, (bake): SeqTiming | undefined => {
            const seqId = projectileTravelSeqId(bake);
            return seqId === undefined ? undefined : catalog.get(seqId);
        }),
        wardenP3: () => {
            if (!wardenP3) {
                throw new Error(
                    `The game used the Wardens P3 animations, which encounter ${encounter.id} does not declare`,
                );
            }
            return wardenP3;
        },
    };
}
