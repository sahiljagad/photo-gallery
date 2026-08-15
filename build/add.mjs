#!/usr/bin/env node
/**
 * add.mjs — One-command album import.
 * Usage: npm run add -- "Portugal" --from ~/Desktop/export
 */

import { readdir, stat, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { build } from './build.mjs';

const PHOTOS_DIR = join(import.meta.dirname, '..', 'photos');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp']);
const ALBUM_RE = /^(\d{4}-\d{2}-\d{2})[_ -]+(.+)$/;

function parseArgs() {
  const args = process.argv.slice(2);
  let title = null;
  let from = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      from = args[++i];
    } else if (!title) {
      title = args[i];
    }
  }

  if (!title || !from) {
    console.error('Usage: npm run add -- "Album Title" --from /path/to/photos');
    process.exit(1);
  }

  return { title, from };
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function findExistingAlbum(title) {
  if (!existsSync(PHOTOS_DIR)) return null;
  const slug = slugify(title);
  const entries = await readdir(PHOTOS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(ALBUM_RE);
    if (match && slugify(match[2]) === slug) return entry.name;
  }
  return null;
}

async function run() {
  const { title, from } = parseArgs();

  // Validate source directory
  if (!existsSync(from)) {
    console.error(`Source directory not found: ${from}`);
    process.exit(1);
  }

  // List image files
  const files = (await readdir(from)).filter((f) =>
    IMAGE_EXTS.has(extname(f).toLowerCase()),
  );
  if (files.length === 0) {
    console.error('No image files found in source directory.');
    process.exit(1);
  }

  // Find or create album directory
  let albumDir;
  const existing = await findExistingAlbum(title);

  if (existing) {
    albumDir = join(PHOTOS_DIR, existing);
    console.log(`Adding to existing album: ${existing}`);
  } else {
    // Infer date from earliest file mtime
    let earliest = Infinity;
    for (const f of files) {
      const s = await stat(join(from, f));
      if (s.mtimeMs < earliest) earliest = s.mtimeMs;
    }
    const date = new Date(earliest).toISOString().slice(0, 10);
    const albumId = `${date}_${slugify(title)}`;
    albumDir = join(PHOTOS_DIR, albumId);
    await mkdir(albumDir, { recursive: true });
    console.log(`Created album: ${albumId}`);

    // Create _meta.json (never overwrite existing)
    const metaPath = join(albumDir, '_meta.json');
    if (!existsSync(metaPath)) {
      await writeFile(metaPath, JSON.stringify({ title }, null, 2));
    }
  }

  // Copy files, skipping those already present by name+size
  let copied = 0, skipped = 0;
  for (const f of files) {
    const destPath = join(albumDir, f);
    const srcPath = join(from, f);

    if (existsSync(destPath)) {
      const srcStat = await stat(srcPath);
      const destStat = await stat(destPath);
      if (srcStat.size === destStat.size) {
        skipped++;
        continue;
      }
    }

    await copyFile(srcPath, destPath);
    copied++;
  }

  console.log(`Copied ${copied} files, skipped ${skipped} duplicates.`);

  // Run the build pipeline
  console.log('\nRunning build pipeline...');
  await build();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
