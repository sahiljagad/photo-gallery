/// <reference types="vitest/globals" />
import { render, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App';
import type { Archive, Album } from '../types';
import { formatRange, altText, exposureLine } from '../lib/photos';

let archive: Archive;

// Load real photos.json (not a fixture)
beforeAll(async () => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const raw = fs.readFileSync(
      path.resolve(__dirname, '../../public/photos.json'),
      'utf8',
    );
    archive = JSON.parse(raw);
  } catch {
    archive = [];
  }
});

// Mock fetch to return real photos.json
beforeEach(() => {
  window.location.hash = '#/';

  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(archive),
  });

  // Mock offsetWidth for react-photo-album container measurement (jsdom returns 0)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() { return 1200; },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return 800; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 1200; },
  });
});

function getLargestAlbum(): Album | undefined {
  if (archive.length === 0) return undefined;
  return archive.reduce((a, b) => (a.photos.length >= b.photos.length ? a : b));
}

describe('Gallery', () => {
  it('renders the archive once loaded', async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector('.home, .status')).toBeTruthy();
    });
  });

  it('home leads with a hero and lists the remaining albums', async () => {
    if (archive.length === 0) return;

    render(<App />);
    await waitFor(() => {
      expect(document.querySelector('.hero')).toBeTruthy();
    });

    expect(document.querySelector('.hero-title')?.textContent).toBe(archive[0].title);
    expect(document.querySelectorAll('.index-grid .card').length).toBe(archive.length - 1);
  });

  it('album view renders with correct title', async () => {
    const album = getLargestAlbum();
    if (!album) return;

    window.location.hash = `#/a/${album.id}`;
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.album-view')).toBeTruthy();
    });

    expect(document.querySelector('.album-title')?.textContent).toBe(album.title);
  });

  it('clicking a tile opens the lightbox', async () => {
    const album = getLargestAlbum();
    if (!album || album.photos.length === 0) return;

    window.location.hash = `#/a/${album.id}/0`;
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.yarl__root')).toBeTruthy();
    });

    expect(window.location.hash).toContain(`#/a/${album.id}/`);
  });

  it('the lightbox shows an exhibition label with capture details', async () => {
    const album = archive.find((a) => a.photos.some((p) => p.shot?.camera));
    if (!album) return;

    const index = album.photos.findIndex((p) => p.shot?.camera);
    window.location.hash = `#/a/${album.id}/${index}`;
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.shot-label')).toBeTruthy();
    });

    const photo = album.photos[index];

    // The carousel preloads neighbours, so several labels are in the DOM at
    // once. Find the one belonging to this frame rather than the first.
    const labels = [...document.querySelectorAll('.shot-label')];
    const label = labels.find(
      (el) => el.querySelector('.shot-tech')?.textContent === exposureLine(photo),
    );

    expect(label, 'no label matched the opened frame').toBeTruthy();
    // Equipment and exposure are deliberately separate lines
    expect(label!.querySelector('.shot-gear')?.textContent).toContain(photo.shot!.camera!);
  });

  it('an out-of-range photo index does not open the lightbox', async () => {
    const album = getLargestAlbum();
    if (!album) return;

    window.location.hash = `#/a/${album.id}/99999`;
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.album-view')).toBeTruthy();
    });
    expect(document.querySelector('.yarl__root')).toBeNull();
  });

  it('about page renders with contact details', async () => {
    window.location.hash = '#/about';
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.about')).toBeTruthy();
    });

    expect(document.querySelectorAll('.about-links a').length).toBeGreaterThan(0);
  });

  it('back navigation returns to home', async () => {
    const album = getLargestAlbum();
    if (!album) return;

    window.location.hash = `#/a/${album.id}`;
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.album-view')).toBeTruthy();
    });

    const back = document.querySelector('.back-link');
    expect(back).toBeTruthy();
    fireEvent.click(back!);

    expect(window.location.hash).toBe('#/');
  });

  it('an unknown album id shows a recovery route home', async () => {
    window.location.hash = '#/a/does-not-exist';
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.status')).toBeTruthy();
    });
    expect(document.querySelector('.status .button')).toBeTruthy();
  });
});

describe('Archive data', () => {
  it('every size has a loadable src and sane dimensions', () => {
    for (const album of archive) {
      for (const photo of album.photos) {
        expect(photo.sizes.length).toBeGreaterThan(0);
        for (const size of photo.sizes) {
          // `src` is what a plain <img> loads, so it must always resolve.
          // `srcWebp` is the <source> and may be absent at a given width.
          expect(size.src).toMatch(/\.(jpg|webp)$/);
          if (size.srcWebp) expect(size.srcWebp).toMatch(/\.webp$/);
          expect(size.width).toBeGreaterThan(0);
          expect(size.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the smallest width keeps a JPEG, so <picture> degrades to a real image', () => {
    for (const album of archive) {
      for (const photo of album.photos) {
        const smallest = photo.sizes[0];
        expect(smallest.src, `${photo.id} has no JPEG fallback`).toMatch(/\.jpg$/);
      }
    }
  });

  it('no file is advertised at two different widths in a srcset', () => {
    for (const album of archive) {
      for (const photo of album.photos) {
        const srcs = new Map<string, number>();
        for (const size of photo.sizes) {
          for (const file of [size.src, size.srcWebp]) {
            if (!file) continue;
            if (srcs.has(file)) expect(srcs.get(file)).toBe(size.width);
            srcs.set(file, size.width);
          }
        }
      }
    }
  });

  it('every photo carries measurements and a valid lqip data URI', () => {
    for (const album of archive) {
      for (const photo of album.photos) {
        expect(typeof photo.lightness).toBe('number');
        expect(typeof photo.contrast).toBe('number');
        expect(typeof photo.hue).toBe('number');
        expect(typeof photo.chroma).toBe('number');
        expect(typeof photo.colourfulness).toBe('number');
        expect(typeof photo.busy).toBe('number');
        expect(typeof photo.busyRel).toBe('number');
        expect(typeof photo.massX).toBe('number');
        expect(typeof photo.massY).toBe('number');
        expect(['left', 'right', 'centre']).toContain(photo.weight);
        expect(photo.lqip).toMatch(/^data:image\/jpeg;base64,/);
      }
    }
  });

  it('sequencing assigns contiguous order indices', () => {
    for (const album of archive) {
      if (album.photos.length < 4) continue;
      for (let i = 0; i < album.photos.length; i++) {
        expect(album.photos[i].order).toBe(i);
      }
    }
  });

  it('album dates come from capture time, not file mtime', () => {
    for (const album of archive) {
      const stamps = album.photos.map((p) => p.shot?.takenAt).filter(Boolean).sort();
      if (stamps.length === 0) continue;
      expect(album.date).toBe(stamps[0]!.slice(0, 10));
      expect(album.dateEnd).toBe(stamps[stamps.length - 1]!.slice(0, 10));
    }
  });

  it('albums are ordered newest first', () => {
    for (let i = 1; i < archive.length; i++) {
      expect(archive[i - 1].date >= archive[i].date).toBe(true);
    }
  });

  it('every photo carries readable capture metadata', () => {
    for (const album of archive) {
      for (const photo of album.photos) {
        expect(photo.shot?.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      }
    }
  });

  it('the cover belongs to its own album', () => {
    for (const album of archive) {
      expect(album.photos.some((p) => p.id === album.cover.id)).toBe(true);
    }
  });

  it('no internal build fields leak into the payload', () => {
    for (const album of archive) {
      for (const photo of album.photos) {
        expect(photo).not.toHaveProperty('pinned');
        expect(photo).not.toHaveProperty('seq');
      }
    }
  });
});

describe('Formatting', () => {
  it('collapses a same-month range', () => {
    expect(formatRange('2025-07-02', '2025-07-04')).toBe('2–4 July 2025');
  });

  it('renders a single date when there is no range', () => {
    expect(formatRange('2025-07-02')).toBe('2 July 2025');
    expect(formatRange('2025-07-02', '2025-07-02')).toBe('2 July 2025');
  });

  it('does not shift the day into the local timezone', () => {
    // `new Date('2025-01-01')` parses as UTC midnight and renders as the
    // previous day west of Greenwich; the formatter must not do that.
    expect(formatRange('2025-01-01')).toBe('1 January 2025');
  });

  it('builds an exposure line from whatever is present', () => {
    expect(
      exposureLine({ shot: { focal: 500, aperture: 5.6, shutter: '1/200', iso: 1000 } } as any),
    ).toBe('500mm · f/5.6 · 1/200 · ISO 1000');
    expect(exposureLine({ shot: { iso: 64 } } as any)).toBe('ISO 64');
    expect(exposureLine({} as any)).toBe('');
  });

  it('describes untitled photographs without inventing a subject', () => {
    const photo = { title: null, shot: { takenAt: '2025-07-04T15:42:18' } } as any;
    const album = { title: 'Glacier National Park' } as any;
    const alt = altText(photo, album);
    expect(alt).toContain('Glacier National Park');
    expect(alt).toContain('July 2025');
  });

  it('prefers a real title when one exists', () => {
    const photo = { title: 'Great Egret', latin: 'Ardea alba' } as any;
    expect(altText(photo, {} as any)).toBe('Great Egret (Ardea alba)');
  });
});
