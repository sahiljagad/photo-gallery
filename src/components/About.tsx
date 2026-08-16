/* ─────────────────────────────────────────────────────────────────────
   The words. All of them.
   ───────────────────────────────────────────────────────────────────── */

const BIO = 'Wildlife and landscape, mostly at either end of the day.';

const LINKS = [
  { href: 'mailto:sahiljagad@gmail.com', value: 'sahiljagad@gmail.com' },
  { href: 'https://instagram.com/sahiljagad_photos', value: '@sahiljagad_photos' },
];

/* ─────────────────────────────────────────────────────────────────── */

export function About() {
  return (
    <article className="about">
      <h1 className="about-title">Sahil Jagad</h1>
      <p className="about-bio">{BIO}</p>
      <ul className="about-links">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              rel="me noopener noreferrer"
              target={l.href.startsWith('http') ? '_blank' : undefined}
            >
              {l.value}
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
