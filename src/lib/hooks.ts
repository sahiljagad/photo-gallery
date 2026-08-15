import { useState, useEffect, useCallback } from 'react';
import type { Archive } from '../types';

// ── Hash routing ────────────────────────────────────────────────────

export interface Route {
  view: 'home' | 'album' | 'about';
  albumId?: string;
  photoIndex?: number;
}

function parseHash(): Route {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);

  if (parts[0] === 'a' && parts[1]) {
    const raw = parts[2];
    const index = raw != null ? parseInt(raw, 10) : NaN;
    return {
      view: 'album',
      albumId: decodeURIComponent(parts[1]),
      photoIndex: Number.isFinite(index) && index >= 0 ? index : undefined,
    };
  }
  if (parts[0] === 'about') return { view: 'about' };
  return { view: 'home' };
}

export function useHashRoute(): [Route, (hash: string) => void] {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  return [route, navigate];
}

/**
 * Return to the top when moving between pages, but not when opening or
 * closing the lightbox — that would throw away the reader's place in a
 * 120-frame album.
 */
export function useScrollReset(key: string) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [key]);
}

// ── Theme ───────────────────────────────────────────────────────────

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  });

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch {}
    setTheme(next);
  }, [theme]);

  return [theme, toggle];
}

// ── Archive fetch ───────────────────────────────────────────────────

export type ArchiveState =
  | { status: 'loading' }
  | { status: 'ready'; archive: Archive }
  | { status: 'error' };

export function useArchive(): ArchiveState {
  const [state, setState] = useState<ArchiveState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetch(`${import.meta.env.BASE_URL}photos.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`photos.json: ${r.status}`);
        return r.json();
      })
      .then((archive: Archive) => {
        if (!cancelled) setState({ status: 'ready', archive });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}
