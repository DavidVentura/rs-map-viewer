import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import {
    AbilityDefinition,
    CircleCenter,
    CooldownGroup,
    DeliveryKind,
    ProjectileDelivery,
    ResolvedAbility,
    WeaponStyle,
    resolveAbility,
} from "./Ability";
import { Affects, DamageRoll, PayloadKind, damagePayload } from "./Effect";
import {
    ARROW_SPEC,
    FIRE_BOLT_HIT_SEQ_ID,
    JAD_FIRE_SEQ_ID,
    JAD_MAGE_BLAST_SPEC,
    JAD_RANGED_ROCK_SPEC,
    KET_ZEK_FIRE_BLAST_SPEC,
    MAGIC_SPEC,
    POWER_SHOT_SPEC,
    ProjectileSpec,
    TOK_XIL_SHOT_SPEC,
    VOLLEY_ARROW_SPEC,
} from "./Projectile";
import {
    ICE_BARRAGE_HIT_SEQ_ID,
    MAUL_IMPACT_SPARK_SEQ_ID,
    TZHAAR_HEAL_SEQ_ID,
    VisualEffectKind,
} from "./VisualEffect";

// The player's basic-attack sequences are the same ids the renderer preloads per stance (see
// ActorRenderDataLoader's STANCE_SEQ_CONFIG).
export const BOW_SHOT_CAST_SEQ_ID = 426;
export const MAGIC_BOLT_CAST_SEQ_ID = 711;
export const SCIMITAR_SLASH_CAST_SEQ_ID = 390;
export const ICE_BARRAGE_CAST_SEQ_ID = 1979;
export const CLEAVE_CAST_SEQ_ID = 1203;
export const HEALING_POTION_CAST_SEQ_ID = 829;

function singleShot(spec: ProjectileSpec): ProjectileDelivery {
    return { kind: DeliveryKind.PROJECTILE, spec, count: 1, spreadAngleRadians: 0 };
}

const ARROW_DAMAGE = 8;
const MAGIC_BOLT_DAMAGE = 12;
const SCIMITAR_SLASH_DAMAGE: DamageRoll = { min: 4, max: 9 };
const MELEE_REACH = 48;

// Player castSpeeds keep each basic attack's whole sequence inside its old windup+lock cadence,
// so the swing plays as one continuous motion with the recovery under the ATTACK lock.
// Bow shot's release is the string-snap frame.
export const BOW_SHOT: AbilityDefinition = {
    id: "bow_shot",
    name: "Bow Shot",
    castSeqId: BOW_SHOT_CAST_SEQ_ID,
    contactFrame: 5,
    castSpeed: 2.9,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: {
        delivery: singleShot(ARROW_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(ARROW_DAMAGE)],
    },
};

// Release at the second cast-hold, not the first (the raise).
export const MAGIC_BOLT: AbilityDefinition = {
    id: "magic_bolt",
    name: "Magic Bolt",
    castSeqId: MAGIC_BOLT_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 2.47,
    channelSeconds: 0,
    manaCost: 10,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.19 }],
    effect: {
        delivery: singleShot(MAGIC_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(MAGIC_BOLT_DAMAGE)],
        hitEffect: { kind: VisualEffectKind.MAGIC_HIT, seqId: FIRE_BOLT_HIT_SEQ_ID, height: 124 },
    },
};

// Contact at the extended-arm hold right after the fast downswing.
export const SCIMITAR_SLASH: AbilityDefinition = {
    id: "scimitar_slash",
    name: "Scimitar Slash",
    castSeqId: SCIMITAR_SLASH_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1.56,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.14 }],
    effect: {
        delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(SCIMITAR_SLASH_DAMAGE.min, SCIMITAR_SLASH_DAMAGE.max)],
    },
};

export function getStyleAttack(style: WeaponStyle): AbilityDefinition {
    switch (style) {
        case WeaponStyle.RANGED:
            return BOW_SHOT;
        case WeaponStyle.MAGIC:
            return MAGIC_BOLT;
        case WeaponStyle.MELEE:
            return SCIMITAR_SLASH;
    }
}

const SPECIAL_RECHARGE_SECONDS = 6;

// Both melee specials hit for twice the basic slash.
const MELEE_SPECIAL_DAMAGE = damagePayload(
    SCIMITAR_SLASH_DAMAGE.min * 2,
    SCIMITAR_SLASH_DAMAGE.max * 2,
);

// The wide sweep's most-held frame reads as contact across the arc.
export const CLEAVE: AbilityDefinition = {
    id: "cleave",
    name: "Cleave",
    castSeqId: CLEAVE_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 1.3,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.55 }],
    effect: {
        delivery: { kind: DeliveryKind.CONE, angleRadians: Math.PI / 2, reach: 2.5 * 128 },
        affects: Affects.HOSTILE,
        payloads: [MELEE_SPECIAL_DAMAGE],
    },
};

// The spell fires at the second, later charge-hold rather than the first (the raise/build-up).
export const ICE_BARRAGE: AbilityDefinition = {
    id: "ice_barrage",
    name: "Ice Barrage",
    castSeqId: ICE_BARRAGE_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 0.88,
    channelSeconds: 0,
    manaCost: 30,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.675 }],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 1, center: CircleCenter.TARGET },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(MAGIC_BOLT_DAMAGE), { kind: PayloadKind.FREEZE, seconds: 3 }],
        hitEffect: {
            kind: VisualEffectKind.ICE_BARRAGE_HIT,
            seqId: ICE_BARRAGE_HIT_SEQ_ID,
            height: 100,
        },
    },
};

// Volley/Power Shot reuse the bow's basic-attack sequence and release point, played slower to
// fill each ability's own longer commit time.
export const VOLLEY: AbilityDefinition = {
    id: "volley",
    name: "Volley",
    castSeqId: BOW_SHOT_CAST_SEQ_ID,
    contactFrame: 5,
    castSpeed: 1.45,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.38 }],
    effect: {
        delivery: {
            kind: DeliveryKind.PROJECTILE,
            spec: VOLLEY_ARROW_SPEC,
            count: 8,
            spreadAngleRadians: Math.PI / 3,
        },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(ARROW_DAMAGE)],
    },
};

export const POWER_SHOT: AbilityDefinition = {
    id: "power_shot",
    name: "Power Shot",
    castSeqId: BOW_SHOT_CAST_SEQ_ID,
    contactFrame: 5,
    castSpeed: 1.45,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: SPECIAL_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.38 }],
    effect: {
        delivery: singleShot(POWER_SHOT_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(20)],
    },
};

// The heal lands on the drink's last frame, as the bottle comes down; the HEAL lock is a pure
// re-use cooldown rather than a recovery animation, so the player is free to move as soon as the
// drink finishes.
export const HEALING_POTION: AbilityDefinition = {
    id: "healing_potion",
    name: "Healing Potion",
    castSeqId: HEALING_POTION_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 1.46,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 3,
    rechargeSeconds: 20,
    requires: [CooldownGroup.HEAL],
    locks: [
        { group: CooldownGroup.HEAL, seconds: 3 },
        { group: CooldownGroup.ATTACK, seconds: 1.5 },
    ],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 0, center: CircleCenter.CASTER },
        affects: Affects.SELF,
        payloads: [{ kind: PayloadKind.HEAL, amount: 30 }],
    },
};

// Enemy abilities play their cast sequence at natural speed: slowing them down to fill the attack
// cadence read as the enemy hanging in its top pose. The ATTACK lock carries the rest of the
// cadence as idle recovery once the animation has finished.
export const GOBLIN_MELEE_SEQ_ID = 6183;
export const TZ_KIH_MELEE_SEQ_ID = 2621;
export const TZ_KEK_MELEE_SEQ_ID = 2625;

// The chaff melee swing, one definition per rig since each rig's swing has its own contact frame.
function chaffMelee(
    id: string,
    name: string,
    castSeqId: number,
    contactFrame: number,
): AbilityDefinition {
    return {
        id,
        name,
        castSeqId,
        contactFrame,
        castSpeed: 1,
        channelSeconds: 0,
        manaCost: 0,
        maxCharges: 1,
        rechargeSeconds: 0,
        requires: [CooldownGroup.ATTACK],
        locks: [{ group: CooldownGroup.ATTACK, seconds: 1.84 }],
        effect: {
            delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
            affects: Affects.HOSTILE,
            payloads: [damagePayload(2, 5)],
        },
    };
}

export const GOBLIN_MELEE = chaffMelee("goblin_melee", "Goblin Melee", GOBLIN_MELEE_SEQ_ID, 5);
export const TZ_KIH_MELEE = chaffMelee("tz_kih_melee", "Tz-Kih Bite", TZ_KIH_MELEE_SEQ_ID, 9);
// Tz-Kek's mid-swing hold.
export const TZ_KEK_MELEE = chaffMelee("tz_kek_melee", "Tz-Kek Melee", TZ_KEK_MELEE_SEQ_ID, 5);

export const TOK_XIL_RANGED_SHOT_CAST_SEQ_ID = 2633;

// Tok-Xil's kiting band tops out at 7 tiles; the shot's range matches that band so it can always
// fire once in range, without needing a second number to keep in sync. Fires a real projectile
// (see TOK_XIL_SHOT_SPEC) instead of the old telegraphed ground strike. The second, later
// aim-hold is the shot's release.
export const TOK_XIL_RANGED_SHOT: AbilityDefinition = {
    id: "tok_xil_ranged_shot",
    name: "Tok-Xil Ranged Shot",
    castSeqId: TOK_XIL_RANGED_SHOT_CAST_SEQ_ID,
    contactFrame: 9,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 0.46 }],
    effect: {
        delivery: singleShot(TOK_XIL_SHOT_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(4, 8)],
    },
};

export const KET_ZEK_FIRE_BLAST_CAST_SEQ_ID = 2647;

// Ket-Zek's casting band tops out at 10 tiles, matching the blast's range for the same reason as
// Tok-Xil above. Fires a real projectile (see KET_ZEK_FIRE_BLAST_SPEC) instead of the old
// telegraphed ground strike. The second, later cast-hold is the blast's release.
export const KET_ZEK_FIRE_BLAST: AbilityDefinition = {
    id: "ket_zek_fire_blast",
    name: "Ket-Zek Fire Blast",
    castSeqId: KET_ZEK_FIRE_BLAST_CAST_SEQ_ID,
    contactFrame: 11,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.63 }],
    effect: {
        delivery: singleShot(KET_ZEK_FIRE_BLAST_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(14, 22)],
    },
};

export const YT_MEJKOT_MELEE_CAST_SEQ_ID = 2637;

// The held pose right after the fast swing is the contact hold.
export const YT_MEJKOT_MELEE: AbilityDefinition = {
    id: "yt_mejkot_melee",
    name: "Yt-MejKot Slam",
    castSeqId: YT_MEJKOT_MELEE_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2.4 }],
    effect: {
        delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(5, 9)],
    },
};

// Uses the HEAL cooldown group (not ATTACK) so the pulse recurs on its own 6s timer independently
// of Yt-MejKot's melee swings. castSeqId is provisional (2639, from the same animation block as
// its idle/walk/death/melee seqs 2636-2638/2637) pending visual confirmation with the anim viewer.
export const YT_MEJKOT_HEAL_SEQ_ID = 2639;

// The heal sequence has no single standout hold (a fairly uniform raise into a slightly longer
// close), so the release frame is a judgment call: the first of the longer closing frames.
export const YT_MEJKOT_HEAL_PULSE: AbilityDefinition = {
    id: "yt_mejkot_heal_pulse",
    name: "Yt-MejKot Heal Pulse",
    castSeqId: YT_MEJKOT_HEAL_SEQ_ID,
    contactFrame: 6,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.HEAL],
    locks: [{ group: CooldownGroup.HEAL, seconds: 6 }],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 4, center: CircleCenter.CASTER },
        affects: Affects.ALLIED,
        payloads: [{ kind: PayloadKind.HEAL, amount: 15 }],
        hitEffect: { kind: VisualEffectKind.TZHAAR_HEAL, seqId: TZHAAR_HEAL_SEQ_ID, height: 120 },
    },
};

// Elder maul special attack (obj 21003): a wide overhead smash in front of the caster, verified
// against the cache with a throwaway script (seq 7514, in the same animation block as the elder
// maul's normal attack, seq 7516).
export const MAUL_SMASH_CAST_SEQ_ID = 11124;
const MAUL_SMASH_RECHARGE_SECONDS = 10;

// Frame 10 is only the 40 ms downswing transient (the maul snapping through); frame 11, held for
// 100 ms from 1.02 s in, is the impact pose, so contact lands there. The rest is recovery under
// the ATTACK lock, so the hit lands as the maul comes down instead of after it's already back up.
export const MAUL_SMASH: AbilityDefinition = {
    id: "maul_smash",
    name: "Maul Smash",
    castSeqId: MAUL_SMASH_CAST_SEQ_ID,
    contactFrame: 11,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: MAUL_SMASH_RECHARGE_SECONDS,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 1.6 }],
    effect: {
        delivery: { kind: DeliveryKind.CONE, angleRadians: (2 * Math.PI) / 3, reach: 3 * 128 },
        affects: Affects.HOSTILE,
        payloads: [MELEE_SPECIAL_DAMAGE],
        // Two impact graphics both read well in the per-tile placement and the owner has not
        // picked one yet: MAUL_IMPACT_SPARK (2805, the elder maul special's own ground sparks)
        // and DUST_WAVE (2184, Zebak's roar dust, swap in with DUST_WAVE_SEQ_ID). Both stay baked.
        hitEffect: {
            kind: VisualEffectKind.MAUL_IMPACT_SPARK,
            seqId: MAUL_IMPACT_SPARK_SEQ_ID,
            height: 0,
        },
    },
};

// TzTok-Jad's three attacks, verified from the cache (see EnemyType.ts's TZTOK_JAD comment for how
// the cast seq ids were picked). Cycled in a fixed pattern (see EnemyType.BossPattern) rather than
// picked by priority, so each ability's own ATTACK lock just needs to cover its own recovery
// before the pattern's next entry becomes eligible, not to sequence the attacks itself.

export const JAD_MELEE_BITE_CAST_SEQ_ID = 2655;

// The jaw-closed hold (the longer of its two holds) is the bite connecting.
export const JAD_MELEE_BITE: AbilityDefinition = {
    id: "jad_melee_bite",
    name: "TzTok-Jad Bite",
    castSeqId: JAD_MELEE_BITE_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 2.92 }],
    effect: {
        delivery: { kind: DeliveryKind.TARGET, reach: MELEE_REACH },
        affects: Affects.HOSTILE,
        payloads: [damagePayload(20, 35)],
    },
};

export const JAD_RANGED_STOMP_CAST_SEQ_ID = 2652;

// The frames accelerate into a quick 2-tick frame right as the rock launches.
export const JAD_RANGED_STOMP: AbilityDefinition = {
    id: "jad_ranged_stomp",
    name: "TzTok-Jad Stomp",
    castSeqId: JAD_RANGED_STOMP_CAST_SEQ_ID,
    contactFrame: 8,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.14 }],
    effect: {
        delivery: singleShot(JAD_RANGED_ROCK_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(30, 45)],
    },
};

export const JAD_MAGE_BLAST_CAST_SEQ_ID = 2656;

// Uniform frame lengths with no distinct hold to read, so the contact frame is ~55% through the
// build-up, the rule of thumb used when the frame data has no standout hold.
export const JAD_MAGE_BLAST: AbilityDefinition = {
    id: "jad_mage_blast",
    name: "TzTok-Jad Mage Blast",
    castSeqId: JAD_MAGE_BLAST_CAST_SEQ_ID,
    contactFrame: 17,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.ATTACK],
    locks: [{ group: CooldownGroup.ATTACK, seconds: 3.29 }],
    effect: {
        delivery: singleShot(JAD_MAGE_BLAST_SPEC),
        affects: Affects.HOSTILE,
        payloads: [damagePayload(25, 40)],
        hitEffect: { kind: VisualEffectKind.JAD_FIRE_HIT, seqId: JAD_FIRE_SEQ_ID, height: 124 },
    },
};

// Yt-HurKot: same heal pulse as Yt-MejKot but bigger, reusing the shared heal cast seq (see
// EnemyType.ts's YT_HURKOT comment).
export const YT_HURKOT_HEAL_PULSE: AbilityDefinition = {
    id: "yt_hurkot_heal_pulse",
    name: "Yt-HurKot Heal Pulse",
    castSeqId: YT_MEJKOT_HEAL_SEQ_ID,
    contactFrame: 6,
    castSpeed: 1,
    channelSeconds: 0,
    manaCost: 0,
    maxCharges: 1,
    rechargeSeconds: 0,
    requires: [CooldownGroup.HEAL],
    locks: [{ group: CooldownGroup.HEAL, seconds: 6 }],
    effect: {
        delivery: { kind: DeliveryKind.CIRCLE, radiusTiles: 4, center: CircleCenter.CASTER },
        affects: Affects.ALLIED,
        payloads: [{ kind: PayloadKind.HEAL, amount: 30 }],
        hitEffect: { kind: VisualEffectKind.TZHAAR_HEAL, seqId: TZHAAR_HEAL_SEQ_ID, height: 120 },
    },
};

export function buildPlayerAbilityBar(style: WeaponStyle): readonly AbilityDefinition[] {
    switch (style) {
        case WeaponStyle.MELEE:
            return [SCIMITAR_SLASH, CLEAVE, MAUL_SMASH, HEALING_POTION];
        case WeaponStyle.MAGIC:
            return [MAGIC_BOLT, ICE_BARRAGE, HEALING_POTION];
        case WeaponStyle.RANGED:
            return [BOW_SHOT, VOLLEY, POWER_SHOT, HEALING_POTION];
    }
}

export type AbilityBarsByStyle = Record<WeaponStyle, readonly ResolvedAbility[]>;

// The composition point for the player's abilities: every bar's cast timing is read from the
// cache here, once per Player, so nothing downstream needs the sequence loaders.
export function resolvePlayerAbilityBars(
    seqTypeLoader: SeqTypeLoader,
    seqFrameLoader: SeqFrameLoader,
): AbilityBarsByStyle {
    const resolveBar = (style: WeaponStyle) =>
        buildPlayerAbilityBar(style).map((definition) =>
            resolveAbility(definition, seqTypeLoader, seqFrameLoader),
        );
    return {
        [WeaponStyle.MELEE]: resolveBar(WeaponStyle.MELEE),
        [WeaponStyle.MAGIC]: resolveBar(WeaponStyle.MAGIC),
        [WeaponStyle.RANGED]: resolveBar(WeaponStyle.RANGED),
    };
}
