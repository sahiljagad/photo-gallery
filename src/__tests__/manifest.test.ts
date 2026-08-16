/// <reference types="vitest/globals" />
/**
 * The publish invariant.
 *
 *     Nothing reaches the site unless a manifest lists it.
 *
 * Everything else in the design assumes this holds, so it is asserted against
 * the real build output rather than a fixture. If someone reintroduces a glob,
 * widens a filter, or breaks orphan pruning, these fail.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
// @ts-expect-error — plain JS build module, no types
import { validateManifest, selectedPhotos } from '../../build/albums.mjs';

const ROOT = resolve(__dirname, '../../');
const ALBUMS_DIR = join(ROOT, 'albums');
const IMG_DIR = join(ROOT, 'public', 'img');
const PHOTOS_JSON = join(ROOT, 'public', 'photos.json');

interface Manifest {
  id: string;
  source: string;
  published: boolean;
  cover: string | null;
  photos: ({ file: string } | string)[];
}

function readManifests(): Manifest[] {
  if (!existsSync(ALBUMS_DIR)) return [];
  return readdirSync(ALBUMS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => JSON.parse(readFileSync(join(ALBUMS_DIR, f), 'utf8')));
}

function readArchive(): any[] {
  if (!existsSync(PHOTOS_JSON)) return [];
  return JSON.parse(readFileSync(PHOTOS_JSON, 'utf8'));
}

const manifests = readManifests();
const archive = readArchive();
const byId = new Map(manifests.map((m) => [m.id, m]));

describe('the publish invariant', () => {
  it('every published album has a manifest behind it', () => {
    for (const album of archive) {
      expect(byId.has(album.id), `album "${album.id}" is in photos.json with no manifest`).toBe(true);
    }
  });

  it('every published photograph is listed in its manifest', () => {
    for (const album of archive) {
      const manifest = byId.get(album.id);
      if (!manifest) continue;
      const allowed = new Set(selectedPhotos(manifest).map((p: any) => p.file));

      for (const photo of album.photos) {
        expect(
          allowed.has(photo.file),
          `"${photo.file}" is published in "${album.id}" but is not in its manifest`,
        ).toBe(true);
      }
    }
  });

  it('publishes exactly the selection, nothing more and nothing less', () => {
    for (const album of archive) {
      const manifest = byId.get(album.id);
      if (!manifest) continue;
      expect(album.photos.length).toBe(selectedPhotos(manifest).length);
    }
  });

  it('an album with an empty selection publishes nothing', () => {
    for (const m of manifests) {
      if (selectedPhotos(m).length > 0) continue;
      expect(
        archive.find((a) => a.id === m.id),
        `"${m.id}" has an empty selection but appears in photos.json`,
      ).toBeUndefined();
    }
  });

  it('the cover is one of the album\'s own published photographs', () => {
    for (const album of archive) {
      expect(album.photos.some((p: any) => p.id === album.cover.id)).toBe(true);
    }
  });

  it('an explicit cover choice is honoured', () => {
    for (const album of archive) {
      const manifest = byId.get(album.id);
      if (!manifest?.cover) continue;
      expect(album.cover.file).toBe(manifest.cover);
    }
  });
});

describe('no orphans on disk', () => {
  // Unpublishing has to delete the files. An image left behind in public/img
  // is copied into dist/ by the next build — a leak, not untidiness.
  const referenced = new Set<string>();
  for (const album of archive) {
    for (const photo of album.photos) {
      for (const size of photo.sizes) { referenced.add(size.src); referenced.add(size.srcWebp); }
    }
  }

  it('every file under public/img belongs to a published photograph', () => {
    if (!existsSync(IMG_DIR)) return;
    const strays: string[] = [];

    for (const dir of readdirSync(IMG_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const file of readdirSync(join(IMG_DIR, dir.name))) {
        const rel = `img/${dir.name}/${file}`;
        if (!referenced.has(rel)) strays.push(rel);
      }
    }

    expect(strays, `orphaned derivative(s) still on disk:\n  ${strays.join('\n  ')}`).toEqual([]);
  });

  it('there is no image directory for an album that is not published', () => {
    if (!existsSync(IMG_DIR)) return;
    const published = new Set(archive.map((a) => a.id));
    const dirs = readdirSync(IMG_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !published.has(name));

    expect(dirs, `image folder(s) for unpublished album(s): ${dirs.join(', ')}`).toEqual([]);
  });
});

describe('manifest validation', () => {
  const base = { id: 'x', source: 'X', published: true, cover: null, photos: [] as any[] };
  const onDisk = ['a.jpg', 'b.jpg', 'c.jpg'];

  it('accepts a manifest whose files all exist', () => {
    expect(validateManifest({ ...base, photos: [{ file: 'a.jpg' }, { file: 'b.jpg' }] }, onDisk)).toEqual([]);
  });

  it('rejects a file that is no longer on disk', () => {
    const errs = validateManifest({ ...base, photos: [{ file: 'gone.jpg' }] }, onDisk);
    expect(errs.join(' ')).toMatch(/gone\.jpg.*missing/);
  });

  it('rejects the same file listed twice', () => {
    const errs = validateManifest({ ...base, photos: [{ file: 'a.jpg' }, { file: 'a.jpg' }] }, onDisk);
    expect(errs.join(' ')).toMatch(/listed more than once/);
  });

  it('rejects a cover that is not in the selection', () => {
    const errs = validateManifest({ ...base, cover: 'c.jpg', photos: [{ file: 'a.jpg' }] }, onDisk);
    expect(errs.join(' ')).toMatch(/cover .* is not in the selection/);
  });

  it('rejects a manifest with no source', () => {
    const { source, ...noSource } = base;
    expect(validateManifest(noSource, onDisk).join(' ')).toMatch(/missing "source"/);
  });

  it('treats a bare string entry as a file reference', () => {
    expect(validateManifest({ ...base, photos: ['a.jpg'] }, onDisk)).toEqual([]);
  });
});
