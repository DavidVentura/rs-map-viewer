import { Player } from "./Player";

describe("Player attack cooldown", () => {
    it("is ready to attack immediately after spawning", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        expect(player.isAttackReady(0)).toBe(true);
    });

    it("is not ready again immediately after attacking", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        player.attack(10, 0);
        expect(player.isAttackReady(10)).toBe(false);
    });

    it("becomes ready again once the cooldown has elapsed, by sim time", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        player.attack(10, 0);
        expect(player.isAttackReady(10 + Player.ATTACK_COOLDOWN_SECONDS - 0.001)).toBe(false);
        expect(player.isAttackReady(10 + Player.ATTACK_COOLDOWN_SECONDS)).toBe(true);
    });

    it("sets rotation offset by half a turn from the attack direction", () => {
        const player = new Player(0, 0, 0, 1, 2, 3, 4);
        player.attack(0, 500);
        expect(player.rotation).toBe((500 + 1024) & 2047);
    });
});
