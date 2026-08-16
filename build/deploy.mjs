#!/usr/bin/env node
/**
 * deploy.mjs — build the published albums and upload the site.
 *
 * Uploads by direct upload rather than connecting the repo to a Git build.
 * A Git-connected build would run on Cloudflare's machines, where your photo
 * library does not exist — the images are generated here, from originals that
 * never leave this computer, so the artifact has to be built here too.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from './build.mjs';
import { loadConfig } from './library.mjs';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

async function dirSize(dir) {
  let bytes = 0, files = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await dirSize(p);
      bytes += sub.bytes; files += sub.files;
    } else {
      bytes += (await stat(p)).size; files++;
    }
  }
  return { bytes, files };
}

function haveWrangler() {
  return spawnSync('npx', ['--no-install', 'wrangler', '--version'], { encoding: 'utf8' }).status === 0;
}

async function run() {
  const config = await loadConfig();
  const project = config.pagesProject ?? 'photo-gallery';

  // Rebuild without drafts. This is the only guarantee that a previewed
  // draft's assets are absent from dist/ — pruning deletes everything outside
  // the published set.
  console.log('Building published albums only...\n');
  const archive = await build({ includeDrafts: false });

  if (archive.length === 0) {
    console.error('\nNothing is published. Mark an album Published in `npm run curate` first.');
    process.exit(1);
  }

  const photos = archive.reduce((n, a) => n + a.photos.length, 0);
  console.log(`\nPublishing ${archive.length} album(s), ${photos} photograph(s):`);
  for (const a of archive) console.log(`   ${a.title} — ${a.photos.length}`);

  // Clear dist ourselves. Vite's emptyOutDir deliberately skips dotfiles so it
  // cannot destroy a repository, which meant a .git left by the old gh-pages
  // mechanism survived every rebuild — 960 MB of history that would have been
  // uploaded along with the site.
  await rm(DIST, { recursive: true, force: true });

  console.log('\nBundling...');
  execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

  const { bytes, files } = await dirSize(DIST);
  const mb = (bytes / 1048576).toFixed(1);
  console.log(`\ndist/ is ${mb} MB across ${files} files.`);
  if (files > 20000) console.warn('   ⚠ Cloudflare Pages allows 20,000 files per deployment.');

  if (!haveWrangler()) {
    console.log(`
Wrangler is not installed yet. To deploy:

  npx wrangler login                       one-off, opens a browser
  npx wrangler pages deploy dist --project-name=${project}

Nothing has been uploaded. dist/ is built and ready.`);
    return;
  }

  await upload(project);
}

/**
 * Upload, retrying on network failure.
 *
 * Wrangler uploads many files concurrently and the connection tends to drop
 * with EPIPE partway through a large batch — reliably somewhere past three
 * hundred files, regardless of how big the payload is. Every attempt keeps its
 * progress though, because Pages deduplicates by content hash and skips what
 * it already has. So the fix is simply to keep going: each pass starts from
 * where the last one died, and the run is idempotent by construction.
 */
async function upload(project, attempts = 8) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    console.log(`\nUploading to Cloudflare Pages${attempt > 1 ? ` — attempt ${attempt}/${attempts}` : ''}...\n`);

    const result = spawnSync(
      'npx',
      ['wrangler', 'pages', 'deploy', 'dist', `--project-name=${project}`, '--commit-dirty=true'],
      { cwd: ROOT, stdio: 'inherit' },
    );

    if (result.status === 0) {
      console.log('\n✅ Deployed.');
      return;
    }

    if (attempt === attempts) {
      throw new Error(
        `Upload failed after ${attempts} attempts. Files already uploaded are kept, ` +
        'so running `npm run deploy` again will resume rather than start over.',
      );
    }

    const wait = Math.min(5 + attempt * 3, 20);
    console.log(`\n   connection dropped — resuming in ${wait}s (uploaded files are kept)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

run().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
