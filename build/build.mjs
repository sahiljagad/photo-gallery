#!/usr/bin/env node
/**
 * build.mjs — turns chosen photographs into a site.
 *
 * The published set is defined by albums/*.json and nothing else. This file
 * used to glob every image in a directory, which meant the set of published
 * photographs was "whatever happened to be on disk" — a definition nobody
 * ever chose, and the reason an album could grow by 51 frames unnoticed.
 *
 * Now: a frame that is not listed in a manifest is never read, never resized,
 * never written to photos.json, and never deployed. Absence, not a flag.
 */

import { mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
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
import { photoPath, listSourceFiles, loadConfig } from './library.mjs';
import { readAllManifests, validateManifest, selectedPhotos } from './albums.mjs';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const IMG_DIR = join(PUBLIC_DIR, 'img');
const WIDTHS = [640, 1080, 1600, 2200];

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

const CAMERA_RE = /^_?DSC[_-]?\d|^IMG[_-]?\d|^DSCN?\d|^P\d{6,}|^fullsizeoutput|^DCIM|^GOPR|^DJI_/i;

/**
 * Fall back to the filename for a title when the manifest has none.
 * `great-egret--ardea-alba.jpg` → { title: "Great Egret", latin: "Ardea alba" }
 * Camera filenames and export numbering yield nothing, which is correct —
 * "DSC 3154" is not a title.
 */
function titleFromFilename(filename) {
  const base = parse(filename).name.replace(/^\d+_/, '');
  if (CAMERA_RE.test(base)) return {};
  if (/^([a-z][\w-]*?)-?\d{1,4}$/i.test(base)) return {};

  const parts = base.split('--');
  const raw = parts[0].replace(/-/g, ' ').trim();
  if (!raw) return {};

  const out = { title: titleCase(raw) };
  if (parts.length > 1) {
    const w = parts[1].replace(/-/g, ' ').trim().split(/\s+/);
    out.latin = w[0].charAt(0).toUpperCase() + w[0].slice(1).toLowerCase() +
      (w.length > 1 ? ' ' + w.slice(1).map((x) => x.toLowerCase()).join(' ') : '');
  }
  return out;
}

/**
 * Generate derivatives and measurements for one photograph.
 * Incremental: an output newer than its source is left alone.
 */
/**
 * Copyright to stamp on every derivative.
 *
 * Set explicitly rather than copying the source's metadata forward. The
 * originals carry a camera serial number (and would carry GPS if these bodies
 * had a receiver), which is a fingerprint linking every photograph you publish
 * anywhere back to one camera. Copying metadata wholesale would leak it;
 * writing only these two fields does not.
 *
 * This does not stop anyone taking an image. It establishes authorship, and
 * removing it is itself unlawful in several jurisdictions.
 */
function exifFor(config) {
  const c = config.copyright;
  if (!c?.creator && !c?.notice) return undefined;
  const IFD0 = {};
  if (c.notice) IFD0.Copyright = c.notice;
  if (c.creator) IFD0.Artist = c.creator;
  return { IFD0 };
}

async function processImage(albumId, source, file, exif) {
  const srcPath = await photoPath(source, file);
  const srcStat = await stat(srcPath);
  const photoId = parse(file).name;
  const outDir = join(IMG_DIR, albumId);
  await mkdir(outDir, { recursive: true });

  const meta = await sharp(srcPath).metadata();
  const masterW = meta.width;
  const masterH = meta.height;
  const ar = masterW / masterH;
  const { shot, rating } = readMetadata(meta);

  const sizes = [];
  const targets = WIDTHS.filter((w) => w <= masterW);
  if (targets.length === 0) targets.push(masterW);

  for (const w of targets) {
    const h = Math.round(w / ar);
    const webpPath = join(outDir, `${photoId}-${w}.webp`);
    const jpgPath = join(outDir, `${photoId}-${w}.jpg`);

    const fresh = async (p) => existsSync(p) && (await stat(p)).mtimeMs > srcStat.mtimeMs;

    if (!(await fresh(webpPath))) {
      let pipe = sharp(srcPath).resize(w, h, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 });
      if (exif) pipe = pipe.withExif(exif);
      await pipe.toFile(webpPath);
    }
    if (!(await fresh(jpgPath))) {
      let pipe = sharp(srcPath).resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true });
      if (exif) pipe = pipe.withExif(exif);
      await pipe.toFile(jpgPath);
    }

    sizes.push({
      width: w,
      height: h,
      src: `img/${albumId}/${photoId}-${w}.jpg`,
      srcWebp: `img/${albumId}/${photoId}-${w}.webp`,
    });
  }

  // LQIP: 20px wide, blurred, inlined so it paints with the JSON
  const lqipBuf = await sharp(srcPath)
    .resize(20, null, { fit: 'inside' }).blur(1.4).jpeg({ quality: 40 }).toBuffer();
  const lqip = `data:image/jpeg;base64,${lqipBuf.toString('base64')}`;

  // Measurement wants raw pixels with the aspect ratio intact
  const { data: rawBuf, info } = await sharp(srcPath)
    .resize(288, 288, { fit: 'inside' }).raw().ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const measurements = measurePhoto(new Uint8Array(rawBuf), info.width, info.height);

  const largest = sizes[sizes.length - 1];

  return {
    id: photoId,
    file,
    src: largest.src,
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

/** Earliest and latest capture dates in an album, as YYYY-MM-DD. */
function captureRange(photos) {
  const stamps = photos.map((p) => p.shot?.takenAt).filter(Boolean).sort();
  if (!stamps.length) return null;
  return { start: stamps[0].slice(0, 10), end: stamps[stamps.length - 1].slice(0, 10) };
}

/** Capture-time order — the baseline the sequencer starts from. */
function chronological(photos) {
  return [...photos].sort((a, b) => {
    const ta = a.shot?.takenAt, tb = b.shot?.takenAt;
    if (ta && tb && ta !== tb) return ta.localeCompare(tb);
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    return a.file.localeCompare(b.file);
  });
}

/**
 * Delete derivatives that no longer belong to anything published.
 *
 * This matters more than housekeeping: unpublishing a photograph has to remove
 * its files, or the next deploy ships an image nobody chose. Orphans are a
 * privacy leak, not clutter.
 */
async function pruneOrphans(archive) {
  if (!existsSync(IMG_DIR)) return { dirs: 0, files: 0 };

  const keepDirs = new Set(archive.map((a) => a.id));
  const keepFiles = new Set();
  for (const album of archive) {
    for (const p of album.photos) {
      for (const s of p.sizes) { keepFiles.add(s.src); keepFiles.add(s.srcWebp); }
    }
  }

  let dirs = 0, files = 0;
  for (const entry of await readdir(IMG_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!keepDirs.has(entry.name)) {
      await rm(join(IMG_DIR, entry.name), { recursive: true, force: true });
      dirs++;
      continue;
    }
    for (const f of await readdir(join(IMG_DIR, entry.name))) {
      if (!keepFiles.has(`img/${entry.name}/${f}`)) {
        await rm(join(IMG_DIR, entry.name, f), { force: true });
        files++;
      }
    }
  }
  return { dirs, files };
}

// ── Main ────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {boolean} opts.includeDrafts — build albums marked draft, for local
 *   preview only. Deploy never sets this, so a draft cannot reach the site.
 */
export async function build({ includeDrafts = false } = {}) {
  const startTime = Date.now();
  const config = await loadConfig();
  const exif = exifFor(config);
  if (exif) console.log(`   stamping: ${exif.IFD0.Copyright ?? exif.IFD0.Artist}`);

  const all = await readAllManifests();
  if (all.length === 0) {
    console.log('No album manifests in albums/. Run `npm run curate` to choose photographs.');
    return [];
  }

  // Validate everything before generating anything — a broken manifest should
  // stop the build, not produce a half-built site.
  const problems = [];
  for (const m of all) {
    const files = await listSourceFiles(m.source);
    for (const err of validateManifest(m, files)) problems.push(`${m.id}: ${err}`);
  }
  if (problems.length) {
    console.error('\n✗ Manifest problems:\n' + problems.map((p) => `   ${p}`).join('\n') + '\n');
    throw new Error(`${problems.length} manifest problem(s)`);
  }

  const manifests = all.filter((m) => (includeDrafts || m.published) && selectedPhotos(m).length > 0);

  const skipped = all.filter((m) => !manifests.includes(m));
  for (const m of skipped) {
    const n = selectedPhotos(m).length;
    console.log(`   skipping ${m.id} — ${n === 0 ? 'nothing selected' : 'draft'}`);
  }

  await mkdir(PUBLIC_DIR, { recursive: true });
  const archive = [];

  for (const manifest of manifests) {
    const chosen = selectedPhotos(manifest);
    console.log(`\n📁 ${manifest.title || manifest.id} — ${chosen.length} selected`);

    const photos = [];
    for (const entry of chosen) {
      process.stdout.write(`  ${entry.file}...`);
      const photo = await processImage(manifest.id, manifest.source, entry.file, exif);

      // Manifest captions win; the filename is only a fallback
      const fromName = titleFromFilename(entry.file);
      photo.title = entry.title ?? fromName.title ?? null;
      photo.latin = entry.latin ?? fromName.latin ?? undefined;
      photo.note = entry.note ?? undefined;

      photos.push(photo);
      console.log(' done');
    }

    const range = captureRange(photos);
    const baseline = chronological(photos);
    const scales = normaliseAlbum(baseline);

    let ordered;
    if (baseline.length < 3) {
      ordered = baseline;
    } else {
      const before = meanTonalStep(baseline);
      ordered = sequenceAlbum(baseline, scales);
      ordered = applyGazePairing(ordered, scales);
      console.log(`  sequenced: tonal step ${before.toFixed(1)} → ${meanTonalStep(ordered).toFixed(1)} L*`);
    }
    ordered.forEach((p, i) => { p.order = i; });

    // An explicit cover wins; otherwise the algorithm picks one
    const cover = ordered.find((p) => p.file === manifest.cover) ?? pickCover(ordered);

    archive.push({
      id: manifest.id,
      title: manifest.title || manifest.id,
      date: range?.start ?? '1970-01-01',
      dateEnd: range?.end,
      region: manifest.region ?? undefined,
      intro: manifest.intro ?? undefined,
      draft: manifest.published ? undefined : true,
      cover,
      photos: ordered,
    });
  }

  archive.sort((a, b) => b.date.localeCompare(a.date));

  const pruned = await pruneOrphans(archive);
  if (pruned.dirs || pruned.files) {
    console.log(`\n🧹 Removed ${pruned.dirs} album folder(s) and ${pruned.files} orphaned file(s)`);
  }

  if (archive[0]) {
    const c = archive[0].cover;
    const source = join(PUBLIC_DIR, c.sizes[c.sizes.length - 1].src);
    if (existsSync(source)) {
      await sharp(source).resize(1200, 630, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 82, progressive: true }).toFile(join(PUBLIC_DIR, 'og-image.jpg'));
    }
  }

  const outPath = join(PUBLIC_DIR, 'photos.json');
  await writeFile(outPath, JSON.stringify(archive, null, 2));

  const total = archive.reduce((s, a) => s + a.photos.length, 0);
  console.log(`\n✅ ${archive.length} album(s), ${total} photograph(s) in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  if (archive.some((a) => a.draft)) {
    console.log('   ⚠ includes drafts — these are for local preview and are excluded from deploy');
  }
  return archive;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const includeDrafts = process.argv.includes('--drafts');
  build({ includeDrafts }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
