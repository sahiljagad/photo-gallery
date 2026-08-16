#!/usr/bin/env node
/**
 * studio.mjs — everything you need while working, in one command.
 *
 * Runs three things that were previously separate and always used together:
 *   · the curation tool, for choosing which photographs are published
 *   · the site itself, so you can see the result
 *   · a watcher that rebuilds derivatives when the library changes
 *
 * Drafts are included here and only here. Deploying never shows them.
 */

import { createServer } from 'vite';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { watchPhotos } from './watch.mjs';
import { startCurate } from './curate.mjs';
import { build } from './build.mjs';

const PHOTOS_JSON = join(import.meta.dirname, '..', 'public', 'photos.json');

/** Vite does not watch public/, so nudge the browser when photos.json changes. */
function photosReloadPlugin() {
  return {
    name: 'photos-reload',
    configureServer(server) {
      if (!existsSync(PHOTOS_JSON)) return;
      watch(PHOTOS_JSON, () => {
        console.log('[studio] photos.json changed, reloading');
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

function line(label, url, note) {
  console.log(`  ${label.padEnd(8)} \x1b[36m${url.padEnd(26)}\x1b[0m ${note}`);
}

async function run() {
  // Build once up front so the site has something to show immediately
  console.log('\nBuilding photographs (drafts included)...\n');
  const archive = await build({ includeDrafts: true });

  let curate = null;
  try {
    curate = await startCurate({ quiet: true });
  } catch (err) {
    console.warn(`\n  ⚠ Curation tool did not start: ${err.message}`);
    console.warn('    The site will still run. Free the port and restart to curate.');
  }

  watchPhotos();

  const server = await createServer({
    plugins: [photosReloadPlugin()],
    server: { open: true },
  });
  await server.listen();

  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
  const photos = archive.reduce((n, a) => n + a.photos.length, 0);
  const drafts = archive.filter((a) => a.draft).length;

  console.log('\n─────────────────────────────────────────────────────────────');
  line('Site', url.replace(/\/$/, ''), 'preview the gallery');
  if (curate) line('Curate', `http://127.0.0.1:${curate.port}`, 'choose what gets published');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`  ${archive.length} album(s), ${photos} photograph(s)` +
    (drafts ? `  ·  \x1b[33m${drafts} draft — not deployed\x1b[0m` : ''));
  console.log('  Ctrl-C to stop both.\n');
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
