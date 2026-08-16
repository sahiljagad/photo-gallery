#!/usr/bin/env node
/**
 * curate.mjs — the local selection tool. `npm run curate`
 *
 * A small HTTP server on localhost that shows every folder in your library as
 * a contact sheet and lets you choose what gets published. It writes album
 * manifests and nothing else: it never uploads, never deploys, and never
 * touches your originals.
 *
 * It binds to 127.0.0.1 deliberately. This tool can read every photograph in
 * your library, so it must not be reachable from the network.
 */

import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  loadConfig, listLibraryFolders, listSourceFiles, photoPath,
} from './library.mjs';
import {
  readAllManifests, readManifest, writeManifest, emptyManifest,
  validateManifest, selectedPhotos, slugify,
} from './albums.mjs';

const ROOT = join(import.meta.dirname, '..');
const THUMB_DIR = join(ROOT, '.thumbs');
const PORT = Number(process.env.PORT) || 4321;

/** Rough published weight per photo: 4 WebP widths, measured off the archive. */
const MB_PER_PHOTO = 0.85;

// ── Thumbnails ──────────────────────────────────────────────────────

/**
 * 320px WebP thumbnails, cached on disk. The cache key includes source mtime
 * so re-editing a photograph in Lightroom invalidates its thumbnail without
 * anyone having to remember to clear anything.
 */
async function thumbnail(source, file, size = 320) {
  const src = await photoPath(source, file);
  const { mtimeMs } = await stat(src);
  const key = createHash('sha1').update(`${source}/${file}/${mtimeMs}/${size}`).digest('hex').slice(0, 16);
  const out = join(THUMB_DIR, `${key}.webp`);

  if (!existsSync(out)) {
    await mkdir(THUMB_DIR, { recursive: true });
    await sharp(src).rotate().resize(size, size, { fit: 'inside' }).webp({ quality: size > 600 ? 82 : 70 }).toFile(out);
  }
  return readFile(out);
}

// ── State assembly ──────────────────────────────────────────────────

async function albumList() {
  const folders = await listLibraryFolders();
  const manifests = await readAllManifests();
  const bySource = new Map(manifests.map((m) => [m.source, m]));

  return folders.map((f) => {
    const m = bySource.get(f.source);
    return {
      source: f.source,
      total: f.count,
      id: m?.id ?? slugify(f.source),
      title: m?.title ?? null,
      selected: m ? selectedPhotos(m).length : 0,
      published: m?.published ?? false,
      exists: Boolean(m),
    };
  });
}

/**
 * Aspect ratios, cached in memory by path+mtime.
 *
 * The contact sheet lays out justified rows the way the site does, which
 * needs each frame's true shape up front. sharp reads only the header here,
 * so 80 frames costs a few hundred milliseconds once and nothing after.
 */
const arCache = new Map();

async function aspectRatio(source, file) {
  const path = await photoPath(source, file);
  const { mtimeMs } = await stat(path);
  const key = `${path}:${mtimeMs}`;
  if (arCache.has(key)) return arCache.get(key);

  let ar = 1.5;
  try {
    const m = await sharp(path).metadata();
    if (m.width && m.height) {
      // orientation 5–8 mean the frame is stored rotated
      const swap = m.orientation >= 5 && m.orientation <= 8;
      ar = swap ? m.height / m.width : m.width / m.height;
    }
  } catch {}
  arCache.set(key, ar);
  return ar;
}

async function albumDetail(source) {
  const files = await listSourceFiles(source);
  const manifests = await readAllManifests();
  const manifest = manifests.find((m) => m.source === source) ?? emptyManifest(source);
  const chosen = selectedPhotos(manifest);
  const order = new Map(chosen.map((p, i) => [p.file, i]));
  const meta = new Map(chosen.map((p) => [p.file, p]));

  return {
    manifest: {
      id: manifest.id,
      source: manifest.source,
      title: manifest.title,
      region: manifest.region,
      intro: manifest.intro,
      published: manifest.published,
      cover: manifest.cover,
    },
    files: await Promise.all(
      files.map(async (file) => ({
        file,
        ar: await aspectRatio(source, file),
        selected: order.has(file),
        position: order.get(file) ?? null,
        title: meta.get(file)?.title ?? null,
        note: meta.get(file)?.note ?? null,
      })),
    ),
  };
}

// ── Server ──────────────────────────────────────────────────────────

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  try {
    if (path === '/') {
      return send(res, 200, await readFile(join(import.meta.dirname, 'curate.html')), 'text/html; charset=utf-8');
    }

    if (path === '/api/albums') {
      const { library } = await loadConfig();
      return send(res, 200, {
        albums: await albumList(),
        mbPerPhoto: MB_PER_PHOTO,
        library: library.replace(process.env.HOME ?? '', '~'),
      });
    }

    if (path === '/api/album') {
      return send(res, 200, await albumDetail(url.searchParams.get('source')));
    }

    if (path === '/api/thumb') {
      const size = Math.min(2000, Number(url.searchParams.get('size')) || 320);
      const buf = await thumbnail(url.searchParams.get('source'), url.searchParams.get('file'), size);
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' });
      return res.end(buf);
    }

    if (path === '/api/save' && req.method === 'POST') {
      const body = await readBody(req);
      const files = await listSourceFiles(body.source);

      const manifest = {
        id: body.id,
        source: body.source,
        title: body.title || null,
        region: body.region || null,
        intro: body.intro || null,
        published: Boolean(body.published),
        cover: body.cover || null,
        // Preserve the order the grid presents them in
        photos: body.photos.map((p) =>
          p.title || p.note ? { file: p.file, title: p.title || null, note: p.note || null } : { file: p.file },
        ),
      };

      const errors = validateManifest(manifest, files);
      if (errors.length) return send(res, 400, { errors });

      await writeManifest(manifest);
      return send(res, 200, { ok: true, path: `albums/${manifest.id}.json`, count: manifest.photos.length });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

const cfg = await loadConfig();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Curate — http://127.0.0.1:${PORT}`);
  console.log(`  Library: ${cfg.library}`);
  if (cfg.ignore?.length) console.log(`  Hidden:  ${cfg.ignore.join(', ')}`);
  console.log(`\n  Writes album manifests only. Never uploads, never deploys.\n`);
});
