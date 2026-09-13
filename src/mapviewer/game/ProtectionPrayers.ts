import type { WeaponStyle } from "./Ability";

// Oldest first: a new prayer pushes the oldest out once both slots are taken.
export type ActiveProtectionPrayers =
    | readonly []
    | readonly [WeaponStyle]
    | readonly [WeaponStyle, WeaponStyle];

export type ProtectionPrayers = {
    readonly active: ActiveProtectionPrayers;
    readonly attacksReceived: number;
};

// Only attacks that land count, and the one that completes each count picks the prayer.
export type ProtectionPrayerRotation = {
    readonly attacksPerChange: number;
};

export const NO_PROTECTION_PRAYERS: ProtectionPrayers = { active: [], attacksReceived: 0 };

export enum AttackOutcome {
    LANDS = 0,
    PROTECTED = 1,
}

function withPrayer(active: ActiveProtectionPrayers, style: WeaponStyle): ActiveProtectionPrayers {
    switch (active.length) {
        case 0:
            return [style];
        case 1:
            return [active[0], style];
        case 2:
            return [active[1], style];
    }
}

// The attack is judged against the prayers up before it lands; the change it triggers only guards
// the attacks after it.
export function receiveStyledAttack(
    prayers: ProtectionPrayers,
    rotation: ProtectionPrayerRotation,
    style: WeaponStyle,
): { readonly prayers: ProtectionPrayers; readonly outcome: AttackOutcome } {
    const active: readonly WeaponStyle[] = prayers.active;
    const prayedAgainst = active.includes(style);
    if (prayedAgainst) {
        return { prayers, outcome: AttackOutcome.PROTECTED };
    }
    const attacksReceived = prayers.attacksReceived + 1;
    const changes = attacksReceived % rotation.attacksPerChange === 0;
    return {
        prayers: {
            active: changes ? withPrayer(prayers.active, style) : prayers.active,
            attacksReceived,
        },
        outcome: AttackOutcome.LANDS,
    };
}
