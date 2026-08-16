#!/usr/bin/env node
/**
 * watch.mjs — Watches photos/ for changes, debounced 2.5s, triggers rebuild.
 */

import { watch } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from './build.mjs';

const PHOTOS_DIR = join(import.meta.dirname, '..', 'photos');
const DEBOUNCE_MS = 2500;

export function watchPhotos() {
  if (!existsSync(PHOTOS_DIR)) {
    mkdirSync(PHOTOS_DIR, { recursive: true });
  }

  let timer = null;
  let building = false;

  const rebuild = async () => {
    if (building) return;
    building = true;
    console.log('\n[watch] Change detected, rebuilding...');
    try {
      await build({ includeDrafts: true });   // local preview shows drafts
      console.log('[watch] Done. Watching for changes...');
    } catch (err) {
      console.error('[watch] Build error:', err);
    }
    building = false;
  };

  watch(PHOTOS_DIR, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, DEBOUNCE_MS);
  });

  console.log(`[watch] Watching ${PHOTOS_DIR} (debounce ${DEBOUNCE_MS}ms)`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  watchPhotos();
}
