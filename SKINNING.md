# GPU skinning (implemented for actors, map NPCs and animated locs)

## Why
Actors are currently baked: every animation frame of every body/item is posed on the CPU and
stored as its own mesh copy in the actor buffer. The body/attachment split cut the player bake
from ~47 MB of indices to ~3.5 MB and ~4x the time, but the cost still scales with
frames x variants, and equipment/animation blending stay awkward.

## What OSRS animation is
Old-style sequences are not bone skinning. Each vertex has a label (group). A frame is a list of
ops on groups: set an origin from the centre of some groups, then translate / rotate / scale other
groups about it (`Model.animate`). Newer "skeletal" sequences (2022+) are real bone-weighted
skinning; the repo already has `SkeletalSeqLoader`. Both reduce, per model and per frame, to one
matrix per vertex group, computable once on the CPU.

## Findings (probe against the latest cache, 2026-09-11)
- Every vertex has exactly one label, so all vertices of a label share one affine matrix. An
  ORIGIN centroid is then `sum_l(M_l * sum_l) / sum_l(n_l)` over the label's (position sum,
  vertex count). The per-frame matrices need only those per-label stats, never a per-vertex pass.
  Posing every player and enemy seq this way lands within ~7 units (1/128 tile) of
  `Model.animate`; the gap is the CPU's integer truncation.
- Items can share the body's matrices, as long as they are computed over the full label range.
  Items carry labels up to 217 while the body only has ~49. Computing only the body's own labels
  puts weapons 150-280 units off (the source of the "~400 units" comment in
  `createItemAnimationSet`); over the full range items are within the same rounding as the body.
- No seq the game ships is skeletal, masked or op14, and none use color (LIGHT) ops. Nearly every
  TzHaar enemy seq and every gfx seq uses ALPHA ops, so alpha animation is required from the
  start. Player seqs use none.
- Lighting is computed once at rest pose and never redone after posing (as in the OSRS client),
  so no normals are needed in the shader.
- Depth writes stay on in the transparent pass, so faces can be assigned to the opaque or
  transparent pass once per mesh instead of once per frame.
- Enemy picking uses a projected hit-radius rect, not mesh bounds, so nothing else reads the
  baked frames.

## Scope
Everything in the actor buffer converts at once: player body and items, enemies, projectiles,
effects, ground items and the preview tools. They share one buffer, one program and one shader,
so converting only the player would mean running both vertex formats and both shader paths side
by side. Static meshes (arrows, ground items) simply get a single identity frame.

Map NPCs (`npc.vert.glsl`, the ambient wandering NPCs of the original map viewer) and animated
locs (fires, flags, waterfalls in `LocAnimated`) followed in a second pass. Each map square builds
its own skinned geometry and tables in `SdMapDataLoader`; NPCs draw with the npc program and
animated locs with the `SKINNED` variant of `main.vert.glsl`, which keeps contour ground, roof
hiding and priority. Locs pose in their unrotated space (`locPoseSpace`), NPCs before their
width/height scale (`NpcRestModel.poseSpace`). A rig only gives matrix rows to labels its models
have and its frames move; every other label shares the rest row.

Skeletal seqs are not implemented yet, but the format is designed so they slot in without a second
path (see "Skeletal, later" below). They render at rest pose for their whole duration. None of the
game's actors, nor the NPCs and animated locs of the squares sampled around Lumbridge and the
Fight Caves, use them; newer areas do, and those now show their skeletal NPCs and locs at rest
instead of animating.

The baked path is deleted in the same change that lands skinning, with no flag; git history is
the fallback.

## Plan

### Phase 0: matrix tables (pure code with tests, no rendering changes)
- Per-label position sums and counts from the rest `Model`.
- `buildFramePalette(stats, SeqFrame, postTransform)`: copies ORIGIN/TRANSLATE/ROTATE/SCALE from
  `transform0`, with the same `SINE`/`COSINE` tables. Masked ops are skipped like the CPU code does.
  LIGHT ops are ignored, which matches today, since the bake only reads the lit colors.
- Per-face-label alpha. A chain of `clamp(a + d, 0, 255)` steps collapses into one
  `clamp(a + D, lo, hi)`, so each (frame, face label) is three numbers and exact.
- Unit tests on synthetic frames: origin chains, rotate/scale about an origin, alpha folding.
- Representative parity tests compare the palette against the CPU pose for the significant
  operation and alpha combinations.
- TODO: `scripts/cache/verify-skinning.ts` poses every seq the game ships (player body, each item
  on the body's matrices, each enemy, each gfx) and compares against the CPU pose. It passes at
  <= 8 units of position error, with every face's visible/transparent state matching exactly.

### Phase 1: actor mesh format and builder
- Every vertex is posed as a weighted sum of matrices: `pos = sum_i(w_i / 255 * M[m_i]) * rest`.
  An old-style vertex is the one-entry case (its label's matrix, weight 255); a skeletal vertex
  later lists its bones. One shader loop covers both, so there is never an old/skeletal branch.
- Influence lists live in a static u32 texture, one entry per influence:
  `matrixIndex (16 bits) | weight (8 bits)`. Identical lists are shared, so an old-style model
  needs one list per label.
- Actor vertex grows to 16 bytes: the existing 12 plus one u32 with
  `influenceStart (20 bits) | influenceCount - 1 (4 bits) | alphaLabel (8 bits, 0 = none)`.
  Labels are renumbered compactly per rig (a set of meshes sharing one matrix table). The builder
  throws when a value overflows its field. Terrain and locs keep the 12-byte format.
- `ActorMeshBuilder` replaces the actor loader's use of `SceneBuffer` and writes one rest mesh per
  model:
  - A face goes to the transparent part when it is transparent at rest or its face label has an
    alpha op in any of the rig's seqs.
  - Faces invisible at rest are kept when their label is alpha-animated (fade-in gfx such as 444
    rely on this), dropped otherwise.
  - Textured faces ignore face alpha, matching `getModelFaces`.
  - Vertex de-duplication keys on all four words; the `v0*v1*v2` product hash can collide.
- Items keep merging with the body and emitting faces from `bodyFaceCount` on, so lighting at the
  seams stays identical.

### Phase 2: matrix texture, instance data, shader
- `ActorBufferData` gains a static RGBA32F table, uploaded once. A frame block is 3 texels per
  label (3x4 matrix) followed by one (D, lo, hi) texel per alpha label.
- The instance's second texel carries the frame block's start offset.
- `actor.vert.glsl` walks the vertex's influence list, blends the fetched matrices and poses the
  rest position, applies the alpha clamp, and pushes the triangle outside the clip volume when alpha <= 1 (all three corners share
  the face's alpha label). The existing pitch/yaw/world transform follows.
- Draw ranges become fixed per mesh; per frame only the instance texel changes.

### Phase 3: switch the loader and data model, delete the bake
- `ActorRenderData` becomes meshes plus matrix-table offsets. The player has one body mesh, a map
  of item meshes and one table keyed by seq; `bodyByStyle` goes away since only the seq ids were
  ever per style. Stance seq ids come from the game's static config instead of round-tripping
  through `getStanceSeqIds` and baked data.
- NPC width/height scale folds into the matrices because `NpcModelLoader` scales after posing.
  Gfx scale and the projectile tweaks (rotate180/scale/brighten) stay in the rest mesh because
  they happen before posing.
- Seq lookups throw on a missing seq instead of falling back to `idleAnim`; every seq an actor can
  play is known at load.
- Delete `addPlayer/Npc/SpotAnimAnimationFrames`, the `minFaceIndex` plumbing and actor use of
  `addModelAnimFrame`. `AnimationFrames` stays for map NPCs and locs.

### Phase 4: verify
Parity script, `tsc`, jest, then a visual check in the app.

## Skeletal, later (for a ToA encounter)
Probe of the ToA NPCs (Zebak, Akkha, Ba-Ba, Kephri, Wardens, the Apmeken/Crondis/Het/Scabaras
path bosses, baboons, scarabs):
- Every seq is pure skeletal: no old-style frames and no masks. Their models carry a single
  vertex label and pose entirely through bone weights.
- Up to 9 bone influences per vertex (Apmeken, Crondis), up to 6 on the Wardens with ~45% of
  vertices multi-influence; most others are at most 4. Weights always sum to 255, so they map
  straight onto the influence entry's 8-bit weight. A fixed 4-influence vertex would have to
  drop and renormalise weights on exactly the biggest bosses, which is why influences are lists.
- Up to 225 bones per skeleton (Kephri), well inside the 16-bit matrix index.
- Seq durations are 30-120 frames. Skeletal alpha is a single clamp-add per op per frame, so it
  uses the same (D, lo, hi) alpha rows.

What skeletal support then adds:
- A second table builder: per (skeleton, seq, frame), one matrix per bone from
  `SkeletalBase.updateAnimMatrices` / `getFinalMatrix`. The matrices do not depend on the model.
  `transformVertex`'s y/z negation folds into each matrix (`F * M * F`, `F = diag(1, -1, -1)`).
- Influence lists built from `animMayaGroups` / `animMayaScales` in the mesh builder.
- `AnimationState` advancing skeletal seqs by `getSkeletalDuration`.
- Where the bone matrices live. A static table costs bones x frames x 48 bytes per seq
  (Kephri: ~1.3 MB for one seq), which adds up across a boss roster. The alternative is to
  evaluate the curves each frame for visible skeletal instances and write their blocks into a
  per-frame region. The shader only sees a block offset, so this choice stays open without
  touching the format.

## Expected outcome
Bake time drops from seconds to near zero. The actor buffer holds rest meshes plus a few MB of
matrix tables instead of ~13 MB of posed copies. Any item mesh plays any body seq without a
re-bake, and adding a monster, gfx or seq costs one rest mesh plus a small table in the worker.
Frame interpolation and seq blending become possible later by mixing two frame blocks in the
shader.
