# Understanding this codebase

A running checklist. We work through it in order; nothing gets ticked until you
have explained it back in your own words or answered questions on it correctly.

**Legend** — `[ ]` not yet · `[~]` partly there · `[x]` demonstrated

---

## Module 1 — The problem

Understanding this well is the whole game. Every design decision downstream is
only justifiable in terms of a problem, so if the problem is fuzzy the solution
is unarguable.

- [x] **1.1** What actually failed at deploy, and the specific number that caused it
- [ ] **1.2** Why git is a bad store for changing binaries — append-only, history forever
- [x] **1.3** Why the GitHub Pages 1 GB cap is a real wall and not a suggestion
- [x] **1.4** The fail-open glob: how one default causes three separate problems
      — *capacity vs intent; capacity never produces intent*
- [x] **1.5** The Portugal 55→106 incident — the build reads the filesystem, never git
- [ ] **1.6** Why star ratings cannot solve curation here (evidence, not opinion)
- [ ] **1.7** The core tension: curating on the web requires the uncurated pool to be online

## Module 2 — Primitives you need before the solution makes sense

You cannot evaluate whether R2 is the right answer without knowing what class of
thing it is. This module is vocabulary with teeth.

- [ ] **2.1** Object storage vs a filesystem vs a database — what each is *for*
- [ ] **2.2** What R2 is; how it differs from S3; what "S3-compatible" buys you
- [ ] **2.3** Egress, and why it dominates the cost of image hosting specifically
- [ ] **2.4** CDN and edge caching — cache keys, TTL, invalidation, why purging images is a smell
- [ ] **2.5** Content addressing — hashing bytes into a filename, and the three things it buys
- [ ] **2.6** Edge compute (Workers) — what code runs where, and why `flow.mjs` qualifies
- [ ] **2.7** D1 / SQLite at the edge — why a database at all, given 7 albums
- [ ] **2.8** SSO, JWT, and why writing your own login is the risky choice

## Module 3 — The proposed architecture

- [ ] **3.1** Two gates — why two, and what each one is actually protecting
- [ ] **3.2** Ingest flow end to end, including what happens to an unticked frame
- [ ] **3.3** Publish flow end to end, including why no pixels move
- [ ] **3.4** Read paths — why the privacy boundary sits below the application
- [ ] **3.5** Why the sequence is stored, not computed on read (determinism argument)
- [ ] **3.6** The rejected alternatives, and the specific reason each was rejected

## Module 4 — The code already shipped

Eight commits are merged into `main`. This is the walkthrough.

- [ ] **4.1** `flow.mjs` — what gets measured, and why CIELAB rather than RGB
- [ ] **4.2** The cost function — each term, its weight, and what it is preventing
- [ ] **4.3** Why the `arc` term is asymmetric, and what that breaks
- [ ] **4.4** The 2-opt bug — why boundary-only costing is valid for TSP but not here
- [ ] **4.5** The measurement aliasing fix — blurred *and* aliased, and why the LUT matters
- [ ] **4.6** `gridRefinement` — why a chain is the wrong model for a justified grid
- [ ] **4.7** `exif.mjs` — walking a TIFF by hand, and why no dependency
- [ ] **4.8** The pinning regex bug — 255 photos silently skipping the algorithm
- [ ] **4.9** The album-date bug — mtime vs `DateTimeOriginal`
- [ ] **4.10** The `new Date('2025-01-01')` timezone trap
- [ ] **4.11** The test that was passing vacuously, and how to spot that class of bug
- [ ] **4.12** Frontend — hash routing, SEO for a client-rendered page, the a11y work

## Module 5 — Why it matters

- [ ] **5.1** What changes for you operationally, day to day
- [ ] **5.2** What this architecture makes easy later, and what it makes hard
- [ ] **5.3** What will break first as the archive grows, and the signal to watch for
- [ ] **5.4** Which decisions are cheap to reverse and which are one-way doors

---

## Progress log

| Covered | Result |
|---|---|
| Module 1 — the problem | Solid. *Capacity vs intent; capacity never produces intent.* The build reads the filesystem, never git. |
| Area A — photo pipeline | 3/4. Derivatives, LQIP-as-data-URI, raw measurement all correct. Missed: freshness is **mtime**, not content hash. |
| Area B — the algorithm | 5/7. Cost-function shapes, per-album scales, arc asymmetry, grid model, breakpoint weights correct. Missed: `chromaGate` guards **grey**, not saturated; the 2-opt bug is **asymmetry**, not path-vs-cycle. |

### Re-test these later
- Freshness check: mtime comparison, and the two ways mtime lies
- `chromaGate` — low chroma makes hue meaningless (`atan2` of noise)
- 2-opt — symmetry is the load-bearing assumption, not closure
