import type { Archive } from '../types';
import { Picture } from './Picture';

/* ─────────────────────────────────────────────────────────────────────
   PLACEHOLDER COPY — replace with your own.
   Everything a human should write lives in this block. The numbers below
   the text are counted from photos.json at runtime, so they stay true on
   their own; don't hard-code them here.
   ───────────────────────────────────────────────────────────────────── */

const BIO = [
  `Placeholder. Two or three sentences on who you are and what pulls you
   toward wildlife and landscape work — where you started, what you are
   drawn to photograph, and why.`,
  `Placeholder. A second paragraph with room for how you work: the patience
   a 500mm lens demands, the trips you plan around light rather than
   itineraries, whatever is actually true.`,
];

const CONTACT: { label: string; href: string; value: string }[] = [
  { label: 'Email', href: 'mailto:sahil@example.com', value: 'sahil@example.com' },
  { label: 'Instagram', href: 'https://instagram.com/', value: '@placeholder' },
];

const PRINTS = `Placeholder. A line about print availability or licensing, or
delete this block if you'd rather not offer either.`;

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
                  <a href={c.href} rel="me noopener">{c.value}</a>
                </li>
              ))}
            </ul>
          </section>

          {PRINTS && (
            <section className="about-prints">
              <h2 className="section-label">Prints</h2>
              <p>{PRINTS}</p>
            </section>
          )}
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
