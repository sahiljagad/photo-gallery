import type { Album, Photo } from '../types';
import { imgUrl, buildSrcSet, altText } from '../lib/photos';

interface PictureProps {
  photo: Photo;
  album?: Album;
  imgProps?: React.ImgHTMLAttributes<HTMLImageElement>;
  sizes?: string;
  /** Above the fold: skip lazy loading and ask the browser to fetch it early. */
  priority?: boolean;
}

/**
 * Shared <picture> element with WebP <source> + JPEG <img> fallback.
 * Sets LQIP as background-image so it paints with the HTML.
 */
export function Picture({ photo, album, imgProps = {}, sizes, priority }: PictureProps) {
  const { style, alt, ...rest } = imgProps;

  return (
    <picture>
      <source
        type="image/webp"
        srcSet={buildSrcSet(photo, 'webp')}
        sizes={sizes}
      />
      <img
        src={imgUrl(photo.src)}
        srcSet={buildSrcSet(photo, 'jpg')}
        sizes={sizes}
        width={photo.width}
        height={photo.height}
        alt={alt ?? altText(photo, album)}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        style={{
          backgroundImage: `url(${photo.lqip})`,
          backgroundSize: 'cover',
          ...style,
        }}
        {...rest}
      />
    </picture>
  );
}
