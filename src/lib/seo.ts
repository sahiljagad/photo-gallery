import type { Album } from '../types';
import { imgUrl, formatRange } from './photos';

export const SITE_NAME = 'Sahil Jagad';
export const SITE_TAGLINE = 'Wildlife and landscape photography';

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * Keep the document head in step with the hash route.
 *
 * This is a client-rendered single page, so crawlers that don't execute
 * JavaScript will only ever see the static tags in index.html. These updates
 * are what make a shared album link preview correctly in Slack, iMessage and
 * anywhere else that runs the page before reading its metadata.
 */
export function applySeo(opts: {
  title: string;
  description: string;
  image?: string;
  path: string;
}) {
  const full = opts.title === SITE_NAME ? SITE_NAME : `${opts.title} — ${SITE_NAME}`;
  document.title = full;

  setMeta('meta[name="description"]', 'name', 'description', opts.description);
  setMeta('meta[property="og:title"]', 'property', 'og:title', full);
  setMeta('meta[property="og:description"]', 'property', 'og:description', opts.description);
  setMeta('meta[property="og:type"]', 'property', 'og:type', 'website');
  setMeta('meta[property="og:site_name"]', 'property', 'og:site_name', SITE_NAME);
  setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', full);
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', opts.description);

  const url = `${location.origin}${location.pathname}${opts.path}`;
  setMeta('meta[property="og:url"]', 'property', 'og:url', url);
  setLink('canonical', url);

  if (opts.image) {
    const abs = new URL(opts.image, location.origin + location.pathname).href;
    setMeta('meta[property="og:image"]', 'property', 'og:image', abs);
    setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', abs);
  }
}

export function albumSeo(album: Album) {
  const when = formatRange(album.date, album.dateEnd);
  const where = album.region ? `${album.region}. ` : '';
  applySeo({
    title: album.title,
    description:
      album.intro?.slice(0, 200) ||
      `${where}${album.photos.length} photographs from ${when}.`,
    image: imgUrl(album.cover.sizes[album.cover.sizes.length - 1]?.src ?? album.cover.src),
    path: `#/a/${album.id}`,
  });
}
