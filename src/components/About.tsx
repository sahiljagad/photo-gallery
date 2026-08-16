import type { Archive } from '../types';
import { Picture } from './Picture';

/* ─────────────────────────────────────────────────────────────────────
   The words. Everything a human should write lives here.
   The counts below the text are derived from photos.json at runtime, so
   they stay true on their own — don't hard-code them.
   ───────────────────────────────────────────────────────────────────── */

const BIO = [
  `Wildlife and landscape, mostly at either end of the day. Kenya, Yellowstone,
   Costa Rica, Central India, Portugal and the American West.`,
];

const CONTACT: { label: string; href: string; value: string }[] = [
  { label: 'Email', href: 'mailto:sahiljagad@gmail.com', value: 'sahiljagad@gmail.com' },
  { label: 'Instagram', href: 'https://instagram.com/sahiljagad_photos', value: '@sahiljagad_photos' },
];

/* ─────────────────────────────────────────────────────────────────── */

interface AboutProps {
  archive: Archive;
}

export function About({ archive }: AboutProps) {
  const photoCount = archive.reduce((n, a) => n + a.photos.length, 0);
  const years = archive.map((a) => a.date.slice(0, 4)).sort();
  const span = years.length ? `${years[0]}–${years[years.length - 1]}` : '—';
  const portrait = archive[0]?.cover;

  return (
    <article className="about">
      <header className="about-header">
        <p className="eyebrow">About</p>
        <h1 className="about-title">Sahil Jagad</h1>
      </header>

      <div className="about-body">
        <div className="about-text">
          {BIO.map((para, i) => (
            <p key={i}>{para}</p>
          ))}

          <dl className="about-facts">
            <div>
              <dt>Photographs</dt>
              <dd>{photoCount}</dd>
            </div>
            <div>
              <dt>Albums</dt>
              <dd>{archive.length}</dd>
            </div>
            <div>
              <dt>Years</dt>
              <dd>{span}</dd>
            </div>
          </dl>

          <section className="about-contact">
            <h2 className="section-label">Contact</h2>
            <ul>
              {CONTACT.map((c) => (
                <li key={c.label}>
                  <span className="contact-label">{c.label}</span>
                  <a
                    href={c.href}
                    rel="me noopener noreferrer"
                    target={c.href.startsWith('http') ? '_blank' : undefined}
                  >
                    {c.value}
                  </a>
                </li>
              ))}
            </ul>
          </section>

        </div>

        {portrait && (
          <figure className="about-figure">
            <Picture
              photo={portrait}
              album={archive[0]}
              sizes="(max-width: 900px) 100vw, 42vw"
            />
          </figure>
        )}
      </div>
    </article>
  );
}
