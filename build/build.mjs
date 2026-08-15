#!/usr/bin/env node
/**
 * build.mjs — Scans photos/, generates derivatives, measures, sequences,
 * and writes public/photos.json.
 */

import { readdir, stat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename, parse } from 'node:path';
import sharp from 'sharp';
import {
  measurePhoto,
  normaliseAlbum,
  sequenceAlbum,
  pickCover,
  applyGazePairing,
  meanTonalStep,
} from './flow.mjs';
import { readMetadata } from './exif.mjs';

const PHOTOS_DIR = join(import.meta.dirname, '..', 'photos');
const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const IMG_DIR = join(PUBLIC_DIR, 'img');
const WIDTHS = [640, 1080, 1600, 2200];
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp']);
const ALBUM_RE = /^(\d{4}-\d{2}-\d{2})[_ -]+(.+)$/;

// Particles to keep lowercase in title-case
const PARTICLES = new Set([
  'da', 'de', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'no', 'na',
  'the', 'of', 'to', 'at', 'in', 'on', 'and', 'from', 'for',
]);

function titleCase(str) {
  return str
    .split(/[\s-]+/)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && PARTICLES.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

// Camera-generated filenames that shouldn't become titles
const CAMERA_RE = /^_?DSC[_-]?\d|^IMG[_-]?\d|^DSCN?\d|^P\d{6,}|^fullsizeoutput|^DCIM|^GOPR|^DJI_/i;

/**
 * Parse a filename into title, optional latin name, and pinned order.
 * - `douro-sunset.jpg` → { title: "Douro Sunset" }
 * - `great-egret--ardea-alba.jpg` → { title: "Great Egret", latin: "Ardea alba" }
 * - `03_frame.jpg` → { title: "Frame", pinned: 3 } (explicit pin)
 * - `portugal-01.jpg` → { title: null, seq: 1 } (export numbering, not a pin)
 * - `DSC_3154.jpg` → { title: null } (camera filename = no title)
 *
 * Pinning is deliberately narrow. An `NN_` prefix is something you type on
 * purpose; the trailing numbers Lightroom puts on an export are not a request
 * for that order, and treating them as one silently disabled sequencing for
 * every album exported that way.
 */
function parseFilename(filename) {
  const name = parse(filename).name;
  const result = { title: null, latin: undefined, pinned: undefined, seq: undefined };

  // Explicit pin: leading digits followed by an underscore
  const pinMatch = name.match(/^(\d+)_(.+)$/);
  const base = pinMatch ? pinMatch[2] : name;
  if (pinMatch) result.pinned = parseInt(pinMatch[1], 10);

  // Camera-generated filenames get no title
  if (CAMERA_RE.test(base)) {
    const camSeq = base.match(/(\d{1,5})\s*\d*$/);
    if (camSeq) result.seq = parseInt(camSeq[1], 10);
    return result;
  }

  // Slug-number patterns like "portugal-01" or "glacier-066" — no title,
  // and the number is kept only as a stable tiebreak
  const slugNumMatch = base.match(/^([a-z][\w-]*?)-?(\d{1,4})$/i);
  if (slugNumMatch) {
    result.seq = parseInt(slugNumMatch[2], 10);
    return result;
  }

  // Check for latin name (double dash separator)
  const parts = base.split('--');
  const rawTitle = parts[0].replace(/-/g, ' ').trim();
  if (rawTitle) result.title = titleCase(rawTitle);

  if (parts.length > 1) {
    const latinParts = parts[1].replace(/-/g, ' ').trim().split(/\s+/);
    result.latin =
      latinParts[0].charAt(0).toUpperCase() +
      latinParts[0].slice(1).toLowerCase() +
      (latinParts.length > 1 ? ' ' + latinParts.slice(1).map((w) => w.toLowerCase()).join(' ') : '');
  }

  return result;
}

/** Scan photos/ for album directories, sorted newest first. */
async function scanAlbums() {
  if (!existsSync(PHOTOS_DIR)) {
    console.log('No photos/ directory found. Nothing to build.');
    return [];
  }

  const entries = await readdir(PHOTOS_DIR, { withFileTypes: true });
  const albums = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const match = entry.name.match(ALBUM_RE);
    if (!match) continue;

    // Read optional _meta.json
    let meta = {};
    const metaPath = join(PHOTOS_DIR, entry.name, '_meta.json');
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(await readFile(metaPath, 'utf8')); } catch {}
    }

    albums.push({
      id: entry.name,
      // Folder date is a fallback. It records when the files were copied, not
      // when they were taken — every album in this archive was off by days,
      // and one by a year. Capture time from EXIF wins where it exists.
      folderDate: match[1],
      date: match[1],
      title: meta.title || titleCase(match[2].replace(/[-_]/g, ' ')),
      region: meta.region,
      lat: meta.lat,
      lon: meta.lon,
      note: meta.note,
      intro: meta.intro || meta.note,
    });
  }

  // Sort newest first
  albums.sort((a, b) => b.date.localeCompare(a.date));
  return albums;
}

/** List image files in an album directory. */
async function listImages(albumDir) {
  const entries = await readdir(albumDir);
  return entries
    .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
    .sort();
}

/**
 * Generate derivatives for a single image. Returns the photo record.
 * Skips generation if outputs are newer than the source (incremental).
 */
async function processImage(albumId, filename, albumDir) {
  const srcPath = join(albumDir, filename);
  const srcStat = await stat(srcPath);
  const parsed = parseFilename(filename);
  const photoId = parse(filename).name;
  const outDir = join(IMG_DIR, albumId);
  await mkdir(outDir, { recursive: true });

  // Read metadata for dimensions and capture details
  const meta = await sharp(srcPath).metadata();
  const masterW = meta.width;
  const masterH = meta.height;
  const ar = masterW / masterH;
  const { shot, rating } = readMetadata(meta);

  const sizes = [];

  for (const w of WIDTHS) {
    if (w > masterW) continue; // don't upscale

    const h = Math.round(w / ar);
    const webpPath = join(outDir, `${photoId}-${w}.webp`);
    const jpgPath = join(outDir, `${photoId}-${w}.jpg`);

    // Incremental: skip if output newer than source
    const webpFresh = existsSync(webpPath) && (await stat(webpPath)).mtimeMs > srcStat.mtimeMs;
    const jpgFresh = existsSync(jpgPath) && (await stat(jpgPath)).mtimeMs > srcStat.mtimeMs;

    if (!webpFresh) {
      await sharp(srcPath).resize(w, h, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(webpPath);
    }
    if (!jpgFresh) {
      await sharp(srcPath).resize(w, h, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, progressive: true }).toFile(jpgPath);
    }

    sizes.push({
      width: w,
      height: h,
      src: `img/${albumId}/${photoId}-${w}.jpg`,
      srcWebp: `img/${albumId}/${photoId}-${w}.webp`,
    });
  }

  // If no derivative fits (image smaller than smallest width), generate at original size
  if (sizes.length === 0) {
    const w = masterW;
    const h = masterH;
    const webpPath = join(outDir, `${photoId}-${w}.webp`);
    const jpgPath = join(outDir, `${photoId}-${w}.jpg`);
    const webpFresh = existsSync(webpPath) && (await stat(webpPath)).mtimeMs > srcStat.mtimeMs;
    const jpgFresh = existsSync(jpgPath) && (await stat(jpgPath)).mtimeMs > srcStat.mtimeMs;
    if (!webpFresh) {
      await sharp(srcPath).webp({ quality: 80 }).toFile(webpPath);
    }
    if (!jpgFresh) {
      await sharp(srcPath).jpeg({ quality: 85, progressive: true }).toFile(jpgPath);
    }
    sizes.push({
      width: w,
      height: h,
      src: `img/${albumId}/${photoId}-${w}.jpg`,
      srcWebp: `img/${albumId}/${photoId}-${w}.webp`,
    });
  }

  // LQIP: 20px wide, blur 1.4, JPEG q40, base64
  const lqipBuf = await sharp(srcPath)
    .resize(20, null, { fit: 'inside' })
    .blur(1.4)
    .jpeg({ quality: 40 })
    .toBuffer();
  const lqip = `data:image/jpeg;base64,${lqipBuf.toString('base64')}`;

  // Measure: raw pixels at a workable size, aspect ratio preserved.
  // `fit: 'inside'` matters — squashing to a square distorts the gradient
  // field, which is what busy and the centre of visual mass are read from.
  const { data: rawBuf, info } = await sharp(srcPath)
    .resize(288, 288, { fit: 'inside' })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const measurements = measurePhoto(new Uint8Array(rawBuf), info.width, info.height);

  // Use derivative dimensions, not master dimensions (gotcha #3)
  const largest = sizes[sizes.length - 1] || { width: masterW, height: masterH };

  return {
    id: photoId,
    src: largest.src,
    title: parsed.title,
    latin: parsed.latin || undefined,
    pinned: parsed.pinned,
    seq: parsed.seq,
    shot,
    rating,
    ar,
    width: largest.width,
    height: largest.height,
    sizes,
    lqip,
    ...measurements,
  };
}

/**
 * Load or create captions.json for an album.
 * Never overwrites an existing file.
 */
async function loadCaptions(albumDir, photos) {
  const captionsPath = join(albumDir, 'captions.json');
  let captions = {};

  if (existsSync(captionsPath)) {
    try { captions = JSON.parse(await readFile(captionsPath, 'utf8')); } catch {}
  } else {
    // Generate initial captions
    for (const p of photos) {
      captions[p.id] = { title: p.title, latin: p.latin || null, note: null };
    }
    await writeFile(captionsPath, JSON.stringify(captions, null, 2));
    console.log(`  Created captions.json`);
  }

  return captions;
}

/** Apply caption overrides to photo records. */
function applyCaptions(photos, captions) {
  for (const p of photos) {
    const c = captions[p.id];
    if (!c) continue;
    if (c.title) p.title = c.title;
    if (c.latin) p.latin = c.latin;
    if (c.note) p.note = c.note;
  }
}

/** True only when every file carries an explicit `NN_` pin. */
function allPinned(photos) {
  return photos.length > 0 && photos.every((p) => p.pinned != null);
}

/**
 * Capture-time order, falling back to export numbering then filename so the
 * result is deterministic even when a file has no readable EXIF date.
 */
function chronological(photos) {
  return [...photos].sort((a, b) => {
    const ta = a.shot?.takenAt, tb = b.shot?.takenAt;
    if (ta && tb && ta !== tb) return ta.localeCompare(tb);
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    if (a.seq != null && b.seq != null && a.seq !== b.seq) return a.seq - b.seq;
    return a.id.localeCompare(b.id);
  });
}

/** Earliest and latest capture dates in an album, as YYYY-MM-DD. */
function captureRange(photos) {
  const stamps = photos.map((p) => p.shot?.takenAt).filter(Boolean).sort();
  if (stamps.length === 0) return null;
  return { start: stamps[0].slice(0, 10), end: stamps[stamps.length - 1].slice(0, 10) };
}

// ── Main ────────────────────────────────────────────────────────────

export async function build() {
  const startTime = Date.now();
  const albums = await scanAlbums();
  if (albums.length === 0) return;

  await mkdir(PUBLIC_DIR, { recursive: true });

  const archive = [];

  for (const album of albums) {
    console.log(`\n📁 ${album.title} (${album.date})`);
    const albumDir = join(PHOTOS_DIR, album.id);
    const imageFiles = await listImages(albumDir);
    console.log(`  ${imageFiles.length} images`);

    // Process all images
    const photos = [];
    for (const file of imageFiles) {
      process.stdout.write(`  Processing ${file}...`);
      const photo = await processImage(album.id, file, albumDir);
      photos.push(photo);
      console.log(' done');
    }

    // Load/create captions and apply overrides
    const captions = await loadCaptions(albumDir, photos);
    applyCaptions(photos, captions);

    // Correct the album date from capture time
    const range = captureRange(photos);
    if (range) {
      if (range.start !== album.folderDate) {
        console.log(`  Date from EXIF: ${album.folderDate} → ${range.start}` +
          (range.end !== range.start ? ` (through ${range.end})` : ''));
      }
      album.date = range.start;
      album.dateEnd = range.end;
    }

    // Chronological is the baseline: it is the one ordering that is always
    // meaningful, and it decides ties the cost function can't separate.
    const baseline = chronological(photos);

    // Normalise measurements within the album; scales are reused downstream
    const scales = normaliseAlbum(baseline);

    // Sequence
    let ordered;
    let pinned = false;
    const beforeStep = meanTonalStep(baseline);
    if (allPinned(baseline)) {
      ordered = [...baseline].sort((a, b) => a.pinned - b.pinned);
      pinned = true;
      console.log(`  Pinned order (every file carries an NN_ prefix)`);
    } else if (baseline.length < 3) {
      ordered = baseline;
      console.log(`  Too few photos to sequence (${baseline.length})`);
    } else {
      ordered = sequenceAlbum(baseline, scales);
      console.log(`  Sequenced: tonal step ${beforeStep.toFixed(1)} → ${meanTonalStep(ordered).toFixed(1)} L*`);
    }

    // Mass pairing — a finishing touch, and never against an explicit order
    if (!pinned) ordered = applyGazePairing(ordered, scales);

    // Assign final order
    ordered.forEach((p, i) => { p.order = i; });

    // Pick cover (separate from sequence position)
    const cover = pickCover(ordered);

    // Clean up internal fields
    for (const p of ordered) {
      delete p.pinned;
      delete p.seq;
    }

    archive.push({
      id: album.id,
      title: album.title,
      date: album.date,
      dateEnd: album.dateEnd,
      region: album.region,
      lat: album.lat,
      lon: album.lon,
      note: album.note,
      intro: album.intro,
      cover,
      photos: ordered,
    });
  }

  // Re-sort now that dates reflect capture time rather than copy time
  archive.sort((a, b) => b.date.localeCompare(a.date));

  // Social card: a fixed 1200×630 crop of the newest album's cover, so a
  // shared link previews with a photograph rather than a blank rectangle.
  if (archive[0]) {
    const cover = archive[0].cover;
    const source = join(PUBLIC_DIR, cover.sizes[cover.sizes.length - 1]?.src ?? cover.src);
    if (existsSync(source)) {
      await sharp(source)
        .resize(1200, 630, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 82, progressive: true })
        .toFile(join(PUBLIC_DIR, 'og-image.jpg'));
      console.log(`   Social card from ${cover.id}`);
    }
  }

  // Write photos.json
  const outPath = join(PUBLIC_DIR, 'photos.json');
  await writeFile(outPath, JSON.stringify(archive, null, 2));
  console.log(`\n✅ Wrote ${outPath} (${archive.length} albums, ${archive.reduce((s, a) => s + a.photos.length, 0)} photos)`);
  console.log(`   Built in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
