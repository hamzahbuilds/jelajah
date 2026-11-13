// v0.42 public site header (docs/28): homepage, Discover and guides when
// signed out. One <nav> at every width. The links sit inline while the whole
// row fits; when it doesn't, the same list becomes a native popover behind a
// Menu button. No fixed breakpoint: a ResizeObserver measures the row, so a
// longer translation or bigger text moves the switch point by itself.
import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import BrandMark from './BrandMark';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { HOME } from '../pages/homeCopy';
import './siteHeader.css';

export default function SiteHeader() {
  const { lang, setLang } = useT();
  const c = HOME[lang];
  const { pathname } = useLocation();
  const onHome = pathname === '/';
  const header = useRef<HTMLElement>(null), inner = useRef<HTMLDivElement>(null), menu = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const h = header.current!, row = inner.current!, list = menu.current!;
    let wide = false, lastWidth = 0;
    const sync = () => {
      const width = h.clientWidth;
      // Collapsed: only remeasure when the header grew (measuring inline on
      // every shrink would make the layout thrash).
      if (!wide && lastWidth && width <= lastWidth) { lastWidth = width; return; }
      lastWidth = width;
      const wasOpen = list.matches(':popover-open');
      h.classList.add('is-measuring', 'is-wide');
      list.removeAttribute('popover');
      wide = row.scrollWidth <= row.clientWidth;
      h.classList.toggle('is-wide', wide);
      if (!wide) {
        list.setAttribute('popover', 'auto');
        if (wasOpen) list.showPopover();
      }
      requestAnimationFrame(() => h.classList.remove('is-measuring'));
    };
    const ro = new ResizeObserver(sync);
    ro.observe(h); ro.observe(list);
    sync();
    return () => ro.disconnect();
  }, [lang]);

  // A tap on a link closes the open menu (same-page anchors don't navigate).
  const close = () => { const l = menu.current; if (l?.matches(':popover-open')) l.hidePopover(); };
  const anchor = (id: string) => (onHome ? `#${id}` : `/#${id}`);

  return (
    <header className="site-header" ref={header}>
      <div className="site-header-inner" ref={inner}>
        <Link to="/" className="site-logo" aria-label="Jelajah, home">
          <BrandMark size={28} /> <span>Jelajah</span>
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <button className="site-menu-button btn ghost" type="button" popoverTarget="site-menu" aria-controls="site-menu">
            <Icon name="menu" size={20} /> <span>{c.nav.menu}</span>
          </button>
          <ul id="site-menu" className="site-menu" popover="auto" ref={menu}>
            <li><a href={anchor('features')} onClick={close}>{c.nav.features}</a></li>
            <li><a href={anchor('how')} onClick={close}>{c.nav.how}</a></li>
            <li>
              <Link to="/discover" onClick={close} aria-current={pathname === '/discover' || pathname.startsWith('/guides/') ? 'page' : undefined}>
                {c.nav.discover}
              </Link>
            </li>
            <li><a href={anchor('faq')} onClick={close}>{c.nav.faq}</a></li>
            <li className="site-menu-sep" aria-hidden="true" />
            <li>
              <button type="button" className="site-lang" onClick={() => { setLang(lang === 'en' ? 'ms' : 'en'); close(); }}>
                <Icon name="globe" size={16} /> {c.lang}
              </button>
            </li>
            <li><Link to="/login" onClick={close}>{c.nav.signIn}</Link></li>
          </ul>
        </nav>
        <Link to="/login" className="btn site-cta">{c.nav.start}</Link>
      </div>
    </header>
  );
}
