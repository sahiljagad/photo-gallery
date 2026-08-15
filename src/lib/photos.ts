import type { Album, Photo } from '../types';

const base = import.meta.env.BASE_URL;

export function imgUrl(path: string): string {
  return `${base}${path}`;
}

// ── Formatting ──────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `2025-07-02` → `2 July 2025`. Parsed by hand: `new Date` would shift the day into the viewer's timezone. */
export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${parseInt(d, 10)} ${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
}

/** `2025-07-02` → `July 2025`. */
export function formatMonth(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/** A date range collapsed to the shortest honest form. */
export function formatRange(start: string, end?: string): string {
  if (!end || end === start) return formatDate(start);
  const [sy, sm] = start.split('-');
  const [ey, em] = end.split('-');
  if (sy === ey && sm === em) {
    return `${parseInt(start.slice(8), 10)}–${parseInt(end.slice(8), 10)} ${MONTHS[parseInt(sm, 10) - 1]} ${sy}`;
  }
  if (sy === ey) return `${formatDate(start).replace(` ${sy}`, '')} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** `500mm · f/5.6 · 1/200 · ISO 1000` — the exposure half of an exhibition label. */
export function exposureLine(photo: Photo): string {
  const s = photo.shot;
  if (!s) return '';
  const parts: string[] = [];
  if (s.focal) parts.push(`${s.focal}mm`);
  if (s.aperture) parts.push(`f/${s.aperture}`);
  if (s.shutter) parts.push(s.shutter);
  if (s.iso) parts.push(`ISO ${s.iso}`);
  return parts.join(' · ');
}

/** Body and lens, where known. */
export function gearLine(photo: Photo): string {
  const s = photo.shot;
  if (!s) return '';
  return [s.camera, s.lens].filter(Boolean).join(' · ');
}

/** Capture date for a single frame. */
export function shotDate(photo: Photo): string {
  return photo.shot?.takenAt ? formatDate(photo.shot.takenAt.slice(0, 10)) : '';
}

/**
 * Alt text.
 *
 * Nothing in this library carries keywords or captions, so there is no honest
 * way to describe subject matter automatically. Rather than invent one, this
 * states what is actually known — a photograph, where and when — which is
 * still far better for a screen reader than the empty string the site
 * previously emitted for all 454 frames.
 */
export function altText(photo: Photo, album?: Album): string {
  if (photo.title) {
    return photo.latin ? `${photo.title} (${photo.latin})` : photo.title;
  }
  const where = album?.region || album?.title;
  const when = photo.shot?.takenAt ? formatMonth(photo.shot.takenAt.slice(0, 7)) : '';
  return ['Photograph', where && `from ${where}`, when && `, ${when}`]
    .filter(Boolean)
    .join(' ')
    .replace(' ,', ',');
}

// ── Library adapters ────────────────────────────────────────────────

/** Map a Photo to the shape react-photo-album expects. */
export function toLibraryPhoto(photo: Photo, album?: Album) {
  return {
    key: photo.id,
    src: imgUrl(photo.src),
    width: photo.width,
    height: photo.height,
    alt: altText(photo, album),
    title: photo.title ?? undefined,
    srcSet: photo.sizes.map((s) => ({
      src: imgUrl(s.src),
      width: s.width,
      height: s.height,
    })),
    _photo: photo,
  };
}

/** Map a Photo to a lightbox slide. */
export function toSlide(photo: Photo, album?: Album) {
  const largest = photo.sizes[photo.sizes.length - 1];
  return {
    src: imgUrl(largest?.src ?? photo.src),
    width: largest?.width ?? photo.width,
    height: largest?.height ?? photo.height,
    alt: altText(photo, album),
    srcSet: photo.sizes.map((s) => ({
      src: imgUrl(s.src),
      width: s.width,
      height: s.height,
    })),
    photo,
  };
}

/** Build srcSet string for a given format. */
export function buildSrcSet(photo: Photo, format: 'webp' | 'jpg'): string {
  return photo.sizes
    .map((s) => `${imgUrl(format === 'webp' ? s.srcWebp : s.src)} ${s.width}w`)
    .join(', ');
}
