import {
    EquipmentChange,
    EquipmentGrant,
    EquipmentGrantId,
    EquipmentPath,
    createEquipmentGrant,
} from "./Equipment";
import { UpgradeId } from "./upgrades";

declare const rewardIdBrand: unique symbol;

export type RewardId = string & { readonly [rewardIdBrand]: true };
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export type UpgradeChoiceReward = {
    readonly kind: "UPGRADE_CHOICE";
    readonly id: RewardId;
    readonly choices: NonEmptyReadonlyArray<UpgradeId>;
};

export type EquipmentGrantReward = {
    readonly kind: "EQUIPMENT_GRANT";
    readonly id: RewardId;
    readonly grant: EquipmentGrant;
};

export type RecoveryReward = {
    readonly kind: "RECOVERY";
    readonly id: RewardId;
    readonly health: number;
    readonly mana: number;
};

export type ExperienceReward = {
    readonly kind: "EXPERIENCE";
    readonly id: RewardId;
    readonly amount: number;
};

export type Reward = UpgradeChoiceReward | EquipmentGrantReward | RecoveryReward | ExperienceReward;

function nonEmpty<T>(values: readonly T[]): NonEmptyReadonlyArray<T> {
    if (values.length === 0) {
        throw new RangeError("Expected at least one value");
    }
    return [values[0], ...values.slice(1)];
}

export function createRewardId(value: string): RewardId {
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
        throw new TypeError(`Invalid reward id: ${value}`);
    }
    return value as RewardId;
}

export function createUpgradeChoiceReward(
    id: RewardId,
    choices: readonly UpgradeId[],
): UpgradeChoiceReward {
    if (choices.length === 0) {
        throw new RangeError("An upgrade choice reward requires at least one choice");
    }
    if (new Set(choices).size !== choices.length) {
        throw new RangeError("An upgrade choice reward cannot offer an upgrade more than once");
    }
    return { kind: "UPGRADE_CHOICE", id, choices: nonEmpty(choices) };
}

export function createEquipmentChange(path: EquipmentPath, tierIndex: number): EquipmentChange {
    if (!Number.isInteger(tierIndex) || tierIndex < 0) {
        throw new RangeError(`Equipment tier index must be a non-negative integer: ${tierIndex}`);
    }
    return { path, tierIndex };
}

export function createEquipmentGrantReward(
    id: RewardId,
    changes: readonly EquipmentChange[],
): EquipmentGrantReward {
    return {
        kind: "EQUIPMENT_GRANT",
        id,
        grant: createEquipmentGrant(EquipmentGrantId.INDIVIDUAL, "Equipment reward", changes),
    };
}

export function createNamedEquipmentGrantReward(
    id: RewardId,
    grant: EquipmentGrant,
): EquipmentGrantReward {
    return { kind: "EQUIPMENT_GRANT", id, grant };
}

export function createRecoveryReward(id: RewardId, health: number, mana: number): RecoveryReward {
    if (!Number.isFinite(health) || !Number.isFinite(mana) || health < 0 || mana < 0) {
        throw new RangeError("Recovery values must be finite and non-negative");
    }
    if (health === 0 && mana === 0) {
        throw new RangeError("A recovery reward must restore health or mana");
    }
    return { kind: "RECOVERY", id, health, mana };
}

export function createExperienceReward(id: RewardId, amount: number): ExperienceReward {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new RangeError(`Experience amount must be a positive integer: ${amount}`);
    }
    return { kind: "EXPERIENCE", id, amount };
}

export function createRewards(rewards: readonly Reward[]): readonly Reward[] {
    if (new Set(rewards.map((reward) => reward.id)).size !== rewards.length) {
        throw new RangeError("A reward collection cannot contain duplicate reward ids");
    }
    return [...rewards];
}
