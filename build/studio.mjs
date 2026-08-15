#!/usr/bin/env node
/**
 * studio.mjs — Runs Vite dev server + photos/ watcher in parallel.
 * Includes a Vite plugin that watches public/photos.json and triggers
 * a full-reload (Vite doesn't watch public/ by default).
 */

import { createServer } from 'vite';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { watchPhotos } from './watch.mjs';

const PHOTOS_JSON = join(import.meta.dirname, '..', 'public', 'photos.json');

/** Vite plugin: watch public/photos.json → full-reload. */
function photosReloadPlugin() {
  return {
    name: 'photos-reload',
    configureServer(server) {
      if (!existsSync(PHOTOS_JSON)) return;

      watch(PHOTOS_JSON, () => {
        console.log('[studio] photos.json changed, reloading...');
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

async function run() {
  // Start photos watcher
  watchPhotos();

  // Start Vite dev server with the reload plugin
  const server = await createServer({
    plugins: [photosReloadPlugin()],
    server: { open: true },
  });

  await server.listen();
  server.printUrls();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
