import { HitEffect } from "./Effect";
import { EnemyTypeId } from "./EnemyType";
import { ProjectileSpec, ZEBAK_PHANTOM_MAGIC_SPEC, ZEBAK_PHANTOM_RANGED_SPEC } from "./Projectile";
import { VisualEffectKind } from "./VisualEffect";
import { WardenP3ArenaFloor, wardenP3SolidFloorTiles } from "./WardenP3Arena";
import { WardenP3Tile, WardenPhantom, ZebakPhantomStyle } from "./WardenP3Director";
import { RandomSource } from "./abilityRules";

export type ZebakPhantomShot = {
    readonly spec: ProjectileSpec;
    readonly hitEffect: HitEffect;
};

export const ZEBAK_PHANTOM_SHOTS: Readonly<Record<ZebakPhantomStyle, ZebakPhantomShot>> = {
    [ZebakPhantomStyle.MAGIC]: {
        spec: ZEBAK_PHANTOM_MAGIC_SPEC,
        hitEffect: { kind: VisualEffectKind.ZEBAK_PHANTOM_MAGIC_IMPACT, height: 0 },
    },
    [ZebakPhantomStyle.RANGED]: {
        spec: ZEBAK_PHANTOM_RANGED_SPEC,
        hitEffect: { kind: VisualEffectKind.ZEBAK_PHANTOM_RANGED_IMPACT, height: 0 },
    },
};

export type BabaPhantomRockFall = {
    // Rocks dropped on random solid floor besides the one aimed at the player's tile.
    readonly extraRockCount: number;
    readonly shadow: HitEffect;
};

export const BABA_PHANTOM_ROCK_FALL: BabaPhantomRockFall = {
    extraRockCount: 6,
    shadow: { kind: VisualEffectKind.FALLING_SHADOW, height: 0 },
};

export const WARDEN_P3_PHANTOM_DAMAGE: Readonly<Record<WardenPhantom, number>> = {
    [WardenPhantom.ZEBAK]: 20,
    [WardenPhantom.BABA]: 20,
};

export function wardenPhantomEnemyTypeId(phantom: WardenPhantom): EnemyTypeId {
    switch (phantom) {
        case WardenPhantom.ZEBAK:
            return EnemyTypeId.ZEBAK_PHANTOM;
        case WardenPhantom.BABA:
            return EnemyTypeId.BABA_PHANTOM;
    }
}

// The first rock always falls on the player's tile, wherever they stand, so standing still is never
// safe; the rest scatter over distinct solid floor tiles, which shrink as enrage destroys rows.
export function babaPhantomRockTargets(
    floor: WardenP3ArenaFloor,
    playerTile: WardenP3Tile,
    extraRockCount: number,
    random: RandomSource,
): readonly WardenP3Tile[] {
    if (!Number.isInteger(extraRockCount) || extraRockCount < 0) {
        throw new RangeError("extraRockCount must be a non-negative integer");
    }
    const pool: WardenP3Tile[] = wardenP3SolidFloorTiles(floor).filter(
        (tile) =>
            tile.x !== playerTile.x || tile.y !== playerTile.y || tile.level !== playerTile.level,
    );
    const pickCount = Math.min(extraRockCount, pool.length);
    for (let index = 0; index < pickCount; index++) {
        const swapIndex = index + Math.floor(random() * (pool.length - index));
        [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return [playerTile, ...pool.slice(0, pickCount)];
}
