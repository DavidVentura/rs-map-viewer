# Game design direction

## Identity

The game is an OSRS-based real-time action RPG rather than exclusively a horde game. Encounters can range from sustained Fight Caves crowd pressure to Wardens-style fights against one or two enemies with dense environmental mechanics.

Click-to-move is part of that identity. Attacking briefly gives up movement, as in traditional Diablo and Path of Exile combat. The design should make that commitment worthwhile instead of removing it through independent WASD movement and mouse aiming.

The existing padded target acquisition already supports crowds: holding the mouse over a group transfers attacks to nearby targets as enemies die. It should remain unless stance and pacing changes show a more specific targeting problem.

## Combat rhythm

The intended moment-to-moment loop is:

1. Create space.
2. Choose the stance that answers the current problem.
3. Commit to an attack or ability.
4. Gain enough damage, control, or safety to justify stopping.
5. Reposition.

Fast basic attacks alone do not make a satisfying horde tool. Every stance's basic attack must express its purpose and produce an appropriate return for its movement commitment.

## Stances

Stance switching should be driven by changing combat needs, rather than rotating to whichever stance has an available cooldown.

### Melee

- Close-range cleave and mass clearing.
- Takes less damage and can survive occupying dangerous space.
- Uses knockback, sustain, retaliation, or similar tools to relieve surrounding pressure.
- Gives up safety and range in exchange for control over nearby enemies.

### Ranged

- Highest reliable single-target damage.
- Short attack commitment and strong damage uptime while repositioning between shots.
- Good at priority targets and bosses.
- Has fewer or weaker crowd-control tools.

### Magic

- Area burst, control, and encounter utility.
- Freezes, groups, destroys, or otherwise manipulates threats.
- Can deal high damage when the player creates a safe casting window.
- Is constrained by mana and longer cast commitment.

The stances do not need equal value at every moment. A movement-heavy boss phase may naturally favour ranged, while melee provides emergency durability and magic exploits safe burst windows. Each stance should retain a situational reason to exist.

Cross-stance combinations can be a build archetype without becoming the mandatory baseline. Examples include shattering frozen enemies in melee, empowering the first ranged shot after switching, restoring mana through melee kills, or gaining an entry effect when adopting a stance.

## Progression cadences

Progression operates on three distinct timescales.

### Seconds: combat decisions

Attacks, movement, stance changes, ability use, targeting, and pickups create immediate decisions.

### Minutes: character levels and build choices

Character level is shared by all stances. Per-stance levels would reward staying in the already strongest stance and make switching increasingly expensive.

Ordinary levels grant modest universal power so every stance remains viable. Milestone levels grant transformative choices that define the run. Numerical improvements can establish the required power curve, while choices should preferably change behaviour: piercing arrows, wider melee attacks, frozen-enemy explosions, altered spell zones, and stance-switch interactions.

Choice timing belongs to the encounter. Fight Caves can present choices during safe breaks; a Wardens encounter can award them at phase transitions. A mechanically intense final phase should not be interrupted by upgrade popups.

### Major encounter beats: equipment and recovery

Equipment, large rewards, and recovery happen at authored checkpoints. Their value is controlled by phase completion rather than indirectly by the number of enemies in the phase.

## Waves, rounds, and phases

Spawn waves and reward phases are separate concepts.

- A wave changes enemy composition or increases pressure.
- Several overlapping waves can form one round or phase.
- A phase ends at an authored climax such as an elite, miniboss, boss-health threshold, or mechanical objective.
- The arena remains safe after phase completion until the player deliberately starts the next phase.

This supports a rhythm such as:

1. Sustained horde pressure across several overlapping waves.
2. An elite or boss climax.
3. A safe period for loot, recovery, and build decisions.
4. Player-initiated start of the next phase.

The quiet period gives sustained pressure a readable shape without inserting a pause after every small wave.

## Equipment and floor loot

Floor loot fits the Diablo-style presentation and does not require a chest abstraction. Player-initiated phases solve the pickup-time problem:

- Confident players can collect equipment immediately for a mid-phase power gain.
- Players under pressure can leave it on the floor and collect it after clearing the phase.
- The next phase waits until the player chooses to continue.

Equipment should not expire during its phase or the cleanup period. Important drops need clear labels and visibility beneath enemies. Pickup reach can be generous because there is no inventory-management game attached to collecting an upgrade.

Starting the next phase may collect all remaining earned loot automatically. This makes mid-phase collection a tactical opportunity while preventing post-combat pixel hunting.

Random enemy drops and guaranteed phase rewards serve different purposes:

- Enemy drops create surprise and tempt the player to take risks during combat.
- Phase-completion drops guarantee a healthy progression curve despite random results.

Phase rewards can still burst onto the floor rather than appearing in a menu or chest.

## Equipment scope

The current OSRS-style bronze-to-iron progression creates many small upgrades across several stance-specific slots. A short action run may benefit from fewer and more substantial tiers.

Possible primary-weapon progressions include:

- Melee: dragon scimitar, abyssal whip, scythe.
- Ranged: magic shortbow, crystal bow, twisted bow.
- Magic: ancient staff, trident or sanguinesti staff, Tumeken's shadow.

These are starting points rather than fixed ladders. Each tier should ideally alter attack behaviour as well as damage. A scythe can provide broad area coverage, a whip can extend reach or pass through enemies, and advanced ranged or magic weapons can similarly change their stance's attack pattern.

Primary weapons can carry the required stance progression. Ammunition, defenders, tomes, and other offhands can become less frequent modifier drops instead of parallel mandatory tier ladders. Shared slots such as an amulet remain suitable for universal bonuses.

Upgrading every stance as one equipment parcel remains an available option, but it risks making item acquisition feel automatic and cheap. The phase structure should first be tested with meaningful floor drops and guaranteed phase rewards before introducing whole-arsenal upgrades.

## Encounter archetypes

### Fight Caves

Fight Caves tests crowd clearing, priority targeting, spatial control, and growth into increasingly large enemy groups. Several spawn waves should be grouped into a smaller number of reward phases. Smaller phase rewards can be frequent, while bosses and major rounds award larger equipment changes.

### Wardens

Wardens tests damage uptime while moving, reading simultaneous attacks, preserving floor space, and choosing safe moments to commit. Individual boss phases can use the same structural phase system as Fight Caves while defining different completion conditions and rewards.

Progress during a boss encounter should come from authored events rather than raw damage dealt. Suitable triggers include boss-health thresholds, phase completion, resolved mechanics, objectives, and add kills. Damage-based experience makes progression depend on boss durability and creates circular balance incentives.

Earlier Warden phases can grant major choices and equipment. The final phase can then remain an uninterrupted endurance and execution test involving lightning, attacks from both sides, shockwaves, and progressive floor destruction.

## Near-term prototype

The next useful prototype should test a short slice of each encounter type:

1. Sharpen the three stance identities and their basic attacks.
2. Keep click-to-move and the existing padded target acquisition.
3. Group Fight Caves spawn waves into a few player-started reward phases.
4. Leave equipment on the floor during combat and provide safe cleanup time after a phase.
5. Reduce equipment to fewer, more mechanically distinct tiers.
6. Add shared character levels with automatic baseline power and less frequent transformative choices.
7. Build a short Wardens sequence whose phase transitions can grant arbitrary authored rewards.

This creates enough structure to tune player power, enemy pressure, and reward frequency independently without prematurely balancing the full encounter.
