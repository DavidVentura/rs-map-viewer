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

### Candidate stance upgrades

These are options to prototype rather than a final upgrade pool. They should compound what a stance is already good at instead of repairing all of its weaknesses.

Melee upgrades can make entering a crowd increasingly rewarding:

- Enemies killed by melee attacks explode.
- Cleave and other swings gain substantially more area.
- A melee attack hits twice or returns for a second swing.
- Taking damage charges the next attack.
- Consecutive melee kills extend a short berserk effect.
- Entering melee grants temporary damage reduction.

Ranged upgrades can reward establishing a safe firing position and maintaining focus on a priority target:

- After landing a sequence of attacks without moving, the next shot fires twice like a dark bow.
- Further upgrades reduce the required stationary sequence, for example from five attacks to four.
- Repeated hits against one target progressively increase damage.
- Every fixed number of attacks fires twice, independently of the stationary-sequence version.
- Attacking after a substantial reposition empowers the next shot.
- Excess damage carries into another nearby target.
- A particular heavy shot gains knockback, while general knockback remains an open option.

The stationary sequence creates a deliberate bargain: the ranged player must first find a viable position, then earns exceptional single-target output by holding it. Strong general knockback may weaken that positioning requirement and give ranged too much crowd control, so both versions should be tested rather than assumed equivalent.

Magic upgrades can scale with the number of threats successfully caught in a cast:

- Each enemy hit refunds mana.
- Hitting several enemies grants an additional mana bonus.
- Area and freeze coverage increase.
- Frozen enemies spread freeze or explode when killed.
- Spells leave a weaker delayed echo or persistent ground effect.
- A cast may consume additional mana for greater area and damage.
- Successful casts may enable protection during a later cast.

Mana refunded per enemy reinforces magic as a crowd-efficient stance while leaving it deliberately less efficient against a lone boss. Boss encounters can still give magic value through burst windows and interactions with projectiles, floor hazards, shockwaves, or other encounter mechanics.

## Progression cadences

Progression operates on three distinct timescales.

### Seconds: combat decisions

Attacks, movement, stance changes, ability use, targeting, and pickups create immediate decisions.

### Minutes: character levels

Character level is shared by all stances. Per-stance levels would reward staying in the already strongest stance and make switching increasingly expensive.

Ordinary levels grant automatic universal numerical power so every stance remains viable. Candidate benefits include base damage, maximum health, a small heal, maximum mana, mana regeneration, and predetermined attack-speed or movement breakpoints. Levels establish the power curve and should have strong audiovisual feedback without interrupting combat for a choice.

Mechanical changes such as bounces, explosions, shields, and altered spell zones belong to deliberate phase choices rather than automatic level unlocks. This keeps the level system responsible for vertical power and leaves authorship of the build with the player.

### Major encounter beats: equipment and recovery

Equipment, large rewards, and recovery happen at authored checkpoints. Their value is controlled by phase completion rather than indirectly by the number of enemies in the phase.

Phase completion is also the preferred time for transformative stance choices. Fight Caves can present smaller choices after selected rounds, while a Warden can grant a larger choice at a phase transition. A mechanically intense final phase should not be interrupted by upgrade popups.

The current working ownership of progression is:

- Kills grant experience, and levels grant automatic universal stats.
- Enemies, elites, and bosses physically drop equipment and sustain.
- Phase completion grants a deliberate transformative stance choice and can guarantee appropriate equipment drops.

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

Item flood should be tested before being designed away. Floor litter can provide excitement and communicate the aftermath of a difficult phase, while excessive mandatory pickup work can turn it into maintenance. The absence of inventory management means this game may support less floor density than Diablo even if it uses the same visual language.

## Equipment scope

The current OSRS-style bronze-to-iron progression creates many small upgrades across several stance-specific slots. A short action run may benefit from fewer and more substantial tiers.

Possible primary-weapon progressions include:

- Melee: dragon scimitar, abyssal whip, scythe.
- Ranged: magic shortbow, crystal bow, twisted bow.
- Magic: ancient staff, trident or sanguinesti staff, Tumeken's shadow.

These are starting points rather than fixed ladders. Each tier should ideally alter attack behaviour as well as damage. A scythe can provide broad area coverage, a whip can extend reach or pass through enemies, and advanced ranged or magic weapons can similarly change their stance's attack pattern.

Primary weapons can carry the required stance progression. Ammunition, defenders, tomes, and other offhands can become less frequent modifier drops instead of parallel mandatory tier ladders. Shared slots such as an amulet remain suitable for universal bonuses.

Equipment bundles provide another way to reduce floor and reward-interface volume without removing visible equipment progression. A single drop represents a named set and equips every visual component of that set. For example, an `Ancestral robes` drop grants the ancestral hat, robe top, and robe bottom together. Equivalent melee and ranged outfits can use the same rule.

Bundles preserve the visual impact of a complete stance transformation while reducing three mandatory pickups and three drop rolls to one meaningful event. They can apply to armour sets while weapons and distinctive secondary items remain individual drops.

The following equipment models remain open for playtesting:

- Individual items litter the floor in the Diablo tradition.
- Complete armour sets drop as one bundle, while weapons remain individual.
- Major enemies drop curated packages containing several related items.
- Every stance advances together as an arsenal parcel.

Advancing the whole arsenal at once risks making equipment feel automatic and cheap. The phase structure should first test individual loot and armour-set bundles, with enough safe cleanup time to discover whether floor clutter is actually a problem.

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
5. Test individual equipment drops against bundled armour-set drops before committing to a floor-density solution.
6. Reduce equipment to fewer, more mechanically distinct tiers.
7. Add shared character levels with automatic baseline power and reserve transformative choices for phase completion.
8. Build a short Wardens sequence whose phase transitions can grant arbitrary authored rewards.

This creates enough structure to tune player power, enemy pressure, and reward frequency independently without prematurely balancing the full encounter.
