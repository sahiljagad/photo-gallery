# Photo gallery

A static portfolio site for wildlife and landscape photography. Point it at a
folder of photographs; it generates responsive derivatives, reads capture
metadata, orders each album by visual flow, and builds a site.

No database, no server, no CMS. The whole archive is one `photos.json`.

## Commands

| Command | What it does |
|---|---|
| `npm run studio` | Dev server + photo watcher. The usual way to work. |
| `npm run dev` | Dev server only. |
| `npm run photos` | Rebuild `public/photos.json` and image derivatives. |
| `npm run add -- "Title" --from ~/path` | Import a folder as a new album, then build. |
| `npm run build` | Production build to `dist/`. |
| `npm run deploy` | Build and force-push `dist/` to `gh-pages`. |
| `npm test` | Vitest suite. |
| `npm run typecheck` | `tsc --noEmit`. |

## How albums work

Each directory under `photos/` is an album, named `YYYY-MM-DD_slug`:

```
photos/
  2025-07-06_glacier-national-park/
    glacier-001.jpg
    _meta.json          ← optional
    captions.json       ← generated on first build, never overwritten
```

Symlinks work, so the originals can stay wherever they live.

The **date in the folder name is only a fallback**. The real album date comes
from EXIF `DateTimeOriginal` — the earliest and latest frames give the album its
range. Folder dates record when files were copied, which in this archive was
off by days in every album and by a year in one.

### `_meta.json`

All fields optional:

```json
{
  "title": "Glacier National Park",
  "region": "Montana",
  "intro": "A short paragraph shown at the head of the album."
}
```

### `captions.json`

Generated on the first build with an entry per photograph, and **never
overwritten** — it is yours to edit.

```json
{
  "glacier-043": {
    "title": "Mountain Goat",
    "latin": "Oreamnos americanus",
    "note": "Optional longer note, shown in the viewer."
  }
}
```

## Naming and titles

Titles come from **filenames** first, then `captions.json` overrides:

| Filename | Result |
|---|---|
| `douro-sunset.jpg` | title "Douro Sunset" |
| `great-egret--ardea-alba.jpg` | title "Great Egret", latin "Ardea alba" |
| `01_opener.jpg` | title "Opener", **pinned** to position 1 |
| `glacier-066.jpg` | no title; trailing number is a tiebreak only |
| `DSC_3154.jpg` | no title (recognised camera filename) |

**Only the `NN_` prefix pins.** If *every* file in an album carries one, the
album is presented in exactly that order and sequencing is skipped. Trailing
export numbers do not pin — see [ALGORITHM.md](ALGORITHM.md) for why that
distinction matters.

## What the metadata can and cannot say

Every frame in this archive carries capture time, camera body, lens, focal
length, aperture, shutter and ISO. That is what the exhibition label under each
photograph in the viewer is built from.

Nothing carries **GPS** — neither the D3400 nor the D850 has a receiver, and
geotagging needs the GP-1A accessory or SnapBridge phone pairing. Nothing
carries **keywords, captions or titles** either.

So there is no way to derive a subject name like "Great Egret" from metadata,
and the build does not invent one. Subject titles are a human job:
`captions.json` is where they go. Where a photograph has no title, alt text
falls back to place and month rather than an empty string.

XMP **star ratings** are read where present. Where an album has a genuine
spread of ratings, the top-rated frames are the only candidates for its cover.

## Layout

```
build/
  add.mjs       import a folder as an album
  build.mjs     scan, derive, measure, sequence, write photos.json
  exif.mjs      EXIF/XMP extraction
  flow.mjs      the sequencing engine  → see ALGORITHM.md
  studio.mjs    dev server + watcher
  watch.mjs     photos/ watcher
  deploy.mjs    gh-pages deploy
src/
  components/   Masthead, Home, AlbumView, About, Picture, PhotoViewer
  lib/          photos (formatting/adapters), hooks (routing/theme/fetch), seo
  styles.css    the whole design system
```

Derivatives are written to `public/img/` at 640 / 1080 / 1600 / 2200px wide, in
both WebP and JPEG, plus a base64 LQIP placeholder inlined in `photos.json`.
Regeneration is incremental — outputs newer than their source are left alone.

## Design

Dark by default with a light theme toggle. Captions sit *below* their frames
rather than over them, because wildlife photographs generally need a caption to
land and covering the picture with it defeats the purpose. Imagery runs edge to
edge; text sits on a measure of about 62 characters.

The page title, description, Open Graph and Twitter cards update per album at
runtime (`src/lib/seo.ts`), and the build writes a 1200×630 `og-image.jpg` from
the newest album's cover so shared links preview with a photograph.

## Editing the About page

The bio, contact links and prints blurb are placeholder text in a single marked
block at the top of `src/components/About.tsx`. The counts below the text are
derived from `photos.json` at runtime — don't hard-code them.
