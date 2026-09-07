# GPU skinning for actors (idea, not started)

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
matrix per vertex group, computable once on the CPU. Note: old-style origins depend on the model's
own vertex positions, so palettes are per (model, frame), not per frame alone.

## Plan
1. Actor vertex format gains a group index (the 12-byte terrain packing has no spare bits; the
   actor buffer is separate so it can widen without touching terrain).
2. At load, compute the matrix palette for every (model, sequence, frame) once and pack it into a
   float texture; instance data carries a palette row offset instead of a baked index range.
3. `actor.vert.glsl` fetches the group matrix and poses the rest mesh. Attachments (items) share
   the body's palette, so equipment stays "extra instances".
4. Lighting: either keep rest-pose lighting (usual game practice, fine in this art style) or add
   packed normals and light in the shader.
5. Keep the baked path behind a flag until poses match frame-for-frame against the CPU
   `Model.animate` result (compare vertex positions in a script, same seq/frame).

## Expected outcome
Bake time ~0, actor buffer = rest meshes only, per-frame cost moves to the GPU, blending and
arbitrary equipment combos become possible. Risk: subtle pose mismatches with origin-type ops and
with alpha/priority face ordering, which the bake currently resolves per frame.
