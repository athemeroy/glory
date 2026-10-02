# Spatial combat

The simulation uses the same current skeleton and weapon transforms that the character renders. A melee hit requires physical contact during its damage window. Looking in roughly the same direction, standing within a skill's old range, or being vertically above a target does not create a hit.

## Body and weapon volumes

`combat-volumes.js` builds separate capsules for the head, segmented torso, hips, arms, hands, thighs, lower legs and feet. Clothing, hair and weapon decorations do not enlarge these hurt volumes. Model measurements in `mocapBody.shape` are in unscaled metres; the fighter's scale is applied once. `chestBone` and `spineBones` identify the measured anatomical order, since the imported `Spine02` is the waist rather than the highest chest joint. `headOffset` uses the Head bone's native local units.

Attacks use the actual blade, shaft, club, fist, palm, shin, shield or charging body. Palm strikes lead with the left hand. Roundhouse kicks and low sweeps use the right leg; spinning kicks use the source animation's left attacking leg. The planted supporting foot does not deal the kick's damage. Each segment has a stable part ID, so changing from a left punch to a right punch cannot sweep an invisible hit through the air between them.

Broad-phase rejection includes the target's actual extended limbs, rather than only its standing root radius. Narrow contact still requires overlap with an anatomical capsule. Directional arc checks follow the character's current physical yaw; they do not keep a separate frozen camera direction that disagrees with the visible weapon.

## Timing, projectiles and terrain

`Combat.updateMelee(dt)` runs after all fighters update and separate. Each hit entry owns a bounded damage window and a victim set. A single sweep can hit a victim once, while independent entries preserve multihit attacks. Swept weapon segments catch contacts between frames. Changing or interrupting an action cancels its pending windows.

Projectiles use continuous segment/capsule collision and resolve the nearest character or terrain contact first. Bullet visual size is independent of its narrow physical radius. Shots leave the real muzzle or hand, with a body-to-muzzle obstruction check. Contacts carry `point`, `normal`, `region`, the launch `origin`, and the current `incomingDir` for face-sensitive sand and head-sensitive status effects.

Explosions and beams have finite three-dimensional volumes and respect solid terrain. Ground waves, fire zones, cones and overhead columns have distinct heights. Ground placement uses a reference height to distinguish a target under a bridge from a target standing on it. Walls, raised platforms and ceilings also participate in movement and ray collision; high-speed dashes cannot pass through a thin wall merely because their final position is beyond it.

## AI and verification

AI spacing is calibrated by weapon and attacking body part. A spear user's palm uses palm reach rather than spear reach. Long weapons step back when crowded, and their pointed thrusts need room. AI can turn toward a visible target at its finite turn speed during wind-up; the active strike follows the actual resulting body and weapon pose. These movement choices do not enlarge hit volumes or change damage.

Run the deterministic geometry/terrain regression with:

```sh
node --loader ./tools/three-local-loader.mjs tools/combat-volume-regression.mjs
```

`tools/check-skill-contacts.py` exercises real animated models, basic chains, every default and alternative skill, charged attacks and the sword counter in Chrome. It samples valid near and farther distances and records contact regions, individual strike times and the closest physical gap for misses. `tools/check-balance.py` runs seeded real AI matchups with animation, collision, damage and status rules, while suppressing rendering. Its report includes actual elapsed simulation time, healing including quiet lifesteal, resource depletion, control duration and physical whiffs. A small seeded matchup sample is a regression tool, not a claim of a final competitive win rate.
