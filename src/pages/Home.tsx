// v0.43 public homepage (docs/29): what someone signed out sees at "/".
// Hero with a real OpenStreetMap tour of a Penang day (HeroMap), link sources,
// three feature showcases with small product vignettes plus three smaller
// features, how it works, comparison, destinations (Unsplash, credited), fresh
// Discover journeys, FAQ, closing call to action, footer.
// Signed in, "/" stays My trips.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import SiteHeader from '../components/SiteHeader';
import BrandMark from '../components/BrandMark';
import { Icon, IconDefs } from '../components/Icon';
import { useT } from '../i18n';
import { HOME, type HomeCopy } from './homeCopy';
import '@fontsource/instrument-serif/400-italic.css';
import './home.css';
import type { IconName } from '../components/iconDefs';

const HeroMap = lazy(() => import('./HeroMap'));

interface Photo { destination: string; url: string; author_name: string; author_link: string | null; photo_link: string | null }
interface Guide { id: string; title: string; destination: string; duration: number }

/** Sections fade up once as they scroll in (transforms drop under reduced motion; ReducedMotionConfig in main.tsx). */
const reveal = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '0px 0px -80px 0px' },
  transition: { type: 'spring' as const, stiffness: 140, damping: 24 },
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
        <Showcase c={c} />
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

/** Headline words rise in one after another; the accent word is set in serif italic. */
function Reveal({ parts, as: Tag = 'h1', id }: { parts: string[]; as?: 'h1' | 'h2'; id?: string }) {
  let n = 0;
  return (
    <Tag id={id} className="home-reveal">
      {parts.map((part, k) => (
        <span key={k} className={k === 1 ? 'accent' : undefined}>
          {part.split(' ').map((w, i) => (
            <motion.span key={i} className="w" initial={{ opacity: 0, y: '0.4em', filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.08 + (n++) * 0.06, type: 'spring', stiffness: 200, damping: 26 }}>
              {w}{' '}
            </motion.span>
          ))}
        </span>
      ))}
    </Tag>
  );
}

function Hero({ c }: { c: HomeCopy }) {
  return (
    <section className="home-hero">
      <div className="home-wrap home-hero-copy">
        <Link to="/discover" className="home-badge"><span className="home-badge-dot" aria-hidden="true" /> {c.badge} <Icon name="arrow-r" size={16} /></Link>
        <Reveal parts={c.titleParts} />
        <motion.p className="home-lede" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .55 }}>{c.hero.sub}</motion.p>
        <motion.div className="home-actions" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .7 }}>
          <Link to="/login" className="btn home-btn-lg">{c.hero.primary} <Icon name="arrow-r" size={20} /></Link>
          <Link to="/discover" className="btn secondary home-btn-lg">{c.hero.secondary}</Link>
        </motion.div>
        <ul className="home-trust">
          {c.trust.map(x => <li key={x}><Icon name="check" size={16} /> {x}</li>)}
        </ul>
      </div>
      <motion.div className="home-wrap home-hero-visual" initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .85, type: 'spring', stiffness: 90, damping: 20 }}>
        <Suspense fallback={<div className="hm hm-skeleton" aria-hidden="true" />}>
          <HeroMap c={c} />
        </Suspense>
      </motion.div>
    </section>
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

function SectionHead({ eyebrow, title, sub, id, center }: { eyebrow?: string; title: string; sub?: string; id: string; center?: boolean }) {
  return (
    <div className={`home-head${center ? ' center' : ''}`}>
      {eyebrow && <p className="home-eyebrow">{eyebrow}</p>}
      <h2 id={id}>{title}</h2>
      {sub && <p className="home-lede">{sub}</p>}
    </div>
  );
}

/* ---- feature vignettes: small, drawn-in-HTML slices of the product ---- */
function VLink({ c }: { c: HomeCopy }) {
  const v = c.vignette;
  return (
    <div className="vg vg-link" aria-hidden="true">
      <div className="vg-input"><Icon name="link" size={16} /> <span>{v.url}</span></div>
      <div className="vg-progress"><span /> {v.making}</div>
      <ul>{v.days.map(d => <li key={d}>{d}</li>)}</ul>
    </div>
  );
}
function VTransit({ c }: { c: HomeCopy }) {
  const v = c.vignette;
  return (
    <div className="vg vg-transit" aria-hidden="true">
      <div className="vg-stop"><i /> <strong>{v.from}</strong></div>
      <div className="vg-ride"><span className="vg-line" /><span className="vg-chip"><Icon name="train" size={16} /> {c.mock.legs[1]}</span><small>{v.stopsBetween}</small></div>
      <div className="vg-stop end"><i /> <strong>{v.to}</strong></div>
    </div>
  );
}
function VSplit({ c }: { c: HomeCopy }) {
  const v = c.vignette;
  return (
    <div className="vg vg-split" aria-hidden="true">
      <small>{v.balances}</small>
      <ul>
        {v.people.map(([name, amt], k) => (
          <li key={name}><span className={`vg-av a${k}`}>{name[0]}</span> {name} <b className={amt.startsWith('-') ? 'neg' : 'pos'}>RM {amt.replace(/^[-+]/, amt.startsWith('-') ? '−' : '+')}</b></li>
        ))}
      </ul>
      <span className="vg-btn">{v.settle}</span>
    </div>
  );
}

function Showcase({ c }: { c: HomeCopy }) {
  const items = c.features.items;
  const vignettes = [<VLink c={c} />, <VTransit c={c} />, <VSplit c={c} />];
  const big = [items[1], items[2], items[5]], small = [items[0], items[3], items[4]];
  return (
    <section id="features" className="home-section" aria-labelledby="features-t">
      <div className="home-wrap">
        <div className="home-head center">
          <p className="home-eyebrow">{c.features.eyebrow}</p>
          <h2 id="features-t" className="home-reveal static"><span>{c.featParts[0]} </span><span className="accent">{c.featParts[1]}</span></h2>
        </div>
        <ul className="home-pills">
          {c.pills.map(([icon, label], k) => (
            <motion.li key={label} initial={{ opacity: 0, scale: .9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
              transition={{ delay: k * .035, type: 'spring', stiffness: 260, damping: 22 }}>
              <Icon name={icon as IconName} size={16} /> {label}
            </motion.li>
          ))}
        </ul>
        <div className="home-rows">
          {big.map((f, k) => (
            <motion.article key={f.title} className={`home-row${k % 2 ? ' flip' : ''}`} {...reveal}>
              <div className="home-row-text">
                <span className="home-row-n">{String(k + 1).padStart(2, '0')}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
              <div className="home-row-art">{vignettes[k]}</div>
            </motion.article>
          ))}
        </div>
        <h3 className="home-more-title">{c.more}</h3>
        <ul className="home-small">
          {small.map(f => (
            <li key={f.title}>
              <span className="home-ficon"><Icon name={f.icon} size={20} /></span>
              <div><h4>{f.title}</h4><p>{f.text}</p></div>
            </li>
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
              <span className="home-step-n">{String(k + 1).padStart(2, '0')}</span>
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
    x === true ? <><span className="home-yes"><Icon name="check" size={16} /></span><span className="sr-only">{v.yes}</span></>
      : x === false ? <><span className="home-dash" aria-hidden="true">–</span><span className="sr-only">{v.no}</span></>
        : <span className="home-partial">{x === 'some' ? v.some : v.paid}</span>;
  return (
    <section className="home-section" aria-labelledby="compare-t">
      <div className="home-wrap">
        <SectionHead id="compare-t" eyebrow={v.eyebrow} title={v.title} />
        <motion.div className="home-table-wrap" {...reveal} tabIndex={0} role="region" aria-labelledby="compare-t">
          <table className="home-table">
            <thead>
              <tr><td />{v.cols.map((col, k) => <th key={col} scope="col" className={k === 0 ? 'us' : ''}>{k === 0 ? <span className="home-table-brand"><BrandMark size={20} /> {col}</span> : col}</th>)}</tr>
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
  const [paused, setPaused] = useState(false);
  const list = photos.slice(0, 6);
  const card = (p: Photo, dup: boolean) => (
    <li key={(dup ? 'b-' : 'a-') + p.destination} aria-hidden={dup || undefined}>
      <Link to={`/discover?q=${encodeURIComponent(p.destination)}`} className="home-place" tabIndex={dup ? -1 : undefined}>
        <img src={p.url} alt="" loading="lazy" decoding="async" width="600" height="800"
          onError={e => { e.currentTarget.hidden = true; }} />
        <span className="home-place-name">{p.destination}</span>
        <span className="home-place-go">{c.places.open} <Icon name="arrow-r" size={16} /></span>
      </Link>
      {p.author_name && !dup && (
        <small className="home-credit">
          {c.places.photo} {p.author_link ? <a href={p.author_link} target="_blank" rel="noopener noreferrer">{p.author_name}</a> : p.author_name}
        </small>
      )}
    </li>
  );
  return (
    <section className="home-section home-section-tight" aria-labelledby="places-t">
      <div className="home-wrap home-row-head">
        <div>
          <p className="home-eyebrow">{c.places.eyebrow}</p>
          <h2 id="places-t">{c.places.title}</h2>
          <p className="home-lede">{c.places.sub}</p>
        </div>
        <button type="button" className="btn secondary sm home-marquee-toggle" onClick={() => setPaused(x => !x)} aria-pressed={undefined}>
          {paused ? c.play : c.pause}
        </button>
      </div>
      <div className={`home-marquee${paused ? ' paused' : ''}`}>
        <ul className="home-places">
          {list.map(p => card(p, false))}
          {list.map(p => card(p, true))}
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
                <span>{nDays(g.duration)} <Icon name="arrow-r" size={16} /></span>
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
            <details key={q} name="home-faq">
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
      <div className="home-wrap">
        <motion.div className="home-cta" {...reveal}>
          <svg className="home-cta-route" viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true">
            <path d="M-20 260 C 180 200, 260 300, 420 220 S 700 60, 860 140 S 1100 260, 1240 120" />
          </svg>
          <h2 id="cta-t" className="home-reveal static"><span>{c.ctaParts[0]} </span><span className="accent">{c.ctaParts[1]}</span></h2>
          <p>{c.cta.sub}</p>
          <Link to="/login" className="btn home-btn-lg home-btn-invert">{c.cta.button} <Icon name="arrow-r" size={20} /></Link>
        </motion.div>
      </div>
    </section>
  );
}

function Footer({ c, credit }: { c: HomeCopy; credit: boolean }) {
  return (
    <footer className="home-footer">
      <div className="home-wrap home-footer-grid">
        <div className="home-footer-brand">
          <Link to="/" className="site-logo"><BrandMark size={28} /> <span>Jelajah</span></Link>
          <p>{c.footer.tagline}</p>
          <Link to="/login" className="btn home-footer-cta">{c.nav.start} <Icon name="arrow-r" size={16} /></Link>
        </div>
        <nav aria-label={c.footer.product}>
          <h2>{c.footer.product}</h2>
          <ul>
            <li><a href="#features">{c.nav.features}</a></li>
            <li><a href="#how">{c.nav.how}</a></li>
            <li><a href="#faq">{c.nav.faq}</a></li>
          </ul>
        </nav>
        <nav aria-label={c.nav.discover}>
          <h2>{c.nav.discover}</h2>
          <ul>
            <li><Link to="/discover">{c.journeys.all}</Link></li>
            <li><Link to="/login">{c.nav.signIn}</Link></li>
          </ul>
        </nav>
        <nav aria-label={c.footer.privacy}>
          <h2>{c.footer.legal}</h2>
          <ul>
            <li><a href="/privacy.html">{c.footer.privacy}</a></li>
          </ul>
        </nav>
      </div>
      <div className="home-wrap home-footer-base">
        <span>© {new Date().getFullYear()} Jelajah. {c.footer.rights}</span>
        <span>Map data © OpenStreetMap contributors{credit ? ' · Photos from Unsplash' : ''}</span>
      </div>
    </footer>
  );
}
