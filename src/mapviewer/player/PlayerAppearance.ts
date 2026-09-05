export enum PlayerGender {
    MALE,
    FEMALE,
}

export class PlayerAppearance {
    constructor(
        readonly baseModelIds: readonly number[],
        readonly equippedItemIds: readonly number[],
        readonly gender: PlayerGender,
        readonly ambient: number,
        readonly contrast: number,
    ) {}
}
