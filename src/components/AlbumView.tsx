import { useRef, useEffect, useState, useCallback } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import type { Album } from '../types';
import { toLibraryPhoto, formatRange, exposureLine } from '../lib/photos';
import { Picture } from './Picture';
import { PhotoViewer } from './PhotoViewer';

interface AlbumViewProps {
  album: Album;
  photoIndex?: number;
  onNavigate: (hash: string) => void;
}

export function AlbumView({ album, photoIndex, onNavigate }: AlbumViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Unhide before measure (gotcha #5)
  useEffect(() => {
    setVisible(true);
    if (containerRef.current?.offsetWidth === 0) {
      requestAnimationFrame(() => setVisible(true));
    }
  }, [album.id]);

  const photos = album.photos.map((p) => toLibraryPhoto(p, album));

  const handleClick = useCallback(
    ({ index }: { index: number }) => {
      onNavigate(`#/a/${album.id}/${index}`);
    },
    [album.id, onNavigate],
  );

  const handleClose = useCallback(() => {
    onNavigate(`#/a/${album.id}`);
  }, [album.id, onNavigate]);

  const handleIndexChange = useCallback(
    (index: number) => {
      // replaceState so swiping doesn't fill the back stack
      history.replaceState(null, '', `#/a/${album.id}/${index}`);
    },
    [album.id],
  );

  return (
    <article className="album-view" ref={containerRef}>
      <div className="album-hero">
        <Picture photo={album.cover} album={album} sizes="100vw" priority />
      </div>

      <header className="album-header">
        <a
          className="back-link"
          href="#/"
          onClick={(e) => { e.preventDefault(); onNavigate('#/'); }}
        >
          <span aria-hidden="true">←</span> All work
        </a>
        <h1 className="album-title">{album.title}</h1>
        <p className="record album-record">
          {formatRange(album.date, album.dateEnd)}
          {album.region && ` · ${album.region}`}
          {` · ${album.photos.length} frames`}
          {album.cover.shot?.camera && ` · ${album.cover.shot.camera}`}
        </p>
        {album.intro && <p className="album-intro">{album.intro}</p>}
      </header>

      {visible && (
        <div className="album-grid">
          <RowsPhotoAlbum
            photos={photos}
            targetRowHeight={(containerWidth) =>
              Math.max(150, Math.min(containerWidth / 3.1, 420))
            }
            spacing={(containerWidth) => (containerWidth > 800 ? 8 : 4)}
            render={{
              image: (props, { photo }) => (
                <Picture
                  photo={(photo as any)._photo}
                  album={album}
                  imgProps={props}
                />
              ),
              extras: (_, { photo }) => {
                const p = (photo as any)._photo;
                const exposure = exposureLine(p);
                if (!p.title && !p.latin && !exposure) return null;
                return (
                  <div className="photo-caption" aria-hidden="true">
                    {p.title && <span className="caption-title">{p.title}</span>}
                    {p.latin && <span className="caption-latin"> <em>{p.latin}</em></span>}
                    {exposure && <span className="caption-exposure">{exposure}</span>}
                  </div>
                );
              },
            }}
            onClick={handleClick}
          />
        </div>
      )}

      {photoIndex != null && photoIndex < album.photos.length && (
        <PhotoViewer
          album={album}
          index={photoIndex}
          onClose={handleClose}
          onIndexChange={handleIndexChange}
        />
      )}
    </article>
  );
}
