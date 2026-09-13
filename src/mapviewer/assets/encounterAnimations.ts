import { WeaponStyle } from "../game/Ability";
import { SeqTiming, sequenceDurationSeconds, sequenceTimeToFrameSeconds } from "../game/Animation";
import { Encounter, EncounterScriptKind, EncounterSpawnMode } from "../game/Encounter";
import { EncounterAnimations } from "../game/EncounterAnimations";
import { EnemyTypeId, ResolvedEnemyType, getEnemyType, resolveEnemyType } from "../game/EnemyType";
import { Player, StanceSeqs } from "../game/Player";
import { SeqCatalog } from "../game/SeqCatalog";
import {
    ResolvedWardenSlam,
    WardenP3AnimationIds,
    WardenP3Animations,
    WardenSlamSeq,
} from "../game/WardenP3Animations";
import { resolvePlayerLoadouts } from "../game/abilities";
import { ActorAssets, ProjectileBake } from "./ActorAssets";

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

// A slam's impact frame outside its sequence throws here, while the encounter loads.
function resolveWardenP3Animations(
    ids: WardenP3AnimationIds,
    catalog: SeqCatalog,
): WardenP3Animations {
    const resolveSlam = ({ seqId, impactFrame }: WardenSlamSeq): ResolvedWardenSlam => {
        const seq = catalog.get(seqId);
        return {
            seq,
            impactSeconds: sequenceTimeToFrameSeconds(seq, impactFrame),
            durationSeconds: sequenceDurationSeconds(seq),
        };
    };
    return {
        slams: mapRecord(ids.slams, (slams) => mapRecord(slams, resolveSlam)),
        stances: mapRecord(ids.stances, ({ transitionSeqId, holdSeqId }) => {
            const transition = catalog.get(transitionSeqId);
            return {
                transition,
                hold: catalog.get(holdSeqId),
                transitionSeconds: sequenceDurationSeconds(transition),
            };
        }),
    };
}

function scriptAnimations(
    encounter: Encounter,
    catalog: SeqCatalog,
): WardenP3Animations | undefined {
    if (encounter.spawnMode !== EncounterSpawnMode.SCRIPTED) {
        return undefined;
    }
    switch (encounter.script.kind) {
        case EncounterScriptKind.WARDENS_P3:
            return resolveWardenP3Animations(encounter.script.wardenAnimations, catalog);
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
    const wardenP3 = scriptAnimations(encounter, catalog);
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
