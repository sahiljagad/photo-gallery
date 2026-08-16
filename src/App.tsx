import { useEffect } from 'react';
import { useHashRoute, useTheme, useArchive, useScrollReset } from './lib/hooks';
import { applySeo, albumSeo, SITE_NAME, SITE_TAGLINE } from './lib/seo';
import { Masthead } from './components/Masthead';
import { Home } from './components/Home';
import { AlbumView } from './components/AlbumView';
import { About } from './components/About';

export function App() {
  const [route, navigate] = useHashRoute();
  const [theme, toggleTheme] = useTheme();
  const state = useArchive();

  const archive = state.status === 'ready' ? state.archive : [];
  const album =
    route.view === 'album' ? archive.find((a) => a.id === route.albumId) : undefined;

  // Scroll to top when the page changes, but not when opening a photo
  useScrollReset(`${route.view}:${route.albumId ?? ''}`);

  useEffect(() => {
    if (state.status !== 'ready') return;
    if (album) {
      albumSeo(album);
    } else if (route.view === 'about') {
      applySeo({
        title: 'About',
        description: `About ${SITE_NAME} — ${SITE_TAGLINE.toLowerCase()}.`,
        image: archive[0]?.cover.src,
        path: '#/about',
      });
    } else {
      applySeo({
        title: SITE_NAME,
        description: `${SITE_TAGLINE} by ${SITE_NAME}.`,
        image: archive[0]?.cover.src,
        path: '#/',
      });
    }
  }, [state.status, route.view, album, archive]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Masthead
        theme={theme}
        route={route}
        onToggleTheme={toggleTheme}
        onNavigate={navigate}
      />

      <main id="main" tabIndex={-1}>
        {state.status === 'loading' && (
          <div className="status" role="status" aria-live="polite">
            <p>Loading&hellip;</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="status">
            <p>The archive could not be loaded.</p>
            <p className="status-hint">
              Run <code>npm run photos</code> to build it, then reload.
            </p>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            {route.view === 'home' && <Home archive={archive} onNavigate={navigate} />}
            {route.view === 'about' && <About />}
            {route.view === 'album' && album && (
              <AlbumView
                album={album}
                photoIndex={route.photoIndex}
                onNavigate={navigate}
              />
            )}
            {route.view === 'album' && !album && (
              <div className="status">
                <p>That album doesn't exist.</p>
                <button className="button" onClick={() => navigate('#/')}>
                  All work
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <p>© {new Date().getFullYear()} {SITE_NAME}</p>
      </footer>
    </>
  );
}
