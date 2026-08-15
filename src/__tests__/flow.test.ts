/// <reference types="vitest/globals" />
import {
  measurePhoto,
  normaliseAlbum,
  sequenceAlbum,
  pairCost,
  pickCover,
  applyGazePairing,
  meanTonalStep,
} from '../../build/flow.mjs';

/** Deterministic pseudo-random so failures are reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeAlbum(n: number, seed = 7) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    lightness: r() * 100,
    contrast: 10 + r() * 30,
    hue: r() * 360 - 180,
    chroma: r() * 40,
    colourfulness: r() * 60,
    busy: r(),
    busyRel: 0,
    massX: r(),
    massY: r(),
    weight: (['left', 'right', 'centre'] as const)[Math.floor(r() * 3)],
    ar: 0.6 + r() * 2,
  }));
}

function chainCost(order: any[], scales: any) {
  let c = 0;
  for (let i = 0; i < order.length - 1; i++) c += pairCost(order[i], order[i + 1], scales);
  return c;
}

describe('pairCost', () => {
  const scales = { tone: 20, hue: 40, chroma: 12 };
  const base = {
    lightness: 50, hue: 0, chroma: 30, busyRel: 0.5, ar: 1.5, contrast: 20,
  };

  it('charges more for a bigger tonal jump', () => {
    const near = pairCost(base, { ...base, lightness: 55 }, scales);
    const far = pairCost(base, { ...base, lightness: 90 }, scales);
    expect(far).toBeGreaterThan(near);
  });

  it('does not penalise hue difference between two near-neutral frames', () => {
    const grey = { ...base, chroma: 0 };
    const opposed = pairCost(grey, { ...grey, hue: 180 }, scales);
    const aligned = pairCost(grey, { ...grey, hue: 0 }, scales);
    expect(opposed).toBeCloseTo(aligned, 10);
  });

  it('penalises two busy frames side by side but not busy next to calm', () => {
    const busyPair = pairCost({ ...base, busyRel: 1 }, { ...base, busyRel: 1 }, scales);
    const mixed = pairCost({ ...base, busyRel: 1 }, { ...base, busyRel: 0 }, scales);
    expect(busyPair).toBeGreaterThan(mixed);
  });

  it('is asymmetric — opening up costs more than closing down', () => {
    const open = { ...base, ar: 2.4, busyRel: 0 };
    const tight = { ...base, ar: 0.7, busyRel: 1 };
    expect(pairCost(tight, open, scales)).toBeGreaterThan(pairCost(open, tight, scales));
  });
});

describe('sequenceAlbum', () => {
  it('never returns a chain worse than the input order', () => {
    // The asymmetric arc term means a 2-opt that only prices the boundary
    // edges can accept a move that raises total cost. This is the regression
    // guard for that: optimisation must not make the sequence worse.
    for (const seed of [1, 2, 3, 11, 42]) {
      const photos = makeAlbum(18, seed);
      const scales = normaliseAlbum(photos);
      const before = chainCost(photos, scales);
      const after = chainCost(sequenceAlbum([...photos], scales), scales);
      expect(after).toBeLessThanOrEqual(before + 1e-9);
    }
  });

  it('lowers the mean tonal step of a shuffled album', () => {
    const photos = makeAlbum(24, 5);
    normaliseAlbum(photos);
    const before = meanTonalStep(photos);
    const after = meanTonalStep(sequenceAlbum([...photos]));
    expect(after).toBeLessThan(before);
  });

  it('returns every photo exactly once', () => {
    const photos = makeAlbum(20, 9);
    const ordered = sequenceAlbum([...photos]);
    expect(ordered.length).toBe(photos.length);
    expect(new Set(ordered.map((p: any) => p.id)).size).toBe(photos.length);
  });

  it('leaves albums too small to sequence alone', () => {
    const photos = makeAlbum(2, 3);
    expect(sequenceAlbum(photos)).toEqual(photos);
  });
});

describe('normaliseAlbum', () => {
  it('rank-normalises busy into [0, 1]', () => {
    const photos = makeAlbum(10, 4);
    normaliseAlbum(photos);
    const rels = photos.map((p) => p.busyRel).sort((a, b) => a - b);
    expect(rels[0]).toBe(0);
    expect(rels[rels.length - 1]).toBe(1);
  });

  it('holds scales above their floors for a uniform album', () => {
    const flat = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`, lightness: 50, hue: 0, chroma: 20, busy: 0.5, busyRel: 0, ar: 1.5,
    }));
    const scales = normaliseAlbum(flat);
    expect(scales.tone).toBeGreaterThanOrEqual(8);
    expect(scales.hue).toBeGreaterThanOrEqual(10);
    expect(scales.chroma).toBeGreaterThanOrEqual(4);
  });
});

describe('applyGazePairing', () => {
  it('is a no-op without scales, so a pinned order is never disturbed', () => {
    const photos = makeAlbum(8, 6);
    const ids = photos.map((p) => p.id);
    applyGazePairing(photos, undefined);
    expect(photos.map((p) => p.id)).toEqual(ids);
  });

  it('does not trade away a large chain-cost improvement for mass placement', () => {
    const scales = { tone: 20, hue: 40, chroma: 12 };
    // Two frames whose swap would wreck a tonal transition
    const photos = [
      { id: 'a', lightness: 10, hue: 0, chroma: 5, busyRel: 0.2, ar: 1.5, weight: 'left' },
      { id: 'b', lightness: 90, hue: 0, chroma: 5, busyRel: 0.2, ar: 1.5, weight: 'right' },
      { id: 'c', lightness: 92, hue: 0, chroma: 5, busyRel: 0.2, ar: 1.5, weight: 'centre' },
    ];
    applyGazePairing(photos as any, scales);
    expect(photos.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('pickCover', () => {
  it('uses star ratings when the album carries a real spread', () => {
    const photos = makeAlbum(12, 8).map((p, i) => ({ ...p, rating: i === 3 ? 5 : 1 }));
    normaliseAlbum(photos);
    expect(pickCover(photos).id).toBe('p3');
  });

  it('ignores ratings when every frame is rated the same', () => {
    const photos = makeAlbum(12, 8).map((p) => ({ ...p, rating: 5 }));
    normaliseAlbum(photos);
    const unrated = makeAlbum(12, 8);
    normaliseAlbum(unrated);
    expect(pickCover(photos).id).toBe(pickCover(unrated).id);
  });
});

describe('measurePhoto', () => {
  /** Build an RGBA buffer from a per-pixel colour function. */
  function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
    const buf = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = fn(x, y);
        const i = (y * w + x) * 4;
        buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
      }
    }
    return buf;
  }

  it('reads a flat mid-grey as mid lightness, no chroma, no detail', () => {
    const m = measurePhoto(image(32, 32, () => [128, 128, 128]), 32, 32);
    expect(m.lightness).toBeGreaterThan(45);
    expect(m.lightness).toBeLessThan(60);
    expect(m.chroma).toBeLessThan(1);
    expect(m.busy).toBeLessThan(0.01);
    expect(m.contrast).toBeLessThan(0.01);
  });

  it('scores a detailed frame as busier than a smooth gradient', () => {
    // Note: a one-pixel checkerboard is invisible to a Sobel kernel — the
    // columns it differences have the same parity, so they cancel exactly.
    // Detail has to sit below Nyquist to register, hence period-4 stripes.
    const smooth = measurePhoto(image(48, 48, (x) => [x * 4, x * 4, x * 4]), 48, 48);
    const detailed = measurePhoto(
      image(48, 48, (x) => (x % 4 < 2 ? [255, 255, 255] : [0, 0, 0])),
      48, 48,
    );
    expect(detailed.busy).toBeGreaterThan(smooth.busy);
  });

  it('locates visual mass on the side that carries the detail', () => {
    const leftDetail = measurePhoto(
      image(48, 48, (x) => (x < 22 && x % 4 < 2 ? [255, 255, 255] : [40, 40, 40])),
      48, 48,
    );
    expect(leftDetail.massX).toBeLessThan(0.42);
    expect(leftDetail.weight).toBe('left');
  });

  it('is stable under a small shift — not an artefact of sample points', () => {
    // The old implementation point-sampled a sparse grid, so shifting the
    // image by one pixel could swing `busy` substantially.
    const a = measurePhoto(image(64, 64, (x, y) => [(x * 7 + y * 3) % 256, 90, 140]), 64, 64);
    const b = measurePhoto(image(64, 64, (x, y) => [((x + 1) * 7 + y * 3) % 256, 90, 140]), 64, 64);
    expect(Math.abs(a.busy - b.busy) / a.busy).toBeLessThan(0.05);
  });
});
