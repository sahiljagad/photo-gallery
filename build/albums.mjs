/**
 * albums.mjs — the selection layer.
 *
 * A single invariant governs this file:
 *
 *     Nothing is publicly reachable unless it was explicitly chosen.
 *
 * Every album has one manifest in albums/, committed to the repo. The
 * `photos` array *is* the allowlist — a frame that is not listed is not
 * published, and there is no per-photo flag to forget to set. Read the diff
 * of one of these files and you know exactly what changed about what is
 * public.
 *
 * `id` and `source` are deliberately separate. `source` is the folder in your
 * library and may be renamed at will; `id` is the URL slug and must not
 * change, because links to it exist in the world.
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { listSourceFiles } from './library.mjs';

export const ALBUMS_DIR = join(import.meta.dirname, '..', 'albums');

export function slugify(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // split letter/digit runs so Portugal2026 → portugal-2026
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .replace(/(\d)([a-zA-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleFrom(source) {
  return source
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // strip a trailing year that belongs in the date, not the title
    .replace(/\s+(19|20)\d{2}$/, '');
}

/**
 * A fresh manifest. Empty selection — fail closed by construction.
 *
 * The id is slugged from the full folder name, not the display title, because
 * the title deliberately strips a trailing year — and "Kenya 2018" and
 * "Kenya 2026" would then collide on a single URL.
 */
export function emptyManifest(source) {
  return {
    id: slugify(source),
    source,
    title: titleFrom(source),
    region: null,
    intro: null,
    published: false,
    cover: null,
    photos: [],
  };
}

export function manifestPath(id) {
  return join(ALBUMS_DIR, `${id}.json`);
}

export async function readManifest(id) {
  const path = manifestPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`albums/${id}.json is not valid JSON: ${err.message}`);
  }
}

export async function writeManifest(manifest) {
  await mkdir(ALBUMS_DIR, { recursive: true });
  await writeFile(manifestPath(manifest.id), JSON.stringify(manifest, null, 2) + '\n');
}

export async function readAllManifests() {
  if (!existsSync(ALBUMS_DIR)) return [];
  const entries = await readdir(ALBUMS_DIR);
  const out = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.startsWith('_')) continue;
    const m = await readManifest(parse(entry).name);
    if (m) out.push(m);
  }
  return out;
}

/** Normalise `photos[]` entries to objects, so callers need not care. */
export function selectedPhotos(manifest) {
  return (manifest.photos || []).map((e) => (typeof e === 'string' ? { file: e } : e));
}

/**
 * Validate a manifest against what is actually on disk.
 *
 * Hard errors, not warnings. A manifest referencing a file that no longer
 * exists means a photograph was renamed or moved; stopping is correct, since
 * silently dropping it would let an album shrink between builds unnoticed.
 *
 * @returns {string[]} messages; empty means valid
 */
export function validateManifest(manifest, sourceFiles) {
  const errors = [];
  const present = new Set(sourceFiles);

  if (!manifest.id) errors.push('missing "id"');
  if (!manifest.source) errors.push('missing "source"');
  if (!Array.isArray(manifest.photos)) {
    errors.push('"photos" must be an array');
    return errors;
  }

  const seen = new Set();
  for (const entry of selectedPhotos(manifest)) {
    if (!entry.file) {
      errors.push('a photos[] entry has no "file"');
      continue;
    }
    if (seen.has(entry.file)) errors.push(`"${entry.file}" is listed more than once`);
    seen.add(entry.file);
    if (!present.has(entry.file)) {
      errors.push(`"${entry.file}" is selected but missing from ${manifest.source}/`);
    }
  }

  if (manifest.cover && !seen.has(manifest.cover)) {
    errors.push(`cover "${manifest.cover}" is not in the selection`);
  }

  return errors;
}

/**
 * Compare a manifest against its source folder.
 * The build prints this, so a library that grew is visible rather than silent.
 */
export async function diffAgainstSource(manifest) {
  const files = await listSourceFiles(manifest.source);
  const selected = new Set(selectedPhotos(manifest).map((p) => p.file));
  return {
    total: files.length,
    selected: selected.size,
    unselected: files.filter((f) => !selected.has(f)),
    missing: [...selected].filter((f) => !files.includes(f)),
  };
}
