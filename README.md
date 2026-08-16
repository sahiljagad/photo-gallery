# Photo gallery

A static portfolio site for wildlife and landscape photography. You choose the
photographs; it generates responsive derivatives, reads capture metadata, orders
each album by visual flow, and builds a site.

No database, no server, no CMS. The whole archive is one `photos.json`.

**Nothing is published unless a manifest lists it.** That single rule is what
keeps the site curated and keeps private photographs off it — see
[How albums work](#how-albums-work).

## Commands

| Command | What it does |
|---|---|
| `npm run studio` | **The one you want.** Curation tool, site preview and watcher together. |
| `npm run curate` | Curation tool alone, on `127.0.0.1:4321`. |
| `npm run photos` | Rebuild derivatives and `photos.json` once. Add `-- --drafts` to include drafts. |
| `npm run deploy` | Rebuild without drafts and force-push `dist/` to `gh-pages`. |
| `npm run dev` | Vite dev server only, no photo processing. |
| `npm run build` | Production bundle to `dist/`. |
| `npm test` | Vitest suite. |
| `npm run typecheck` | `tsc --noEmit`. |

`studio` prints both URLs and rebuilds whenever a manifest is saved or the
library changes. Ctrl-C stops everything.

## How albums work

Two layers, deliberately independent.

**1. The library.** A folder of photographs outside the repo, one subfolder per
album. Point at it once in `photos.config.json` (gitignored, since the path is
machine-specific):

```json
{ "library": "~/Desktop/portfolio" }
```

Only copy photographs in here that you would consider publishing. Nothing else
in the pipeline can see anything outside this folder.

**2. The manifests.** One committed file per album in `albums/`, written by
`npm run curate`:

```json
{
  "id": "glacier-national-park",
  "source": "Glacier National Park",
  "title": "Glacier National Park",
  "region": "Montana",
  "intro": "A short paragraph shown at the head of the album.",
  "published": false,
  "cover": "glacier-043.jpg",
  "photos": [
    { "file": "glacier-043.jpg", "title": "Mountain Goat", "latin": "Oreamnos americanus" },
    { "file": "glacier-088.jpg" }
  ]
}
```

The `photos` array **is** the allowlist. A frame that is not listed is never
read, never resized, and never written to `photos.json` — absence, not a flag
anyone can forget to set. Reading the diff of one of these files tells you
exactly what changed about what is public.

- **`id`** is the URL slug. Avoid changing it once links exist.
- **`source`** is the folder in the library, and may be renamed freely.
- **`published: false`** builds the album locally so you can preview it, and
  excludes it from every deploy.
- **`cover`** is optional; without it the algorithm picks one.

Album dates come from EXIF `DateTimeOriginal`, earliest and latest frame giving
the range. Nothing is inferred from folder names.

Unpublishing a photograph **deletes its derivatives**. An orphaned file is not
clutter — it is an image nobody chose sitting in the directory the next deploy
copies from.

## Titles

Manifest captions win. Where a photograph has none, the filename is tried:

| Filename | Result |
|---|---|
| `douro-sunset.jpg` | title "Douro Sunset" |
| `great-egret--ardea-alba.jpg` | title "Great Egret", latin "Ardea alba" |
| `glacier-066.jpg` | no title — export numbering is not a title |
| `DSC_3154.jpg` | no title (recognised camera filename) |

Write titles in the curation tool: double-click any frame for a large preview
with title and note fields.

## What the metadata can and cannot say

Every frame in this archive carries capture time, camera body, lens, focal
length, aperture, shutter and ISO. That is what the exhibition label under each
photograph in the viewer is built from.

Nothing carries **GPS** — neither the D3400 nor the D850 has a receiver, and
geotagging needs the GP-1A accessory or SnapBridge phone pairing. Nothing
carries **keywords, captions or titles** either.

So there is no way to derive a subject name like "Great Egret" from metadata,
and the build does not invent one. Subject titles are a human job — the
curation tool is where they go. Where a photograph has no title, alt text falls
back to place and month rather than an empty string.

XMP **star ratings** are read where present, and weigh on cover selection where
an album has a genuine spread. They are not used for curation: across this
archive only one album of seven has a meaningful spread, so ratings cannot
carry that job.

## Layout

```
albums/         one manifest per album — the published set, committed
build/
  albums.mjs    manifests: read, write, validate
  library.mjs   locating the photo library
  curate.mjs    the curation server  (+ curate.html, its interface)
  build.mjs     derive, measure, sequence, write photos.json
  exif.mjs      EXIF/XMP extraction
  flow.mjs      the sequencing engine  → see ALGORITHM.md
  studio.mjs    curation tool + site + watcher, together
  watch.mjs     rebuilds on manifest or library changes
  deploy.mjs    gh-pages deploy, drafts excluded
src/
  components/   Masthead, Home, AlbumView, About, Picture, PhotoViewer
  lib/          photos (formatting/adapters), hooks (routing/theme/fetch), seo
  styles.css    the whole design system
```

Derivatives are written to `public/img/` at 640 / 1080 / 1600 / 2200px wide, in
both WebP and JPEG, plus a base64 LQIP placeholder inlined in `photos.json`.
Regeneration is incremental — outputs newer than their source are left alone.

`src/__tests__/manifest.test.ts` asserts the publish invariant against real
build output: every published photograph traces back to a manifest entry, and
no file survives in `public/img/` without one.

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
