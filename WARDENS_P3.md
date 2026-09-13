# Wardens Phase 3

## Scope

Build a complete solo encounter based on Tumeken's Warden Phase 3 without invocations. It includes the normal phase, all four energy-siphon intermissions, Zebak and Ba-Ba phantom attacks, and the final enrage.

The first playable version uses stiff NPC models. Existing spot animations and actor rotation communicate mechanics where possible; bespoke actor animation support can follow after the fight is playable.

## Fight structure

The Warden is a stationary target at the end of the arena.

During the normal phase it repeats a fixed floor-slam sequence:

1. Right
2. Left
3. Centre

The Warden rotates towards the upcoming attack before it resolves. This rotation and the fixed sequence are the warning. No generic tile contour or telegraph overlay is needed.

At 80%, 60%, 40%, and 20% health, the Warden pauses its slam cycle, becomes invulnerable, and creates the solo energy-siphon layout. When the intermission resolves, the Warden becomes vulnerable and resumes the cycle. The second and third intermissions introduce Zebak and Ba-Ba phantom attacks respectively.

At 5% health, the Warden stops slamming, heals by 20% of its maximum health, and enters enrage. Lightning replaces floor slams, while the arena loses its furthest row periodically until only the row immediately in front of the Warden remains. Zebak and Ba-Ba continue attacking throughout enrage.

## Energy siphons

Energy siphons are encounter-mechanic targets rather than ordinary enemies with health. Each siphon is either hostile or reversed.

Only a player basic melee attack can reverse a hostile siphon. Ranged and magic basics, projectiles, area effects, and all skills or specials cannot target or affect siphons. Reversing every siphon before the deadline sends them into the Warden and damages it. Failure resolves the central shockwave.

In OSRS, attacking a siphon resets the player's attack timer, allowing the solo pattern to be completed by clicking once per 600 ms tick. This game has no equivalent attack-timer interaction, so the initial encounter deliberately omits it. The siphon cadence should be revisited if the mechanic feels like slow administrative clicking under this combat system.

## Visual communication

-   Floor slams use Warden rotation and their deterministic order. The affected side travels as a mirrored L-shaped wave over 1.2 seconds; a two-to-three-row band lifts vertically while remaining flat.
-   Lightning uses the existing growing shadow warning followed by the normal lightning spot animation.
-   Removed rows use the existing flying-tile spot animation if it reads correctly. The prototype may remove a row directly until that asset is confirmed.
-   Phantom attacks use their corresponding projectiles and spot animations.
-   Siphon orientation distinguishes hostile siphons from reversed ones.

## Architecture

Wardens mechanics belong to a dedicated pure encounter director rather than the generic enemy ability loop or wave director. Its input is a typed snapshot of fight state and its output is the next state plus commands for the imperative `GameWorld` shell to execute.

Commands initially remain specific to Wardens, including directional slam resolution, siphon spawning and resolution, vulnerability changes, phantom attacks, lightning strikes, arena-row removal, and entering enrage. Shared hazard or encounter abstractions should only be extracted after the complete fight exposes repeated concepts.

The existing ability system remains responsible for ordinary actor-initiated combat actions. Floor slams, siphon intermissions, lightning, and arena destruction are encounter mechanics even though some of them deal damage.

## Implementation order

1. Add the arena, stationary Warden, and encounter lifecycle.
2. Implement the pure Warden director and directional floor-slam damage regions.
3. Add mechanic-only siphon targeting and the four health thresholds.
4. Add Zebak and Ba-Ba phantom scheduling and attacks.
5. Add enrage healing, lightning, shrinking rows, and runtime movement blocking.
6. Wire existing spot animations and identify the flying-tile presentation.
7. Play the complete loop and tune timing, damage, and health.
8. Reconsider shared encounter and ability abstractions using evidence from both Fight Caves and Wardens.

## Current status

The encounter, P3 Warden model, authored camera, arena bounds, directional slam sequence, four siphon thresholds, melee-only siphon targeting, phantom activation schedule, enrage transition, lightning schedule, row-removal schedule, and encounter completion are wired. Zebak and Ba-Ba currently remain inert visual actors even after their scheduled activation.

The remaining work is:

1. Visually tune the L-shaped floor wave's lift height, active width, and exact footprint against gameplay captures.
2. Implement Zebak and Ba-Ba attacks, including their projectiles, impact graphics, timing, and damage regions.
3. Make enrage row removal alter rendered terrain. Collision already rejects removed rows, but their original floor geometry remains visible.
4. Confirm the lightning warning and strike graphics, siphon positions, phantom positions, damage values, health, and cadence through a complete playthrough.
5. Add proper Warden, phantom, and siphon animations after the mechanics and positioning settle.
6. Revisit the omitted siphon attack-timer reset if the melee-click cadence needs it.
