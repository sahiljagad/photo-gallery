# How the photographs get ordered

`build/flow.mjs` decides the order photographs appear in within an album. It
treats the album as a **shortest-path problem in perceptual space**: every
frame is a point, the "distance" between two frames is how jarring it is to
see one after the other, and the sequence is a cheap walk through all of them.

Nothing here looks at subject matter. It has no idea a photograph contains a
lion. It measures colour, tone and detail, and arranges frames so the eye
moves through the page without being knocked sideways.

---

## 1. Measure

`measurePhoto()` takes each photograph scaled to fit inside 288×288 and
converts every pixel to [CIELAB](https://en.wikipedia.org/wiki/CIELAB_color_space).
Lab is used rather than RGB because equal numeric distances in Lab correspond
roughly to equal *perceived* differences — which is the whole point when the
goal is a sequence that feels smooth.

Nine numbers come out:

| Field | What it is |
|---|---|
| `lightness` | mean L\* — how bright the frame is overall |
| `contrast` | standard deviation of L\* — how much tonal range it holds |
| `hue`, `chroma` | mean a\*/b\* read as an angle and a distance |
| `colourfulness` | [Hasler & Süsstrunk (2003)](https://infoscience.epfl.ch/record/33994) metric |
| `busy` | mean Sobel gradient magnitude on L\* — how much detail |
| `massX`, `massY` | centre of visual mass, weighted by squared gradient |
| `weight` | `massX` bucketed to `left` / `centre` / `right` |

Two honest caveats about these numbers:

- **`hue` averages across the whole frame**, so a half-red half-green picture
  averages out to neutral. The chroma gate in step 3 is what keeps that
  ambiguity from steering the ordering.
- **`weight` is not subject detection.** It is where the *detail* sits. A
  bright sky gradient down one edge moves it just as readily as an animal
  does, which is why it carries very little influence.

## 2. Normalise, per album

`normaliseAlbum()` calibrates the cost function to the album it is actually
looking at, rather than to fixed thresholds:

- `busy` becomes `busyRel`, a **rank** in `[0, 1]`. Rank rather than raw value,
  so an album of uniformly dense frames still separates into calmer and busier
  halves.
- The tone, hue and chroma scales are set to **2× the album's own standard
  deviation** (circular standard deviation for hue), with floors so a very
  uniform album doesn't produce absurdly tight scales.

A set of misty landscapes and a set of high-contrast wildlife frames therefore
get judged on their own terms.

## 3. Price a pair

`pairCost(a, b)` is what everything else optimises. Five weighted terms:

| Term | Weight | Shape | Why |
|---|---|---|---|
| tone | 1.0 | `(ΔL*/scale)²` | squared, so one big tonal jump costs more than several small ones |
| hue | 0.65 | `(Δhue/scale)² × chromaGate` | gated by `min(chroma)/22` — near-neutral frames aren't charged for hue |
| busy | 0.8 | `busyRel_a × busyRel_b` | a product, so two dense frames adjacent is expensive but dense-next-to-calm is free |
| chroma | 0.35 | `abs(Δchroma)/scale` | linear; saturation shifts matter less than tonal ones |
| arc | 0.3 | `max(0, open(b) − open(a))` | **asymmetric** — charged only when the sequence opens up |

where `openness = 0.6·(ar/2.4) + 0.4·(1 − busyRel)`.

That last term is the one with an opinion. It costs nothing to move from an
open frame to a tighter one, but it costs something to move the other way — so
the sequence naturally establishes wide and then closes in, the way a picture
edit usually wants to run.

**The asymmetry matters for the solver.** `cost(a, b) ≠ cost(b, a)`, which
rules out several standard shortcuts (see step 4).

## 4. Solve

`sequenceAlbum()`:

1. **Greedy nearest-neighbour** from many different starting frames — every
   frame for albums of 30 or fewer, about `3√n` evenly spaced starts beyond
   that. Keep the cheapest chain found.
2. **2-opt**: repeatedly try reversing each sub-segment, keep reversals that
   lower the total. Runs to convergence, capped at 12 passes.
3. **Flip the whole chain** if the far end is more open than the near end, so
   the album opens on its establishing shot.

> **A bug that lived here.** The textbook 2-opt only re-prices the two edges at
> the boundary of the reversed segment, because in a symmetric problem the
> interior edges keep their cost when flipped. With the asymmetric `arc` term
> they don't — reversing a segment re-prices *every* edge inside it. The old
> implementation used the symmetric shortcut and so could accept reversals that
> made the chain worse. It now prices the interior in both directions.
> `src/__tests__/flow.test.ts` guards this: optimisation must never return a
> chain worse than its input.

## 5. Refine against the actual grid

A chain is a line; the page is justified rows. `gridRefinement()` closes that
gap by **simulating the real layout** at four reference widths — 1248, 980, 720
and 390px, weighted 1 / 0.8 / 0.7 / 0.9 — using the same row-height and spacing
formulas the frontend uses in `AlbumView.tsx`. If those formulas change, this
should change with them.

Each simulated layout is scored on:

- horizontal neighbours, at full `pairCost`
- vertical neighbours (the frame above, same column index), at `0.25 ×` overlap
- **row balance** — `0.15 × meanBusy²`, penalising rows where all the dense
  frames pool together
- **edge mass** — `0.1` if a row's first frame carries its detail hard left, or
  its last frame hard right, either of which leads the eye off the spread

Then swap and relocate moves, keeping improvements. Capped at 3 passes and 10
seconds, with a 15-position window on albums over 40 frames, because the search
is quadratic in the number of frames and would otherwise dominate the build.

## 6. Finish

- `applyGazePairing()` pulls the visual mass of adjacent pairs inward. It is
  **guarded** — a swap is kept only when it doesn't raise the chain cost by
  more than the 0.2 it saves in edge-mass penalty. Previously it swapped
  blindly *after* refinement, undoing tonal work it had just paid ten seconds
  for. It is never applied to a pinned album.
- `pickCover()` chooses the album's cover independently of sequence position:
  wide, contrasty, uncluttered and mid-toned. **Where the album carries a real
  star-rating spread in its XMP, that acts as a filter** — the cover is chosen
  from the top-rated frames only, because a human judgement about which frames
  are strongest should not be overruled by a proxy. Albums rated uniformly (all
  five stars, or unrated) carry no signal and every frame stays in contention.

---

## When sequencing is skipped

Two cases, and only two:

- **Fewer than 3 photographs.** Nothing to sequence.
- **Every file carries an explicit `NN_` prefix** (`01_opener.jpg`,
  `02_next.jpg`). That is a deliberate instruction and is followed exactly.

> **A second bug that lived here.** Pinning used to also trigger on trailing
> export numbers — `glacier-066.jpg`, `portugal-01.jpg`. Those numbers come from
> Lightroom, not from a decision, and treating them as an instruction silently
> disabled sequencing for **255 of 454 photographs** across three albums. Only
> the `NN_` prefix pins now; trailing numbers are kept purely as a tiebreak.

Where no pin applies, the starting point is **capture order** from EXIF
`DateTimeOriginal`, which also settles any tie the cost function cannot.

## Reading the build output

```
📁 Glacier National Park (2025-07-06)
  120 images
  Date from EXIF: 2025-07-06 → 2025-07-02 (through 2025-07-04)
  Sequenced: tonal step 8.1 → 2.6 L*
```

`tonal step` is the mean `abs(ΔL*)` between neighbours, before and after. Lower
means smoother. It is a proxy for one term out of five, not a score for the
whole ordering — but it is the one that is easy to read, and if it goes *up*
something is wrong.

Current results across the archive:

| Album | Before | After |
|---|--:|--:|
| Portugal | 15.5 | 3.9 |
| Kenya 2026 | 6.9 | 3.2 |
| Glacier National Park | 8.1 | 2.6 |
| Sedona | 9.0 | 4.5 |
| Central India | 9.1 | 3.2 |
| Yellowstone | 12.8 | 5.7 |
| Kenya 2018 | 10.0 | 7.7 |

## Tuning it

The weights in `pairCost()` are the main dial. Raising the `busy` weight
spreads dense frames further apart; raising `arc` makes the open-to-tight
progression more insistent; dropping `hue` to zero orders almost purely on
tone. Rebuild with `npm run photos` and read the tonal step, but trust your
eye over the number — it only describes one of the five terms.
