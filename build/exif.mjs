/**
 * exif.mjs — Extracts the metadata this archive actually carries.
 *
 * These cameras (D3400, D850) have no GPS receiver, and nothing in the
 * library has keywords, captions or titles. What every file does have is
 * capture time, body, lens and exposure — which is what a photograph's
 * exhibition label wants anyway.
 */

// ── TIFF/EXIF tag tables ────────────────────────────────────────────

const IFD_TAGS = {
  0x0110: 'model',
  0x010f: 'make',
  0x0112: 'orientation',
  0x8769: '@exif',
  0x8825: '@gps',
};

const EXIF_TAGS = {
  0x829a: 'exposureTime',
  0x829d: 'fNumber',
  0x8827: 'iso',
  0x9003: 'dateTimeOriginal',
  0x9011: 'offsetTimeOriginal',
  0x920a: 'focalLength',
  0xa405: 'focalLength35',
  0xa434: 'lensModel',
};

const GPS_TAGS = {
  1: 'latRef', 2: 'lat', 3: 'lonRef', 4: 'lon', 6: 'altitude',
};

/** Bytes per component, indexed by TIFF type code. */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/**
 * Walk a TIFF structure and pull the tags we care about.
 * Returns a flat object; missing tags are simply absent.
 */
function parseTiff(buf) {
  // sharp hands back either a raw TIFF block or one prefixed with "Exif\0\0"
  const start = buf.length >= 6 && buf.subarray(0, 4).toString('latin1') === 'Exif' ? 6 : 0;
  const t = buf.subarray(start);
  if (t.length < 8) return {};

  const order = t.subarray(0, 2).toString('latin1');
  if (order !== 'II' && order !== 'MM') return {};
  const le = order === 'II';

  const u16 = (p) => (p + 2 <= t.length ? (le ? t.readUInt16LE(p) : t.readUInt16BE(p)) : 0);
  const u32 = (p) => (p + 4 <= t.length ? (le ? t.readUInt32LE(p) : t.readUInt32BE(p)) : 0);
  const i32 = (p) => (p + 4 <= t.length ? (le ? t.readInt32LE(p) : t.readInt32BE(p)) : 0);

  const out = {};
  const seen = new Set();

  function readValue(type, count, ptr) {
    if (type === 2) {
      return t.subarray(ptr, ptr + count).toString('latin1').replace(/\0.*$/s, '').trim();
    }
    if (type === 3) return u16(ptr);
    if (type === 4) return u32(ptr);
    if (type === 5 || type === 10) {
      const vals = [];
      for (let k = 0; k < count; k++) {
        const num = type === 5 ? u32(ptr + k * 8) : i32(ptr + k * 8);
        const den = type === 5 ? u32(ptr + k * 8 + 4) : i32(ptr + k * 8 + 4);
        vals.push(den === 0 ? 0 : num / den);
      }
      return count === 1 ? vals[0] : vals;
    }
    return undefined;
  }

  function readIfd(offset, tags) {
    // Guard against malformed files pointing IFDs at each other
    if (offset <= 0 || offset + 2 > t.length || seen.has(offset)) return;
    seen.add(offset);

    const count = u16(offset);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > t.length) return;

      const tag = u16(entry);
      const name = tags[tag];
      if (!name) continue;

      const type = u16(entry + 2);
      const n = u32(entry + 4);
      const size = (TYPE_SIZE[type] || 0) * n;
      if (size === 0 || n > 0xffff) continue;

      const ptr = size <= 4 ? entry + 8 : u32(entry + 8);
      if (ptr + size > t.length) continue;

      if (name === '@exif') readIfd(u32(entry + 8) || readValue(type, n, ptr), EXIF_TAGS);
      else if (name === '@gps') readIfd(u32(entry + 8) || readValue(type, n, ptr), GPS_TAGS);
      else {
        const v = readValue(type, n, ptr);
        if (v !== undefined && v !== '') out[name] = v;
      }
    }
  }

  readIfd(u32(4), IFD_TAGS);
  return out;
}

// ── XMP ─────────────────────────────────────────────────────────────

/**
 * Pull the fields Lightroom/Photos write that EXIF doesn't carry.
 * Star ratings are real curation signal — worth surfacing.
 */
function parseXmp(buf) {
  const x = buf.toString('utf8');
  const out = {};

  const rating = x.match(/xmp:Rating\s*=\s*"(-?\d+)"/);
  if (rating) out.rating = Math.max(0, parseInt(rating[1], 10));

  // Lens sometimes only appears in the aux namespace
  const lens = x.match(/aux:Lens\s*=\s*"([^"]+)"/);
  if (lens) out.xmpLens = lens[1];

  const created = x.match(/xmp:CreateDate\s*=\s*"([^"]+)"/);
  if (created) out.xmpCreateDate = created[1];

  // dc:title and dc:subject are empty across this library, but honour them if
  // they ever get filled in from Lightroom
  const title = x.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/);
  if (title && title[1].trim()) out.xmpTitle = title[1].trim();

  const subjects = x.match(/<dc:subject>([\s\S]*?)<\/dc:subject>/);
  if (subjects) {
    const items = [...subjects[1].matchAll(/<rdf:li[^>]*>([^<]+)<\/rdf:li>/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    if (items.length) out.keywords = items;
  }

  return out;
}

// ── Formatting ──────────────────────────────────────────────────────

/** "NIKON CORPORATION" + "NIKON D850" → "Nikon D850" */
function formatCamera(make, model) {
  if (!model) return undefined;
  let m = model.trim();
  // Model usually already includes the brand; strip a duplicated make prefix
  const brand = (make || '').trim().split(/\s+/)[0];
  if (brand && m.toUpperCase().startsWith(brand.toUpperCase())) {
    m = m.slice(brand.length).trim();
    return `${titleBrand(brand)} ${m}`.trim();
  }
  return m;
}

function titleBrand(b) {
  const known = { NIKON: 'Nikon', CANON: 'Canon', SONY: 'Sony', FUJIFILM: 'Fujifilm', APPLE: 'Apple' };
  return known[b.toUpperCase()] || b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
}

/** "200.0-500.0 mm f/5.6" → "200–500mm f/5.6"; "50.0 mm f/1.8" → "50mm f/1.8" */
function formatLens(lens) {
  if (!lens) return undefined;
  let s = lens.trim();
  // Drop a leading brand that duplicates the body's
  s = s.replace(/^AF-S\s+Nikkor\s+/i, '');
  s = s.replace(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*mm/i, (_, a, b) => `${trimNum(a)}–${trimNum(b)}mm`);
  s = s.replace(/(\d+(?:\.\d+)?)\s*mm/i, (m, a) => (m.includes('–') ? m : `${trimNum(a)}mm`));
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function trimNum(n) {
  const v = parseFloat(n);
  return Number.isInteger(v) ? String(v) : String(v);
}

/** 0.004 → "1/250"; 1.6 → "1.6s" */
function formatShutter(sec) {
  if (!sec || sec <= 0) return undefined;
  if (sec >= 1) return `${Number(sec.toFixed(1))}s`;
  return `1/${Math.round(1 / sec)}`;
}

/** "2025:07:04 15:42:18" → "2025-07-04T15:42:18" (sorts lexicographically) */
function normaliseDate(dt) {
  if (!dt) return undefined;
  const m = dt.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  // Reject the zero date some cameras write when the clock is unset
  if (y === '0000') return undefined;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Read metadata from a sharp metadata object.
 * @param {object} meta — result of sharp(path).metadata()
 * @returns {object} { takenAt, camera, lens, focal, aperture, shutter, iso, rating, orientation }
 */
export function readMetadata(meta) {
  let exif = {};
  let xmp = {};

  try { if (meta.exif) exif = parseTiff(meta.exif); } catch {}
  try { if (meta.xmp) xmp = parseXmp(meta.xmp); } catch {}

  const takenAt = normaliseDate(exif.dateTimeOriginal) || normaliseDate(xmp.xmpCreateDate);

  const shot = {
    takenAt,
    offset: exif.offsetTimeOriginal || undefined,
    camera: formatCamera(exif.make, exif.model),
    lens: formatLens(exif.lensModel || xmp.xmpLens),
    focal: exif.focalLength ? Math.round(exif.focalLength) : undefined,
    focal35: exif.focalLength35 ? Math.round(exif.focalLength35) : undefined,
    aperture: exif.fNumber ? Number(exif.fNumber.toFixed(1)) : undefined,
    shutter: formatShutter(exif.exposureTime),
    iso: exif.iso || undefined,
  };

  // Strip undefined so photos.json stays readable
  for (const k of Object.keys(shot)) if (shot[k] === undefined) delete shot[k];

  return {
    shot: Object.keys(shot).length ? shot : undefined,
    rating: xmp.rating,
    orientation: exif.orientation,
    keywords: xmp.keywords,
    xmpTitle: xmp.xmpTitle,
  };
}

/**
 * Human-readable exposure line: "500mm · f/5.6 · 1/200 · ISO 1000"
 * Exported for reuse; the frontend formats its own copy from the same fields.
 */
export function exposureLine(shot) {
  if (!shot) return '';
  const parts = [];
  if (shot.focal) parts.push(`${shot.focal}mm`);
  if (shot.aperture) parts.push(`f/${shot.aperture}`);
  if (shot.shutter) parts.push(shot.shutter);
  if (shot.iso) parts.push(`ISO ${shot.iso}`);
  return parts.join(' · ');
}
