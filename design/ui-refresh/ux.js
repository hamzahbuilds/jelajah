// Jelajah UI refresh — interaction states (prototype v5).
// Generic modal / dropdown / toast engine + per-page wiring so every
// edit pencil, "Add …" button and menu opens a real mocked state.
// Load AFTER nav.js.
(function () {
  const ic = (n, cls) => `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24"><use href="#${n}"/></svg>`;

  /* ---------- engine ---------- */
  const wrap = document.createElement('div');
  wrap.className = 'jmwrap';
  wrap.innerHTML = `<div class="scrim"></div><div class="jmodal" id="jmodal"></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('.scrim').addEventListener('click', () => jlClose());

  window.jlClose = () => wrap.classList.remove('open');
  window.jlModal = function ({ icon, title, sub, body, danger, okLabel, doneMsg }) {
    document.getElementById('jmodal').innerHTML = `
      <div class="mhead"><span class="tile sm">${ic(icon)}</span>
        <div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div>
        <button class="x" onclick="jlClose()">${ic('i-plus')}</button></div>
      ${body}
      <div class="mfoot">
        ${danger ? `<button class="btn secondary danger" onclick="jlConfirmDelete('${danger}')">${ic('i-trash', 'sm')} Delete</button>` : ''}
        <button class="btn secondary" onclick="jlClose()">Cancel</button>
        <button class="btn" onclick="jlClose(); jlToast('${doneMsg || 'Saved'}')">${okLabel || 'Save changes'}</button>
      </div>`;
    document.querySelector('#jmodal .x svg').style.transform = 'rotate(45deg)';
    wrap.classList.add('open');
  };
  window.jlConfirmDelete = function (what) {
    jlModal({
      icon: 'i-trash', title: `Delete ${what}?`,
      sub: `This removes the ${what} for everyone on the trip. There is no undo.`,
      body: '', okLabel: 'Delete', doneMsg: (what[0].toUpperCase() + what.slice(1)) + ' deleted',
    });
    const ok = document.querySelector('#jmodal .mfoot .btn:not(.secondary)');
    ok.style.background = '#B42318'; ok.style.borderColor = '#B42318';
  };

  let menuEl = null;
  window.jlMenu = function (anchor, items) {
    jlMenuClose();
    menuEl = document.createElement('div');
    menuEl.className = 'jmenu';
    menuEl.innerHTML = items.map(it => it === '-' ? '<div class="sep"></div>' :
      `<button class="mi" onclick='jlMenuClose();(${it.fn ? it.fn.toString() : '()=>{}'})()'>
         ${ic(it.icon)}<span><b>${it.label}</b>${it.sub ? `<small>${it.sub}</small>` : ''}</span></button>`).join('');
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect(), mw = 250;
    menuEl.style.top = Math.min(r.bottom + 6, innerHeight - menuEl.offsetHeight - 12) + 'px';
    menuEl.style.left = Math.max(12, Math.min(r.left, innerWidth - mw - 12)) + 'px';
    setTimeout(() => addEventListener('click', jlMenuClose, { once: true }));
  };
  window.jlMenuClose = function () { if (menuEl) { menuEl.remove(); menuEl = null; } };

  window.jlToast = function (msg) {
    document.querySelectorAll('.jtoast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'jtoast';
    t.innerHTML = `${ic('i-check')} ${msg} <span style="opacity:.6;font-weight:400">· mock</span>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  };

  const F = (label, type, value, attrs) =>
    `<div class="fld"><label>${label}</label><${type === 'select' ? 'select' : type === 'area' ? 'textarea rows="3"' : `input type="${type}"`} ${attrs || ''}${
      type === 'select' ? `>${value}</select>` : type === 'area' ? `>${value}</textarea>` : ` value="${value}">`}</div>`;

  /* ---------- per-page wiring ---------- */
  const page = document.body.dataset.page;

  const editActivity = () => jlModal({
    icon: 'i-edit', title: 'Edit activity', sub: 'D2 · Mon 30 Nov · times reflow after saving',
    danger: 'activity', doneMsg: 'Activity updated — times reflowed',
    body: `${F('Title', 'text', 'teamLab Planets')}
      <div class="mrow">${F('Starts', 'time', '10:30')}${F('Ends', 'time', '13:10')}</div>
      <div class="mrow">${F('Cost per pax', 'text', 'RM 160')}
        ${F('Who', 'select', '<option>14 pax (not Tok & Opah)</option><option>Everyone</option><option>Pick people…</option>')}</div>
      ${F('Status', 'select', '<option>Booked</option><option>Idea</option><option>Must book</option>')}
      ${F('Note', 'area', 'lunch nearby — see note below')}`,
  });

  const addExpense = () => jlModal({
    icon: 'i-receipt', title: 'Add expense', sub: 'Splits equally unless you pick people',
    okLabel: 'Add expense', doneMsg: 'Expense added — 16 shares of RM 22.50',
    body: `${F('What', 'text', 'Shinkansen snacks')}
      <div class="mrow">${F('Amount', 'text', '¥ 10,800')}
        ${F('Currency', 'select', '<option>JPY — Japanese yen</option><option>MYR — ringgit</option>')}</div>
      <div class="mrow">${F('Paid by', 'select', '<option>Hamzah (you)</option><option>Mak Long Ismah</option><option>Aina Nadhirah</option>')}
        ${F('Date', 'date', '2026-12-01')}</div>
      ${F('Split between', 'select', '<option>Everyone — 16 people</option><option>Pick people…</option>')}`,
  });

  const settle = (name, amt) => () => jlModal({
    icon: 'i-coins', title: 'Record payment', sub: `${name} · outstanding ${amt}`,
    okLabel: 'Record payment', doneMsg: `Payment recorded — ${name} settled`,
    body: `<div class="mrow">${F('Amount received', 'text', amt)}${F('Date', 'date', '2026-09-05')}</div>
      ${F('How', 'select', '<option>Bank transfer</option><option>Cash</option><option>DuitNow</option>')}
      ${F('Note', 'text', '')}`,
  });

  const newTrip = () => jlModal({
    icon: 'i-plus', title: 'New trip', sub: 'You lead it — invite people once it exists',
    okLabel: 'Create trip', doneMsg: 'Trip created — you are the leader',
    body: `${F('Trip name', 'text', 'Bandung Getaway')}
      <div class="mrow">${F('Starts', 'date', '2027-03-12')}${F('Ends', 'date', '2027-03-16')}</div>
      <div class="mrow">${F('Home currency', 'select', '<option>MYR — ringgit</option>')}
        ${F('Trip currency', 'select', '<option>IDR — rupiah</option><option>JPY — yen</option>')}</div>
      <div class="fld"><label>Cover</label>
      <div style="border:1.5px dashed var(--gray-300);border-radius:12px;padding:18px;text-align:center;color:var(--ink-3);font-size:13px">
        ${ic('i-upload')}<br>Drop an image, or leave empty —<br>Jelajah picks one from the destination</div></div>`,
  });

  if (page === 'plan') {
    document.querySelectorAll('.btn.ghost.sm').forEach(b => { if (b.querySelector('[href="#i-edit"]')) b.onclick = editActivity; });
    document.querySelectorAll('button').forEach(b => {
      if (/Data/.test(b.textContent)) b.onclick = e => { e.stopPropagation(); jlMenu(b, [
        { icon: 'i-upload', label: 'Import from sheet', sub: 'paste or upload the family template', fn: () => jlToast('Import — mock') },
        { icon: 'i-download', label: 'Export everything', sub: 'plan + ledger + notes as one file', fn: () => jlToast('Exported jelajah-jepun.xlsx') },
        { icon: 'i-file', label: 'Download blank template', sub: 'the format import expects', fn: () => jlToast('Template downloaded') },
        '-',
        { icon: 'i-copy', label: 'Copy day as text', sub: 'share D2 into the family group', fn: () => jlToast('Day copied') },
      ]); };
      if (/Add activity/.test(b.textContent)) b.onclick = () => jlModal({
        icon: 'i-plus', title: 'Add activity', sub: 'Lands at the end of D2 — drag to reorder',
        okLabel: 'Add to D2', doneMsg: 'Added to D2 — times reflowed',
        body: `${F('Title', 'text', '')}<div class="mrow">${F('Starts', 'time', '15:00')}${F('Length', 'select', '<option>1 hour</option><option>90 minutes</option><option>2 hours</option>')}</div>${F('Place', 'text', 'search Photon…')}`,
      });
    });
  }

  window.jlEmpty = (icon, title, sub, action) =>
    `<div class="empty"><span class="etile">${ic(icon)}</span><h4>${title}</h4><p>${sub}</p>${
      action ? `<button class="btn sm" onclick="jlToast('${action[1]}')">${action[0]}</button>` : ''}</div>`;

  if (page === 'money') {
    // seg tabs: Ledger keeps the page, My spend shows its empty state
    const cards = document.querySelectorAll('.stack > .card, .stack > .grid3');
    const segBtns = document.querySelectorAll('.pagehead .seg button');
    let extra = null;
    segBtns.forEach(sb => sb.addEventListener('click', () => {
      segBtns.forEach(x => x.classList.toggle('on', x === sb));
      if (extra) { extra.remove(); extra = null; }
      const t = sb.textContent.trim();
      cards.forEach((c2, i2) => c2.hidden = t === 'My spend' ? true : (t === 'Payments' ? i2 !== 2 : false));
      if (t === 'My spend') {
        extra = document.createElement('div');
        extra.className = 'card';
        extra.innerHTML = jlEmpty('i-eye', 'Your spend stays private',
          'Nothing logged yet. Add personal expenses only you can see — promote one to the shared ledger any time.',
          ['Log my first expense', 'My spend — mock']);
        document.querySelector('.stack').appendChild(extra);
      }
    }));
    document.querySelectorAll('.btn.ghost.sm').forEach(b => { if (b.querySelector('[href="#i-edit"]')) b.onclick = () => jlModal({
      icon: 'i-edit', title: 'Edit expense', sub: 'Money edits are leader-only', danger: 'expense', doneMsg: 'Expense updated',
      body: `${F('What', 'text', 'JR Passes')}<div class="mrow">${F('Amount', 'text', 'RM 148.50')}${F('Due', 'date', '2026-09-15')}</div>${F('Status', 'select', '<option>Due soon</option><option>Paid</option><option>Pay at hotel</option>')}`,
    }); });
    document.querySelectorAll('button').forEach(b => {
      if (/Add expense/.test(b.textContent)) b.onclick = addExpense;
      if (/From document/.test(b.textContent)) b.onclick = () => jlToast('Reads amounts out of an uploaded receipt — mock');
      if (/Record payment/.test(b.textContent)) b.onclick = settle('Mak Long Ismah', 'RM 1,858.50');
      if (b.textContent.trim() === 'Settle') {
        const row = b.closest('.lrow'), name = row.querySelector('b').textContent, amt = row.querySelector('.l-amt').firstChild.textContent.trim();
        b.onclick = settle(name, amt);
      }
    });
  }

  if (page === 'home') {
    document.querySelectorAll('button, .newcard').forEach(b => {
      if (/New trip|Start a new trip/.test(b.textContent)) b.onclick = newTrip;
    });
  }

  if (page === 'admin') {
    document.querySelectorAll('button').forEach(b => {
      if (/Platform invite/.test(b.textContent)) b.onclick = () => jlModal({
        icon: 'i-gift', title: 'Platform invite', sub: 'Lets someone register an account',
        okLabel: 'Create invite', doneMsg: 'Invite created — link copied',
        body: `<div class="mrow">${F('Uses', 'select', '<option>1 use</option><option>5 uses</option><option>20 uses</option>')}${F('Expires', 'select', '<option>7 days</option><option>30 days</option><option>Never</option>')}</div>${F('Note to self', 'text', 'for the badminton group')}`,
      });
    });
  }
})();
