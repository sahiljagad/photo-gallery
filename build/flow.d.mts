/**
 * Types for the sequencing engine, so the frontend test suite can exercise it
 * directly. The implementation lives in flow.mjs and stays plain JavaScript —
 * it runs under bare node during the photo build, with no compile step.
 */

/** The measured signature of a single frame. */
export interface Measurements {
  lightness: number;
  contrast: number;
  hue: number;
  chroma: number;
  colourfulness: number;
  busy: number;
  busyRel: number;
  massX: number;
  massY: number;
  weight: 'left' | 'right' | 'centre';
}

/** Anything the cost function can price: measurements plus aspect ratio. */
export interface Frame extends Partial<Measurements> {
  ar: number;
  [key: string]: unknown;
}

/** Per-album scaling, so the cost function calibrates to this album's spread. */
export interface Scales {
  tone: number;
  hue: number;
  chroma: number;
}

export function measurePhoto(
  pixels: Uint8Array,
  width: number,
  height: number,
): Measurements;

export function normaliseAlbum(photos: Frame[]): Scales;

export function pairCost(a: Frame, b: Frame, scales: Scales): number;

export function sequenceAlbum<T extends Frame>(photos: T[], scales?: Scales): T[];

export function pickCover<T extends Frame>(photos: T[]): T;

export function applyGazePairing<T extends Frame>(photos: T[], scales?: Scales): T[];

export function meanTonalStep(order: Frame[]): number;
