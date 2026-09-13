import { AnimationProgress, AnimationState } from "../game/Animation";
import { isEncounterActorVisible } from "../game/EncounterActor";
import { GameWorld } from "../game/GameWorld";
import { SeqSoundCatalog } from "./FrameSounds";
import { SfxPlayer } from "./SfxPlayer";
import { crossedFrameSounds, frameSoundGain } from "./frameSoundCues";

type FrameSoundSource = {
    readonly animation: AnimationState;
    readonly x: number;
    readonly y: number;
    // A hidden actor keeps animating but makes no sound.
    readonly audible: boolean;
};

function frameSoundSources(world: GameWorld): FrameSoundSource[] {
    const sources: FrameSoundSource[] = [];
    const { player } = world;
    if (player) {
        sources.push({ animation: player.animation, x: player.x, y: player.y, audible: true });
    }
    for (const enemy of world.enemies) {
        sources.push({ animation: enemy.animation, x: enemy.x, y: enemy.y, audible: true });
    }
    for (const actor of world.encounterActors) {
        sources.push({
            animation: actor.animation,
            x: actor.x,
            y: actor.y,
            audible: isEncounterActorVisible(actor),
        });
    }
    for (const projectile of world.projectiles) {
        const animation = projectile.travelAnimation;
        if (animation) {
            sources.push({ animation, x: projectile.x, y: projectile.y, audible: true });
        }
    }
    for (const effect of world.visualEffects) {
        sources.push({ animation: effect.animation, x: effect.x, y: effect.y, audible: true });
    }
    return sources;
}

// Plays the frame sounds of every animation in the world as the sim advances it, heard from the
// player's position. Each animation's last reading is kept, so a frame's sound plays once however
// the render frames fall across it.
export class FrameSoundDriver {
    private readonly readings = new WeakMap<AnimationState, AnimationProgress>();

    constructor(
        private readonly catalog: SeqSoundCatalog,
        private readonly sfxPlayer: SfxPlayer,
    ) {}

    update(world: GameWorld): void {
        const listener = world.player;
        for (const source of frameSoundSources(world)) {
            const current = source.animation.progress;
            const previous = this.readings.get(source.animation);
            this.readings.set(source.animation, current);
            const sounds = this.catalog.get(current.seqId);
            if (!sounds || !listener || !source.audible) {
                continue;
            }
            for (const sound of crossedFrameSounds(sounds, previous, current)) {
                const gain = frameSoundGain(sound.rangeTiles, source, listener);
                if (gain > 0) {
                    this.sfxPlayer.play(sound, gain);
                }
            }
        }
    }
}
