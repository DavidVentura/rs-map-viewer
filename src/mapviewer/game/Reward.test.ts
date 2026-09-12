import { EquipmentPath } from "./Equipment";
import {
    createEquipmentChange,
    createEquipmentGrantReward,
    createExperienceReward,
    createRecoveryReward,
    createRewardId,
    createRewards,
    createUpgradeChoiceReward,
} from "./Reward";
import { UpgradeId } from "./upgrades";

describe("rewards", () => {
    it("retains the authored reward order", () => {
        const rewards = createRewards([
            createExperienceReward(createRewardId("first"), 20),
            createRecoveryReward(createRewardId("second"), 10, 5),
        ]);

        expect(rewards.map((reward) => reward.id)).toEqual([
            createRewardId("first"),
            createRewardId("second"),
        ]);
    });

    it("models every supported reward kind", () => {
        const upgrade = createUpgradeChoiceReward(createRewardId("choice"), [UpgradeId.DAMAGE_UP]);
        const equipment = createEquipmentGrantReward(createRewardId("gear"), [
            createEquipmentChange(EquipmentPath.BOW, 2),
        ]);
        const recovery = createRecoveryReward(createRewardId("recover"), 20, 10);
        const experience = createExperienceReward(createRewardId("experience"), 50);

        expect([upgrade.kind, equipment.kind, recovery.kind, experience.kind]).toEqual([
            "UPGRADE_CHOICE",
            "EQUIPMENT_GRANT",
            "RECOVERY",
            "EXPERIENCE",
        ]);
    });

    it("rejects empty choice and equipment grants", () => {
        expect(() => createUpgradeChoiceReward(createRewardId("choice"), [])).toThrow(RangeError);
        expect(() => createEquipmentGrantReward(createRewardId("gear"), [])).toThrow(RangeError);
    });

    it("rejects duplicate reward and equipment path identifiers", () => {
        const first = createExperienceReward(createRewardId("duplicate"), 1);
        const second = createRecoveryReward(createRewardId("duplicate"), 1, 0);

        expect(() => createRewards([first, second])).toThrow(RangeError);
        expect(() =>
            createEquipmentGrantReward(createRewardId("gear"), [
                createEquipmentChange(EquipmentPath.BOW, 1),
                createEquipmentChange(EquipmentPath.BOW, 2),
            ]),
        ).toThrow(RangeError);
    });
});
