// v0.42 public homepage (docs/28): what someone signed out sees at "/".
// Sections: hero with a live-looking product mock, link sources, features,
// how it works, comparison, destinations (Unsplash, credited), fresh Discover
// journeys, FAQ, closing call to action, footer. Signed in, "/" stays My trips.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import SiteHeader from '../components/SiteHeader';
import BrandMark from '../components/BrandMark';
import { Icon, IconDefs } from '../components/Icon';
import { useT } from '../i18n';
import { HOME, type HomeCopy } from './homeCopy';
import './home.css';

interface Photo { destination: string; url: string; author_name: string; author_link: string | null; photo_link: string | null }
interface Guide { id: string; title: string; destination: string; duration: number }

/** Sections fade up once as they scroll in (transforms drop under reduced motion; ReducedMotionConfig in main.tsx). */
const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '0px 0px -80px 0px' },
  transition: { type: 'spring' as const, stiffness: 120, damping: 22 },
};

export default function Home() {
  const { t, lang } = useT();
  const c = HOME[lang];
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);

  useEffect(() => {
    const prev = document.title;
    document.title = c.metaTitle;
    document.documentElement.lang = lang;
    return () => { document.title = prev; };
  }, [c.metaTitle, lang]);

  useEffect(() => {
    fetch('/api/public/carousel').then(r => (r.ok ? r.json() : { items: [] })).then((r: any) => setPhotos(r.items ?? [])).catch(() => {});
    fetch('/api/journey/guides?q=&duration=0&page=0').then(r => (r.ok ? r.json() : { items: [] })).then((r: any) => setGuides((r.items ?? []).slice(0, 3))).catch(() => {});
  }, []);

  return (
    <div className="home">
      <IconDefs />
      <a className="home-skip" href="#main">{lang === 'ms' ? 'Langkau ke kandungan' : 'Skip to content'}</a>
      <SiteHeader />
      <main id="main">
        <Hero c={c} />
        <Sources c={c} />
        <Features c={c} />
        <How c={c} />
        <Compare c={c} />
        {photos.length > 0 && <Places c={c} photos={photos} />}
        {guides.length > 0 && <Journeys c={c} guides={guides} nDays={t.nDays} />}
        <Faq c={c} />
        <FinalCta c={c} />
      </main>
      <Footer c={c} credit={photos.length > 0} />
    </div>
  );
}

function Hero({ c }: { c: HomeCopy }) {
  return (
    <section className="home-hero">
      <div className="home-wrap home-hero-grid">
        <div className="home-hero-copy">
          <p className="home-eyebrow"><span className="home-dot" aria-hidden="true" /> {c.hero.eyebrow}</p>
          <h1>{c.hero.title}</h1>
          <p className="home-lede">{c.hero.sub}</p>
          <div className="home-actions">
            <Link to="/login" className="btn home-btn-lg">{c.hero.primary} <Icon name="arrow-r" size={20} /></Link>
            <Link to="/discover" className="btn secondary home-btn-lg">{c.hero.secondary}</Link>
          </div>
          <p className="home-note"><Icon name="check" size={16} /> {c.hero.note}</p>
        </div>
        <HeroMock c={c} />
      </div>
    </section>
  );
}

/** A drawn product preview (no screenshots of real trips). Decorative: the copy says the same. */
function HeroMock({ c }: { c: HomeCopy }) {
  const m = c.mock;
  return (
    <div className="home-mock" aria-hidden="true">
      <div className="mock-window">
        <div className="mock-top">
          <div>
            <strong>{m.trip}</strong>
            <span>{m.dates}</span>
          </div>
          <div className="mock-avatars"><i /><i /><i /><b>{m.people}</b></div>
        </div>
        <div className="mock-body">
          <svg className="mock-map" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice">
            <rect width="320" height="220" className="mm-sea" />
            <path d="M40 30 C 110 0, 230 10, 290 60 S 300 190, 220 210 S 60 210, 30 150 S 0 60, 40 30 Z" className="mm-land" />
            <path d="M70 70 C 120 60, 150 110, 200 100 S 260 130, 250 170" className="mm-road" />
            <motion.path d="M78 62 C 120 40, 160 90, 196 96 S 248 120, 244 168" className="mm-route"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, delay: .4, ease: 'easeInOut' }} />
            {[[78, 62, 1], [140, 64, 2], [196, 96, 3], [244, 168, 4]].map(([x, y, n], k) => (
              <motion.g key={n} initial={{ opacity: 0, scale: .4 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: .5 + k * .35, type: 'spring', stiffness: 300, damping: 18 }}>
                <circle cx={x} cy={y} r="11" className="mm-pin" />
                <text x={x} y={y + 4} textAnchor="middle" className="mm-pin-n">{n}</text>
              </motion.g>
            ))}
          </svg>
          <div className="mock-list">
            <span className="mock-day">{m.day}</span>
            <ol>
              {m.stops.map(([time, name], k) => (
                <motion.li key={k} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: .3 + k * .12, type: 'spring', stiffness: 220, damping: 24 }}>
                  <span className="mock-n">{k + 1}</span>
                  <span className="mock-t">{time}</span>
                  <span className="mock-name">{name}</span>
                </motion.li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <motion.div className="mock-chip mock-chip-transit" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4 }}>
        <Icon name="train" size={16} /> {m.transit}
      </motion.div>
      <motion.div className="mock-chip mock-chip-owe" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.7 }}>
        <Icon name="wallet" size={16} /> {m.owe}
      </motion.div>
    </div>
  );
}

function Sources({ c }: { c: HomeCopy }) {
  return (
    <section className="home-sources" aria-label={c.sources.label}>
      <div className="home-wrap">
        <span>{c.sources.label}</span>
        <ul>{c.sources.items.map(s => <li key={s}>{s}</li>)}</ul>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, sub, id }: { eyebrow?: string; title: string; sub?: string; id: string }) {
  return (
    <div className="home-head">
      {eyebrow && <p className="home-eyebrow">{eyebrow}</p>}
      <h2 id={id}>{title}</h2>
      {sub && <p className="home-lede">{sub}</p>}
    </div>
  );
}

function Features({ c }: { c: HomeCopy }) {
  return (
    <section id="features" className="home-section" aria-labelledby="features-t">
      <div className="home-wrap">
        <SectionHead id="features-t" eyebrow={c.features.eyebrow} title={c.features.title} />
        <ul className="home-features">
          {c.features.items.map((f, k) => (
            <motion.li key={f.title} className={k === 0 ? 'big' : ''} {...reveal} transition={{ ...reveal.transition, delay: (k % 3) * .06 }}>
              <span className="home-ficon"><Icon name={f.icon} size={24} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function How({ c }: { c: HomeCopy }) {
  return (
    <section id="how" className="home-section home-band" aria-labelledby="how-t">
      <div className="home-wrap">
        <SectionHead id="how-t" eyebrow={c.how.eyebrow} title={c.how.title} />
        <ol className="home-steps">
          {c.how.steps.map((s, k) => (
            <motion.li key={s.title} {...reveal} transition={{ ...reveal.transition, delay: k * .08 }}>
              <span className="home-step-n">{k + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Compare({ c }: { c: HomeCopy }) {
  const v = c.compare;
  const cell = (x: boolean | 'some' | 'paid') =>
    x === true ? <><Icon name="check" size={20} /><span className="sr-only">{v.yes}</span></>
      : x === false ? <><span className="home-dash" aria-hidden="true">–</span><span className="sr-only">{v.no}</span></>
        : <span className="home-partial">{x === 'some' ? v.some : v.paid}</span>;
  return (
    <section className="home-section" aria-labelledby="compare-t">
      <div className="home-wrap">
        <SectionHead id="compare-t" eyebrow={v.eyebrow} title={v.title} />
        <motion.div className="home-table-wrap" {...reveal} tabIndex={0} role="region" aria-labelledby="compare-t">
          <table className="home-table">
            <thead>
              <tr><td />{v.cols.map((col, k) => <th key={col} scope="col" className={k === 0 ? 'us' : ''}>{col}</th>)}</tr>
            </thead>
            <tbody>
              {v.rows.map(([label, vals]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {vals.map((x, k) => <td key={k} className={k === 0 ? 'us' : ''}>{cell(x)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}

function Places({ c, photos }: { c: HomeCopy; photos: Photo[] }) {
  return (
    <section className="home-section" aria-labelledby="places-t">
      <div className="home-wrap">
        <SectionHead id="places-t" eyebrow={c.places.eyebrow} title={c.places.title} sub={c.places.sub} />
        <ul className="home-places">
          {photos.slice(0, 5).map(p => (
            <motion.li key={p.destination} {...reveal}>
              <Link to={`/discover?q=${encodeURIComponent(p.destination)}`} className="home-place">
                <img src={p.url} alt="" loading="lazy" decoding="async" width="600" height="800"
                  onError={e => { e.currentTarget.hidden = true; }} />
                <span className="home-place-name">{p.destination}</span>
                <span className="home-place-go">{c.places.open} <Icon name="arrow-r" size={16} /></span>
              </Link>
              {p.author_name && (
                <small className="home-credit">
                  {c.places.photo} {p.author_link ? <a href={p.author_link} target="_blank" rel="noopener noreferrer">{p.author_name}</a> : p.author_name}
                </small>
              )}
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Journeys({ c, guides, nDays }: { c: HomeCopy; guides: Guide[]; nDays: (n: number) => string }) {
  return (
    <section className="home-section home-section-tight" aria-labelledby="journeys-t">
      <div className="home-wrap">
        <div className="home-row-head">
          <h2 id="journeys-t">{c.journeys.title}</h2>
          <Link to="/discover" className="home-more">{c.journeys.all} <Icon name="arrow-r" size={16} /></Link>
        </div>
        <ul className="home-guides">
          {guides.map(g => (
            <li key={g.id}>
              <Link to={`/guides/${g.id}`} className="home-guide">
                <small><Icon name="pin" size={16} /> {g.destination}</small>
                <strong>{g.title}</strong>
                <span>{nDays(g.duration)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Faq({ c }: { c: HomeCopy }) {
  return (
    <section id="faq" className="home-section" aria-labelledby="faq-t">
      <div className="home-wrap home-faq-grid">
        <SectionHead id="faq-t" title={c.faq.title} />
        <div className="home-faq">
          {c.faq.items.map(([q, a]) => (
            <details key={q}>
              <summary>{q}<Icon name="plus" size={20} /></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta({ c }: { c: HomeCopy }) {
  return (
    <section className="home-section" aria-labelledby="cta-t">
      <motion.div className="home-wrap home-cta" {...reveal}>
        <h2 id="cta-t">{c.cta.title}</h2>
        <p>{c.cta.sub}</p>
        <Link to="/login" className="btn home-btn-lg home-btn-invert">{c.cta.button} <Icon name="arrow-r" size={20} /></Link>
      </motion.div>
    </section>
  );
}

function Footer({ c, credit }: { c: HomeCopy; credit: boolean }) {
  return (
    <footer className="home-footer">
      <div className="home-wrap home-footer-grid">
        <div>
          <Link to="/" className="site-logo"><BrandMark size={28} /> <span>Jelajah</span></Link>
          <p>{c.footer.tagline}</p>
        </div>
        <nav aria-label={c.footer.product}>
          <h2>{c.footer.product}</h2>
          <ul>
            <li><a href="#features">{c.nav.features}</a></li>
            <li><a href="#how">{c.nav.how}</a></li>
            <li><Link to="/discover">{c.nav.discover}</Link></li>
            <li><a href="#faq">{c.nav.faq}</a></li>
            <li><Link to="/login">{c.nav.signIn}</Link></li>
            <li><a href="/privacy.html">{c.footer.privacy}</a></li>
          </ul>
        </nav>
      </div>
      <div className="home-wrap home-footer-base">
        <span>© {new Date().getFullYear()} Jelajah. {c.footer.rights}</span>
        {credit && <span>{c.places.photo} Unsplash</span>}
      </div>
    </footer>
  );
}
