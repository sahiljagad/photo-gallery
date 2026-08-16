/**
 * library.mjs — locating the photo library.
 *
 * The library lives outside the repo, at a path that differs per machine, so
 * it is configured once in photos.config.json (gitignored) and referenced by
 * folder name from the album manifests (committed). That split keeps every
 * committed file portable while the single machine-specific line stays in one
 * place.
 *
 * This replaces the previous symlink arrangement, where photos/<id> pointed at
 * the real folder and the album's date and title were parsed back out of the
 * symlink's name. Manifests now carry the title, capture time comes from EXIF,
 * and the source folder is named outright — so a reader can see which
 * directory an album draws from without running `ls -la`.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(import.meta.dirname, '..');
const CONFIG_PATH = join(ROOT, 'photos.config.json');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp']);

/** Expand a leading ~ so the config can be written the way people type paths. */
function expandHome(p) {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

let cached = null;

/**
 * Read photos.config.json.
 * @returns {{library: string}}
 */
export async function loadConfig() {
  if (cached) return cached;

  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      'No photos.config.json found.\n\n' +
        'Create one at the repo root:\n\n' +
        '  { "library": "~/Desktop/photography" }\n\n' +
        'It is gitignored — it points at your photo library on this machine.',
    );
  }

  let raw;
  try {
    raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`photos.config.json is not valid JSON: ${err.message}`);
  }

  if (!raw.library) throw new Error('photos.config.json needs a "library" path.');

  const library = resolve(expandHome(raw.library));
  if (!existsSync(library)) {
    throw new Error(`Library path does not exist: ${library}`);
  }

  cached = { ...raw, library };
  return cached;
}

/** Absolute path to an album's source directory. */
export async function sourceDir(source) {
  const { library } = await loadConfig();
  return join(library, source);
}

/** Image files in a source folder, sorted. */
export async function listSourceFiles(source) {
  const dir = await sourceDir(source);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries
    .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
    .sort();
}

/**
 * Folders listed in config.ignore never appear in the curation tool at all.
 *
 * This is not a security boundary — the manifest allowlist is what actually
 * prevents publication. It exists so that folders which are never going to be
 * published (family, client work, profile pictures) are not sitting in a grid
 * one stray click away from being selected. Removing the opportunity for the
 * mistake is worth more than trusting yourself not to make it.
 *
 * Entries match a folder name exactly, or as a prefix when ending in `*`.
 */
export function isIgnored(source, ignore = []) {
  return ignore.some((pattern) =>
    pattern.endsWith('*')
      ? source.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase())
      : source.toLowerCase() === pattern.toLowerCase(),
  );
}

/**
 * Every folder in the library that holds images — the candidates you can
 * turn into an album. Non-recursive: one level of trip folders.
 */
export async function listLibraryFolders({ includeIgnored = false } = {}) {
  const { library, ignore = [] } = await loadConfig();
  const entries = await readdir(library, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    const ignored = isIgnored(entry.name, ignore);
    if (ignored && !includeIgnored) continue;
    const files = await listSourceFiles(entry.name);
    if (files.length > 0) out.push({ source: entry.name, count: files.length, ignored });
  }

  return out.sort((a, b) => a.source.localeCompare(b.source));
}

/** Absolute path to one photograph. */
export async function photoPath(source, file) {
  return join(await sourceDir(source), file);
}

/** mtime of a source file, used only for reporting. */
export async function sourceMtime(source, file) {
  return (await stat(await photoPath(source, file))).mtimeMs;
}
