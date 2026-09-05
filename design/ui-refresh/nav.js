// Jelajah UI refresh — shared navigation (prototype v4).
// Reads <body data-nav="trip|account" data-page="…" data-title="…" data-icon="…">
// and injects: fixed collapsible sidebar, mobile top bar, bottom tab bar,
// trip-switch sheet (long-press a trip tab / tap the sidebar switcher),
// "More" sheet, and the floating theme toggle. Load AFTER icons.js.
(function () {
  const body = document.body;
  const nav = body.dataset.nav;             // trip | account | undefined (no chrome)
  const page = body.dataset.page || '';
  const title = body.dataset.title || 'Jelajah';
  const picon = body.dataset.icon || 'i-pin';

  /* ---------- theme (shared) ---------- */
  window.jlApplyTheme = function (v) {
    document.documentElement.dataset.theme = v === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : '') : v;
  };
  jlApplyTheme(localStorage.getItem('jl-theme') || '');
  window.jlSetTheme = function (v) { localStorage.setItem('jl-theme', v); jlApplyTheme(v); };
  window.tg = function () { jlSetTheme((localStorage.getItem('jl-theme') || '') === 'dark' ? '' : 'dark'); };

  const ic = (n, cls) => `<svg class="i${cls ? ' ' + cls : ''}"><use href="#${n}"/></svg>`;
  const item = (key, href, icon, label, extra) =>
    `<a class="nav-item${page === key ? ' on' : ''}" href="${href}" title="${label}">
       <span class="ic">${ic(icon)}</span><span class="lbl">${label}</span>${extra || ''}</a>`;

  const TRIPS = [
    { em: '🇯🇵', name: 'Jelajah Jepun 2026', sub: '29 Nov – 7 Dec · 16 pax', role: 'Leader', badge: 'brand', href: '01-dashboard.html', on: true },
    { em: '🚐', name: 'Kyushu Campervan', sub: '15 – 22 Jan · 2 pax', role: 'Editor', badge: 'gray', href: '#' },
    { em: '🕌', name: 'Umrah Keluarga', sub: 'Done · Mar 2026', role: 'Viewer', badge: 'gray', href: '#' },
  ];

  /* ---------- sidebar ---------- */
  if (nav) {
    if (localStorage.getItem('jl-side') === 'min') document.documentElement.classList.add('side-min');

    const tripNav = nav === 'trip' ? `
      <button class="trip-switch" onclick="jlSheet('trips')" title="Switch trip">
        <span class="em">🇯🇵</span><div class="t"><b>Jelajah Jepun 2026</b><span>29 Nov – 7 Dec</span></div>
        ${ic('i-chev-d', 'sm')}</button>
      ${item('overview', '01-dashboard.html', 'i-home', 'Overview')}
      ${item('plan', '02-plan.html', 'i-calendar', 'Plan')}
      ${item('money', '03-wallet.html', 'i-wallet', 'Money', '<span class="pill badge warning">3 due</span>')}
      ${item('docs', '06-documents.html', 'i-file', 'Documents')}
      ${item('people', '07-people.html', 'i-users', 'People')}` : '';

    const aside = document.createElement('aside');
    aside.className = 'sidebar';
    aside.innerHTML = `
      <div class="side-brand"><div class="logo" style="color:#fff">${ic('i-pin')}</div><strong>Jelajah</strong>
        <button class="side-collapse" onclick="jlSide()" title="Collapse sidebar">${ic('i-chev-r', 'sm')}</button></div>
      ${item('home', '00-trips.html', 'i-folder', 'Home')}
      ${tripNav}
      <div class="side-foot">
        ${item('admin', '04-admin.html', 'i-shield', 'Admin')}
        ${item('settings', '08-settings.html', 'i-settings', 'Settings')}
        <div class="nav-item side-user" title="Hamzah"><span class="avatar">HZ</span><span class="lbl">Hamzah</span>
          <span class="pill badge gray">${nav === 'trip' ? 'Leader' : 'You'}</span></div>
      </div>`;
    const shell = document.querySelector('.shell');
    shell.insertBefore(aside, shell.firstChild);

    window.jlSide = function () {
      const min = document.documentElement.classList.toggle('side-min');
      localStorage.setItem('jl-side', min ? 'min' : '');
    };

    /* ---------- mobile top bar ---------- */
    const main = shell.querySelector('.main');
    const mtop = document.createElement('div');
    mtop.className = 'mtop';
    mtop.innerHTML = `<span style="color:var(--brand-700)">${ic(picon)}</span><b>${title}</b><span class="avatar">HZ</span>`;
    main.insertBefore(mtop, main.firstChild);

    /* ---------- bottom tab bar ---------- */
    const tabs = [
      { key: 'home', href: '00-trips.html', icon: 'i-folder', label: 'Home' },
      { key: 'plan', href: '02-plan.html', icon: 'i-calendar', label: 'Plan', trip: true },
      { key: 'money', href: '03-wallet.html', icon: 'i-wallet', label: 'Money', trip: true },
      { key: 'docs', href: '06-documents.html', icon: 'i-file', label: 'Docs', trip: true },
      { key: 'more', href: '#', icon: 'i-more', label: 'More' },
    ];
    const onKey = { overview: 'home', people: 'more', admin: 'more', settings: 'more' }[page] || page;
    const bar = document.createElement('nav');
    bar.className = 'tabbar';
    bar.innerHTML = tabs.map(t =>
      `<a class="tab${t.key === onKey ? ' on' : ''}" href="${t.href}" data-key="${t.key}" ${t.trip ? 'data-trip' : ''}>
         <span class="ic">${ic(t.icon)}</span>${t.label}${t.key === onKey ? '<span class="dot"></span>' : ''}</a>`).join('');
    body.appendChild(bar);

    /* long-press a trip tab -> trip sheet */
    bar.querySelectorAll('[data-trip]').forEach(el => {
      let timer, held = false;
      const start = () => { held = false; timer = setTimeout(() => { held = true; jlSheet('trips'); }, 450); };
      const end = () => clearTimeout(timer);
      el.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => el.addEventListener(e, end));
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('click', e => { if (held) e.preventDefault(); });
    });
    bar.querySelector('[data-key=more]').addEventListener('click', e => { e.preventDefault(); jlSheet('more'); });

    /* ---------- sheets ---------- */
    const wrap = document.createElement('div');
    wrap.className = 'sheetwrap';
    wrap.innerHTML = `<div class="scrim" onclick="jlSheet()"></div><div class="sheet" id="jlsheet"></div>`;
    body.appendChild(wrap);

    window.jlSheet = function (which) {
      if (!which) { wrap.classList.remove('open'); return; }
      const s = document.getElementById('jlsheet');
      if (which === 'trips') {
        s.innerHTML = `<div class="grab"></div><h4>Switch trip</h4>` + TRIPS.map(t =>
          `<a class="srow" href="${t.href}"><span class="em">${t.em}</span>
             <div class="t"><b>${t.name}</b><small>${t.sub}</small></div>
             <span class="badge ${t.badge}">${t.on ? '<span class="d"></span>' : ''}${t.role}</span></a>`).join('') +
          `<a class="srow" href="00-trips.html"><span class="em">${ic('i-folder')}</span>
             <div class="t"><b>All trips</b><small>covers, roles, new trip</small></div>${ic('i-chev-r', 'sm')}</a>`;
      } else {
        s.innerHTML = `<div class="grab"></div><h4>More</h4>` + [
          ['07-people.html', 'i-users', 'People', 'members, roles, invites'],
          ['08-settings.html', 'i-settings', 'Settings', 'theme, tokens, referral'],
          ['04-admin.html', 'i-shield', 'Admin', 'platform dashboard'],
          ['09-auth.html', 'i-logout', 'Log out', ''],
        ].map(([h, i2, b, sm]) =>
          `<a class="srow" href="${h}"><span class="em">${ic(i2)}</span>
             <div class="t"><b>${b}</b>${sm ? `<small>${sm}</small>` : ''}</div>${ic('i-chev-r', 'sm')}</a>`).join('');
      }
      wrap.classList.add('open');
      s.querySelectorAll('svg.i').forEach(v => v.setAttribute('viewBox', '0 0 24 24'));
    };
  }

  /* ---------- floating theme toggle ---------- */
  const t = document.createElement('div');
  t.className = 'themetoggle';
  t.innerHTML = `<button onclick="tg()" title="Toggle dark mode">${ic('i-moon')}</button>`;
  body.appendChild(t);

  document.querySelectorAll('svg.i').forEach(v => v.setAttribute('viewBox', '0 0 24 24'));
})();
