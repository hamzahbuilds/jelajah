// v0.49 What's new: after a release is published, everyone sees it once (the
// next time they open the app). The newest note is open; earlier versions are
// listed below to scroll through. It can be reopened from the sidebar or the
// More menu, and closing it marks it seen on the account (all devices).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import Modal from '../Modal';
import { ReleaseBody, pick, releaseDate, type Release } from './releaseText';

// Tiny store so the sidebar / More menu can show a dot while something is unseen.
let unseen = false;
const subs = new Set<() => void>();
const setUnseen = (v: boolean) => { unseen = v; subs.forEach(f => f()); };
export const useWhatsNewUnseen = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => unseen, () => false);

export default function WhatsNew() {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const [data, setData] = useState<{ releases: Release[]; latest_id: number; seen_id: number } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api.get('/releases').then(r => {
      if (!live) return;
      setData(r);
      const isNew = r.latest_id > r.seen_id;
      setUnseen(isNew);
      if (isNew) {
        // Let the page finish drawing first, and never stack on top of another open dialog.
        setTimeout(() => {
          if (live && !document.querySelector('dialog[open]')) setOpen(true);
        }, 1200);
      }
    }).catch(() => { /* release notes are optional */ });
    const onOpen = () => setOpen(true);
    window.addEventListener('jl-whats-new-open', onOpen);
    return () => { live = false; window.removeEventListener('jl-whats-new-open', onOpen); };
  }, []);

  const close = () => {
    setOpen(false);
    if (data && data.latest_id > data.seen_id) {
      setData({ ...data, seen_id: data.latest_id });
      setUnseen(false);
      api.post('/releases/seen', { id: data.latest_id }).catch(() => { /* shows again next time; harmless */ });
    }
  };

  if (!data) return null;
  const [latest, ...earlier] = data.releases;
  return (
    <Modal open={open} onClose={close} icon="sparkles" className="whats-new" closeLabel={t.close}
      title={ms ? 'Apa yang baharu' : "What's new"}
      sub={latest ? `${latest.version} · ${releaseDate(latest.published_at, ms)}` : undefined}
      footer={<button type="button" className="btn" onClick={close}>{ms ? 'Faham' : 'Got it'}</button>}>
      <div className="whats-new-scroll">
        {!latest ? <p className="muted">{ms ? 'Belum ada nota keluaran.' : 'No release notes yet.'}</p> : <>
          <article className="release-latest">
            <h3>{pick(latest, ms).title}</h3>
            <ReleaseBody text={pick(latest, ms).body} />
          </article>
          {earlier.length > 0 && <section className="release-history" aria-labelledby="release-history-h">
            <h3 id="release-history-h">{ms ? 'Kemas kini terdahulu' : 'Earlier updates'}</h3>
            {earlier.map(r => (
              <details key={r.id}>
                <summary><b>{pick(r, ms).title}</b><small>{r.version} · {releaseDate(r.published_at, ms)}</small></summary>
                <ReleaseBody text={pick(r, ms).body} />
              </details>
            ))}
          </section>}
        </>}
      </div>
    </Modal>
  );
}
