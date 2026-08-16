#!/usr/bin/env node
/**
 * watch.mjs — rebuild when the inputs change.
 *
 * There are exactly two inputs: the manifests (what you chose) and the
 * library (what there is to choose from). This used to watch photos/, which
 * stopped being read when manifests replaced the glob — so saving a curation
 * changed nothing until the next manual build.
 */

import { watch } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { build } from './build.mjs';
import { ALBUMS_DIR } from './albums.mjs';
import { loadConfig } from './library.mjs';

const DEBOUNCE_MS = 700;

export async function watchPhotos() {
  const { library } = await loadConfig();
  if (!existsSync(ALBUMS_DIR)) mkdirSync(ALBUMS_DIR, { recursive: true });

  let timer = null;
  let building = false;
  let queued = false;

  const rebuild = async (reason) => {
    if (building) { queued = true; return; }
    building = true;
    console.log(`\n[watch] ${reason} — rebuilding`);
    try {
      const archive = await build({ includeDrafts: true });
      const n = archive.reduce((s, a) => s + a.photos.length, 0);
      console.log(`[watch] ${archive.length} album(s), ${n} photograph(s)\n`);
    } catch (err) {
      console.error(`[watch] build failed: ${err.message}\n`);
    }
    building = false;
    if (queued) { queued = false; rebuild('queued change'); }
  };

  const schedule = (reason) => {
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(reason), DEBOUNCE_MS);
  };

  // Curation: a manifest was saved
  watch(ALBUMS_DIR, (_e, file) => {
    if (file && file.endsWith('.json')) schedule(`${file} changed`);
  });

  // Library: photographs copied in or removed
  try {
    watch(library, { recursive: true }, (_e, file) => {
      if (file && /\.(jpe?g|png|tiff?|webp)$/i.test(file)) schedule('library changed');
    });
  } catch {
    console.warn('[watch] could not watch the library; manifest changes still rebuild');
  }

  console.log(`[watch] albums/ and ${library.replace(process.env.HOME ?? '', '~')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  watchPhotos();
}
