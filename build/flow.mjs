/**
 * flow.mjs — Perceptual measurement and sequencing engine.
 *
 * Works in CIELAB, not RGB. Orders photos so a collage reads as a
 * composition rather than a pile.
 */

// ── Colour science ──────────────────────────────────────────────────

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB is 8-bit, so linearisation has only 256 possible answers.
 * Precomputing them removes three pow() calls per pixel — measurement
 * now runs over every sampled pixel rather than a sparse grid.
 */
const LINEAR_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) LINEAR_LUT[i] = srgbToLinear(i);

/** sRGB → XYZ (D65) */
function rgbToXyz(r, g, b) {
  const lr = LINEAR_LUT[r], lg = LINEAR_LUT[g], lb = LINEAR_LUT[b];
  return [
    0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
    0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb,
    0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb,
  ];
}

/** D65 reference white */
const D65 = [0.95047, 1.0, 1.08883];

function labF(t) {
  return t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
}

/** XYZ → CIELAB */
function xyzToLab(x, y, z) {
  const fx = labF(x / D65[0]), fy = labF(y / D65[1]), fz = labF(z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** RGB pixel → Lab */
function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

// ── Measurement ─────────────────────────────────────────────────────

/**
 * Convert raw RGBA pixels to a Lab array, one entry per pixel.
 *
 * The previous version point-sampled every 4th pixel from an already
 * downscaled image — blurred by the resize, then aliased by the sampling,
 * which made `busy` largely a function of where the sample points happened
 * to land. Converting every pixel costs little (the LUT does the heavy
 * lifting) and gives a stable measurement.
 */
function toLab(pixels, w, h) {
  const n = w * h;
  const lab = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const [L, a, b] = rgbToLab(pixels[p], pixels[p + 1], pixels[p + 2]);
    const j = i * 3;
    lab[j] = L;
    lab[j + 1] = a;
    lab[j + 2] = b;
  }
  return lab;
}

/**
 * Compute Sobel gradient magnitude at each pixel.
 * Uses L* channel only. Returns Float64Array of length w*h.
 */
function gradientEnergy(lab, w, h) {
  const grad = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (i, j) => (i * w + j) * 3; // L* is at offset 0
      const gx =
        -lab[idx(y - 1, x - 1)] - 2 * lab[idx(y, x - 1)] - lab[idx(y + 1, x - 1)] +
        lab[idx(y - 1, x + 1)] + 2 * lab[idx(y, x + 1)] + lab[idx(y + 1, x + 1)];
      const gy =
        -lab[idx(y - 1, x - 1)] - 2 * lab[idx(y - 1, x)] - lab[idx(y - 1, x + 1)] +
        lab[idx(y + 1, x - 1)] + 2 * lab[idx(y + 1, x)] + lab[idx(y + 1, x + 1)];
      grad[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return grad;
}

/**
 * Hasler & Süsstrunk (2003) colourfulness metric.
 * Works on Lab a*, b* channels.
 */
function colourfulness(lab, n) {
  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    const a = lab[i * 3 + 1];
    const b = lab[i * 3 + 2];
    sumA += a; sumB += b;
    sumA2 += a * a; sumB2 += b * b;
  }
  const sigmaA = Math.sqrt(Math.max(0, sumA2 / n - (sumA / n) ** 2));
  const sigmaB = Math.sqrt(Math.max(0, sumB2 / n - (sumB / n) ** 2));
  const muA = sumA / n;
  const muB = sumB / n;
  return Math.sqrt(sigmaA ** 2 + sigmaB ** 2) + 0.3 * Math.sqrt(muA ** 2 + muB ** 2);
}

/**
 * Measure a single photo from its raw RGBA pixel data.
 *
 * `massX`/`massY` locate the centre of visual mass — where the detail in
 * the frame actually sits. Note that `weight` derived from it is *not*
 * face or subject detection: a bright sky gradient down one edge moves it
 * just as readily as an animal does. It is used only as a weak tiebreak.
 *
 * @param {Uint8Array} pixels — RGBA, length = w*h*4
 * @param {number} w — pixel width
 * @param {number} h — pixel height
 * @returns {object} measurements
 */
export function measurePhoto(pixels, w, h) {
  const lab = toLab(pixels, w, h);
  const n = w * h;

  // Mean L*, a*, b*
  let sumL = 0, sumA = 0, sumB = 0, sumL2 = 0;
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3];
    sumL += L;
    sumL2 += L * L;
    sumA += lab[i * 3 + 1];
    sumB += lab[i * 3 + 2];
  }
  const meanL = sumL / n;
  const contrast = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
  const meanA = sumA / n;
  const meanB = sumB / n;

  // Hue & chroma from mean a*, b*.
  // Averaging a*/b* across the whole frame cancels opposing hues, so a
  // half-red half-green frame reads as neutral. The chroma gate in
  // pairCost is what stops that ambiguity from driving the ordering.
  const chroma = Math.sqrt(meanA * meanA + meanB * meanB);
  const hue = (Math.atan2(meanB, meanA) * 180) / Math.PI;

  const cf = colourfulness(lab, n);

  // Gradient energy → busy. Measured at full sample resolution so fine
  // texture (grass, feathers, foliage) registers as detail rather than noise.
  const grad = gradientEnergy(lab, w, h);
  let sumGrad = 0;
  for (let i = 0; i < n; i++) sumGrad += grad[i];
  const busy = sumGrad / n;

  // Centre of visual mass, weighted by squared gradient magnitude
  let wmX = 0, wmY = 0, wmTotal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g2 = grad[y * w + x] ** 2;
      wmX += x * g2;
      wmY += y * g2;
      wmTotal += g2;
    }
  }
  const massX = wmTotal > 0 ? wmX / wmTotal / w : 0.5;
  const massY = wmTotal > 0 ? wmY / wmTotal / h : 0.5;
  const weight = massX < 0.42 ? 'left' : massX > 0.58 ? 'right' : 'centre';

  return {
    lightness: meanL,
    contrast,
    hue,
    chroma,
    colourfulness: cf,
    busy,
    busyRel: 0, // set later by normaliseAlbum
    massX,
    massY,
    weight,
  };
}

// ── Per-album normalisation ─────────────────────────────────────────

/** Circular standard deviation for hue angles (degrees). */
function circularStdev(angles) {
  let sumSin = 0, sumCos = 0;
  for (const a of angles) {
    const r = (a * Math.PI) / 180;
    sumSin += Math.sin(r);
    sumCos += Math.cos(r);
  }
  const n = angles.length;
  const R = Math.sqrt((sumSin / n) ** 2 + (sumCos / n) ** 2);
  return Math.sqrt(-2 * Math.log(Math.max(R, 1e-10))) * (180 / Math.PI);
}

function stdev(values) {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
}

/**
 * Rank-normalise busy values within the album → busyRel [0, 1].
 * Compute adaptive scales for cost function.
 */
export function normaliseAlbum(photos) {
  if (photos.length < 2) return { tone: 45, hue: 45, chroma: 20 };

  // busyRel — rank normalised
  const sorted = [...photos].sort((a, b) => a.busy - b.busy);
  sorted.forEach((p, i) => {
    p.busyRel = photos.length > 1 ? i / (photos.length - 1) : 0;
  });

  // Adaptive scales: 2× stdev with floors
  const toneScale = Math.max(2 * stdev(photos.map((p) => p.lightness)), 8);
  const hueScale = Math.max(2 * circularStdev(photos.map((p) => p.hue)), 10);
  const chromaScale = Math.max(2 * stdev(photos.map((p) => p.chroma)), 4);

  return { tone: toneScale, hue: hueScale, chroma: chromaScale };
}

// ── Cost function ───────────────────────────────────────────────────

/** Shortest angular distance in degrees. */
function hueDist(h1, h2) {
  let d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

function openness(p) {
  return (p.ar / 2.4) * 0.6 + (1 - p.busyRel) * 0.4;
}

export function pairCost(a, b, scales) {
  const tone = Math.min(Math.abs(a.lightness - b.lightness) / scales.tone, 1) ** 2;
  const chromaGate = Math.min(a.chroma, b.chroma) / 22;
  const hue =
    Math.min(hueDist(a.hue, b.hue) / scales.hue, 1) ** 2 * chromaGate;
  const busy = a.busyRel * b.busyRel;
  const chroma = Math.min(Math.abs(a.chroma - b.chroma) / scales.chroma, 1);
  const arc = Math.max(0, openness(b) - openness(a));

  return 1.0 * tone + 0.65 * hue + 0.8 * busy + 0.35 * chroma + 0.3 * arc;
}

/** Total chain cost for an ordering. */
function chainCost(order, scales) {
  let c = 0;
  for (let i = 0; i < order.length - 1; i++) {
    c += pairCost(order[i], order[i + 1], scales);
  }
  return c;
}

// ── Solver ───────────────────────────────────────────────────────────

/** Mean |ΔL*| along a chain — the metric we print. */
export function meanTonalStep(order) {
  if (order.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < order.length - 1; i++) {
    sum += Math.abs(order[i].lightness - order[i + 1].lightness);
  }
  return sum / (order.length - 1);
}

/** Greedy nearest-neighbour from a given start index. */
function greedyFrom(photos, startIdx, scales) {
  const remaining = new Set(photos.map((_, i) => i));
  const order = [photos[startIdx]];
  remaining.delete(startIdx);
  while (remaining.size > 0) {
    let bestIdx = -1, bestCost = Infinity;
    const last = order[order.length - 1];
    for (const i of remaining) {
      const c = pairCost(last, photos[i], scales);
      if (c < bestCost) { bestCost = c; bestIdx = i; }
    }
    order.push(photos[bestIdx]);
    remaining.delete(bestIdx);
  }
  return order;
}

/**
 * 2-opt improvement.
 *
 * pairCost is *asymmetric* — the `arc` term charges only for steps that open
 * up, so cost(a,b) ≠ cost(b,a). That means reversing a segment re-prices every
 * edge inside it, not just the two at the boundary. Costing only the boundary
 * (the textbook symmetric-TSP shortcut) lets 2-opt accept moves that make the
 * chain worse, so the interior is priced in both directions here.
 */
function twoOpt(order, scales) {
  const maxPasses = 12;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;

    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        let oldCost = 0, newCost = 0;

        // Leading boundary edge
        if (i > 0) {
          oldCost += pairCost(order[i - 1], order[i], scales);
          newCost += pairCost(order[i - 1], order[j], scales);
        }
        // Trailing boundary edge
        if (j < order.length - 1) {
          oldCost += pairCost(order[j], order[j + 1], scales);
          newCost += pairCost(order[i], order[j + 1], scales);
        }
        // Interior, priced forward and reversed
        for (let k = i; k < j; k++) {
          oldCost += pairCost(order[k], order[k + 1], scales);
          newCost += pairCost(order[k + 1], order[k], scales);
        }

        if (newCost < oldCost - 1e-10) {
          const segment = order.splice(i, j - i + 1);
          segment.reverse();
          order.splice(i, 0, ...segment);
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  return order;
}

// ── Grid refinement ─────────────────────────────────────────────────

const REF_WIDTHS = [1248, 980, 720, 390];
const REF_WEIGHTS = [1, 0.8, 0.7, 0.9];

/**
 * Simulate row layout at a given container width.
 * Returns array of rows, each row an array of indices into `order`.
 */
function simulateRows(order, containerWidth) {
  const targetHeight = Math.max(150, Math.min(containerWidth / 3.1, 420));
  const spacing = containerWidth > 800 ? 10 : 6;
  const rows = [];
  let row = [];
  let rowAr = 0;

  for (let i = 0; i < order.length; i++) {
    row.push(i);
    rowAr += order[i].ar;
    const rowWidth = rowAr * targetHeight + (row.length - 1) * spacing;
    if (rowWidth >= containerWidth && row.length > 0) {
      rows.push([...row]);
      row = [];
      rowAr = 0;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * Score an ordering against actual row layouts.
 * Lower is better.
 */
function gridScore(order, scales) {
  let totalScore = 0;

  for (let w = 0; w < REF_WIDTHS.length; w++) {
    const rows = simulateRows(order, REF_WIDTHS[w]);
    let score = 0;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];

      // Horizontal neighbour cost (full weight)
      for (let i = 0; i < row.length - 1; i++) {
        score += pairCost(order[row[i]], order[row[i + 1]], scales);
      }

      // Vertical neighbour cost (0.25 × overlap fraction)
      if (r > 0) {
        const prevRow = rows[r - 1];
        // Approximate overlap: any items in adjacent rows that share column space
        const overlap = Math.min(row.length, prevRow.length) / Math.max(row.length, prevRow.length);
        for (let i = 0; i < Math.min(row.length, prevRow.length); i++) {
          score += 0.25 * overlap * pairCost(order[row[i]], order[prevRow[i]], scales);
        }
      }

      // Row balance: penalise rows where busyness pools
      const rowBusy = row.reduce((s, i) => s + order[i].busyRel, 0) / row.length;
      score += 0.15 * rowBusy * rowBusy;

      // Pull visual mass toward the middle of the row: a frame whose detail
      // sits hard against the outer edge of the spread leads the eye off it.
      if (row.length > 1) {
        if (order[row[0]].weight === 'left') score += 0.1;
        if (order[row[row.length - 1]].weight === 'right') score += 0.1;
      }
    }

    totalScore += score * REF_WEIGHTS[w];
  }

  return totalScore;
}

/**
 * Local search: try swap and relocate moves, keep improvements.
 * Capped to 3 passes or 10 seconds to stay practical on large albums.
 */
function gridRefinement(order, scales) {
  let bestScore = gridScore(order, scales);
  const maxPasses = 3;
  const deadline = Date.now() + 10_000;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    if (Date.now() > deadline) break;

    // Swap moves — for large albums, only try nearby swaps
    const maxDist = order.length > 40 ? 15 : order.length;
    for (let i = 0; i < order.length - 1 && Date.now() < deadline; i++) {
      const jEnd = Math.min(i + maxDist, order.length);
      for (let j = i + 1; j < jEnd; j++) {
        [order[i], order[j]] = [order[j], order[i]];
        const s = gridScore(order, scales);
        if (s < bestScore - 1e-10) {
          bestScore = s;
          improved = true;
        } else {
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
    }

    // Relocate moves — try moving each photo to nearby positions
    for (let i = 0; i < order.length && Date.now() < deadline; i++) {
      const photo = order[i];
      order.splice(i, 1);
      const lo = Math.max(0, i - maxDist);
      const hi = Math.min(order.length, i + maxDist);
      let found = false;
      for (let j = lo; j <= hi; j++) {
        if (j === i) continue;
        order.splice(j, 0, photo);
        const s = gridScore(order, scales);
        if (s < bestScore - 1e-10) {
          bestScore = s;
          improved = true;
          found = true;
          break;
        }
        order.splice(j, 1);
      }
      if (!found) {
        order.splice(i, 0, photo);
      }
    }

    if (!improved) break;
  }

  return order;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Sequence an album's photos for optimal visual flow.
 * Mutates the busyRel field on each photo.
 * @param {object[]} photos — each must have measurements from measurePhoto + ar
 * @returns {object[]} ordered photos
 */
export function sequenceAlbum(photos, scales = normaliseAlbum(photos)) {
  if (photos.length < 3) return photos;

  // Greedy nearest-neighbour — try all starts for small albums,
  // sample sqrt(n)*3 evenly-spaced starts for large ones
  const n = photos.length;
  const maxStarts = n <= 30 ? n : Math.min(n, Math.ceil(Math.sqrt(n) * 3));
  const step = n / maxStarts;
  let bestOrder = null, bestCost = Infinity;
  for (let s = 0; s < maxStarts; s++) {
    const i = Math.floor(s * step);
    const order = greedyFrom(photos, i, scales);
    const cost = chainCost(order, scales);
    if (cost < bestCost) { bestCost = cost; bestOrder = order; }
  }

  // 2-opt
  bestOrder = twoOpt(bestOrder, scales);

  // Reverse if other end is more open (establishing shot first)
  if (openness(bestOrder[bestOrder.length - 1]) > openness(bestOrder[0])) {
    bestOrder.reverse();
  }

  // Grid refinement (capped passes for large albums)
  bestOrder = gridRefinement(bestOrder, scales);

  return bestOrder;
}

/**
 * Pick the best cover photo for an album.
 *
 * Base score favours a wide, contrasty, uncluttered, mid-toned frame:
 *   ar×0.5 + contrast/30 − busyRel×0.5 − |L*−52|/40
 *
 * Where the album carries a genuine star-rating spread, those stars are a
 * human judgement about which frames are strongest, and no measured proxy
 * should be able to overrule one. So ratings act as a filter rather than
 * another weighted term: the cover is chosen from the top-rated frames, and
 * the base score only breaks the tie among them.
 *
 * Albums rated uniformly — all five stars, or none at all — carry no signal,
 * and every frame stays in contention.
 */
export function pickCover(photos) {
  if (photos.length === 0) return undefined;

  const ratings = photos.map((p) => p.rating).filter((r) => typeof r === 'number');
  const allRated = ratings.length === photos.length;
  const top = allRated ? Math.max(...ratings) : null;
  const hasSpread = allRated && top > Math.min(...ratings);

  const candidates = hasSpread ? photos.filter((p) => p.rating === top) : photos;

  let best = candidates[0], bestScore = -Infinity;
  for (const p of candidates) {
    const score =
      p.ar * 0.5 + p.contrast / 30 - p.busyRel * 0.5 - Math.abs(p.lightness - 52) / 40;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * When two photos sit side by side, pull their visual mass toward each other
 * rather than off the outer edges of the spread.
 *
 * gridRefinement already scores this in the context of real rows, so this pass
 * is a light finishing touch, not the main mechanism. It is guarded: a swap is
 * only kept when it doesn't raise the chain cost, because trading a settled
 * tonal transition for a weak mass-placement signal is a bad bargain. It is
 * never applied to a pinned album — an explicit order is an instruction.
 */
export function applyGazePairing(photos, scales) {
  if (!scales || photos.length < 2) return photos;

  for (let i = 0; i < photos.length - 1; i++) {
    if (photos[i].weight !== 'left' || photos[i + 1].weight !== 'right') continue;

    const before =
      (i > 0 ? pairCost(photos[i - 1], photos[i], scales) : 0) +
      pairCost(photos[i], photos[i + 1], scales) +
      (i + 2 < photos.length ? pairCost(photos[i + 1], photos[i + 2], scales) : 0);

    const after =
      (i > 0 ? pairCost(photos[i - 1], photos[i + 1], scales) : 0) +
      pairCost(photos[i + 1], photos[i], scales) +
      (i + 2 < photos.length ? pairCost(photos[i], photos[i + 2], scales) : 0);

    // 0.2 is the mass penalty this swap removes from gridScore (0.1 per edge);
    // accept the swap only if the tonal chain doesn't pay more than that for it.
    if (after <= before + 0.2) {
      [photos[i], photos[i + 1]] = [photos[i + 1], photos[i]];
    }
  }
  return photos;
}
