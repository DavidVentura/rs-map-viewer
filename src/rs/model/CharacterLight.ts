// The direction OSRS lights players and NPCs from (steeper than the -50, -10, -50 scenery light,
// so upward-facing faces on a standing actor come out near full brightness). Shared by
// PlayerModelLoader, NpcModelLoader and the ground-item bake, which lights dropped items the same
// way so they read on the floor instead of under the scenery light meant for lying-flat geometry.
export const CHARACTER_LIGHT_DIRECTION = {
    x: -30,
    y: -50,
    z: -30,
} as const;

export const CHARACTER_LIGHT_CONTRAST_BONUS = 850;
