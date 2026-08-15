import { useCallback, useRef } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import type { Album, Photo } from '../types';
import { toSlide, buildSrcSet, imgUrl, altText, exposureLine, gearLine, shotDate } from '../lib/photos';

interface PhotoViewerProps {
  album: Album;
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

/**
 * The exhibition label.
 *
 * This library has no keywords, captions or GPS — but every frame carries the
 * body, lens and exposure it was made with, which is exactly what a print
 * label in a gallery would state. It is the most substantial thing the
 * metadata can honestly say about a photograph.
 */
function ShotLabel({ photo, album }: { photo: Photo; album: Album }) {
  const exposure = exposureLine(photo);
  const gear = gearLine(photo);
  const date = shotDate(photo);
  const place = album.region || album.title;

  if (!photo.title && !exposure && !gear) return null;

  return (
    <figcaption className="shot-label">
      {photo.title && (
        <h2 className="shot-title">
          {photo.title}
          {photo.latin && <em className="shot-latin"> {photo.latin}</em>}
        </h2>
      )}
      <p className="shot-line">
        {[place, date].filter(Boolean).join(' · ')}
      </p>
      {/* Exposure and equipment stay on separate lines. Run together, a zoom's
          maximum aperture sits next to the aperture actually used and reads as
          a duplicate: "200–500mm f/5.6 · 500mm · f/5.6". */}
      {exposure && <p className="shot-line shot-tech">{exposure}</p>}
      {gear && <p className="shot-line shot-gear">{gear}</p>}
      {photo.note && <p className="shot-note">{photo.note}</p>}
    </figcaption>
  );
}

export function PhotoViewer({ album, index, onClose, onIndexChange }: PhotoViewerProps) {
  const slides = album.photos.map((p) => toSlide(p, album));
  const thumbnailsRef = useRef<{ visible: boolean; show: () => void; hide: () => void } | null>(null);

  const handleView = useCallback(
    ({ index: i }: { index: number }) => {
      onIndexChange(i);
    },
    [onIndexChange],
  );

  return (
    <Lightbox
      open
      close={onClose}
      slides={slides}
      index={index}
      plugins={[Counter, Thumbnails]}
      carousel={{ preload: 2 }}
      on={{ view: handleView }}
      controller={{ closeOnBackdropClick: true }}
      // Fully opaque: at 98% the masthead and album title ghost through
      // behind the photograph and read as a rendering fault.
      styles={{ container: { backgroundColor: '#08090b' } }}
      thumbnails={{
        ref: thumbnailsRef,
        hidden: true,
        showToggle: true,
        width: 60,
        height: 40,
        gap: 8,
        padding: 2,
        border: 0,
        borderRadius: 2,
      }}
      render={{
        slide: ({ slide }) => {
          const photo = (slide as any).photo as Photo | undefined;
          if (!photo) return undefined;

          return (
            <figure className="lightbox-slide">
              <div className="lightbox-image">
                <picture>
                  <source
                    type="image/webp"
                    srcSet={buildSrcSet(photo, 'webp')}
                    sizes="100vw"
                  />
                  <img
                    src={imgUrl(photo.src)}
                    srcSet={buildSrcSet(photo, 'jpg')}
                    sizes="100vw"
                    alt={altText(photo, album)}
                    draggable={false}
                  />
                </picture>
              </div>
              <ShotLabel photo={photo} album={album} />
            </figure>
          );
        },
      }}
    />
  );
}
