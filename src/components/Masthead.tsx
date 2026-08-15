import type { Route } from '../lib/hooks';
import { SITE_NAME } from '../lib/seo';

interface MastheadProps {
  theme: string;
  route: Route;
  onToggleTheme: () => void;
  onNavigate: (hash: string) => void;
}

export function Masthead({ theme, route, onToggleTheme, onNavigate }: MastheadProps) {
  const go = (hash: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    onNavigate(hash);
  };

  return (
    <header className="masthead">
      <a className="masthead-title" href="#/" onClick={go('#/')}>
        {SITE_NAME}
      </a>

      <nav className="masthead-nav" aria-label="Primary">
        <a
          href="#/"
          onClick={go('#/')}
          className={route.view === 'home' || route.view === 'album' ? 'is-current' : ''}
          aria-current={route.view === 'home' ? 'page' : undefined}
        >
          Work
        </a>
        <a
          href="#/about"
          onClick={go('#/about')}
          className={route.view === 'about' ? 'is-current' : ''}
          aria-current={route.view === 'about' ? 'page' : undefined}
        >
          About
        </a>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀︎' : '☾︎'}
        </button>
      </nav>
    </header>
  );
}
