import type { Archive, Album } from '../types';
import { formatRange } from '../lib/photos';
import { Picture } from './Picture';

interface HomeProps {
  archive: Archive;
  onNavigate: (hash: string) => void;
}

export function Home({ archive, onNavigate }: HomeProps) {
  if (archive.length === 0) {
    return (
      <section className="home empty-home">
        <p>No albums yet.</p>
        <p className="empty-hint">
          Run <code>npm run add -- "Title" --from ~/path/to/photos</code> to get started.
        </p>
      </section>
    );
  }

  const [featured, ...rest] = archive;

  return (
    <div className="home">
      <AlbumHero album={featured} onNavigate={onNavigate} />

      {rest.length > 0 && (
        <section className="index" aria-labelledby="index-heading">
          <h2 className="section-label" id="index-heading">Archive</h2>
          <div className="index-grid">
            {rest.map((album) => (
              <AlbumCard key={album.id} album={album} onNavigate={onNavigate} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The establishing shot. Runs edge to edge — this is the one place on the
 * index where a landscape gets the full width it was made for.
 */
function AlbumHero({ album, onNavigate }: { album: Album; onNavigate: (h: string) => void }) {
  return (
    <section className="hero">
      <a
        className="hero-link"
        href={`#/a/${album.id}`}
        onClick={(e) => { e.preventDefault(); onNavigate(`#/a/${album.id}`); }}
        aria-label={`${album.title}, ${album.photos.length} photographs`}
      >
        <div className="hero-frame">
          <Picture photo={album.cover} album={album} sizes="100vw" priority />
        </div>
        <div className="hero-caption">
          <p className="eyebrow">Latest</p>
          <h1 className="hero-title">{album.title}</h1>
          <p className="record">
            {formatRange(album.date, album.dateEnd)}
            {album.region && ` · ${album.region}`}
            {` · ${album.photos.length} frames`}
          </p>
        </div>
      </a>
    </section>
  );
}

/** Caption sits below the frame, never over it. */
function AlbumCard({ album, onNavigate }: { album: Album; onNavigate: (h: string) => void }) {
  return (
    <a
      className="card"
      href={`#/a/${album.id}`}
      onClick={(e) => { e.preventDefault(); onNavigate(`#/a/${album.id}`); }}
    >
      <figure className="card-frame">
        <Picture
          photo={album.cover}
          album={album}
          sizes="(max-width: 800px) 100vw, 50vw"
        />
      </figure>
      <h3 className="card-title">{album.title}</h3>
      <p className="record">
        {formatRange(album.date, album.dateEnd)}
        {album.region && ` · ${album.region}`}
        {` · ${album.photos.length} frames`}
      </p>
    </a>
  );
}
