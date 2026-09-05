import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon, IconDefs } from './Icon';

// Task 5 (P4 UI refresh) — carousel for the /login and /join split layout.
// NO photos, NO external URLs (RM0 / no-picsum ruling): each slide is a
// layered CSS gradient (literal hex, exempt from the token-only rule — see
// the comment in styles.css) plus a large low-opacity emoji "scene". The
// background is set inline per-slide below; that inline `style` is the swap
// point noted for future licensed photography (see styles.css comment).
const SLIDES = [
  {
    key: 'caro1',
    scene: '⛩️',
    gradient:
      'radial-gradient(circle at 30% 20%, rgba(255,201,140,.55), transparent 55%), ' +
      'linear-gradient(160deg, #f9a66c 0%, #d9534f 40%, #7a2140 75%, #2b1220 100%)',
  },
  {
    key: 'caro2',
    scene: '🏝️',
    gradient:
      'radial-gradient(circle at 70% 15%, rgba(255,255,255,.35), transparent 50%), ' +
      'linear-gradient(160deg, #4fc3e8 0%, #1f6fb2 45%, #123c66 80%, #051b2e 100%)',
  },
  {
    key: 'caro3',
    scene: '🎈',
    gradient:
      'radial-gradient(circle at 25% 25%, rgba(255,214,165,.5), transparent 55%), ' +
      'linear-gradient(160deg, #ffb199 0%, #e07a5f 35%, #6a3f6b 70%, #241934 100%)',
  },
  {
    key: 'caro4',
    scene: '🏔️',
    gradient:
      'radial-gradient(circle at 75% 20%, rgba(180,255,220,.35), transparent 55%), ' +
      'linear-gradient(160deg, #3fae7a 0%, #1f7a5c 40%, #124a44 75%, #08211f 100%)',
  },
  {
    key: 'caro5',
    scene: '🏙️',
    gradient:
      'radial-gradient(circle at 60% 15%, rgba(255,180,220,.35), transparent 55%), ' +
      'linear-gradient(160deg, #7b5ea7 0%, #4a3a7a 40%, #241b45 75%, #0d0a1f 100%)',
  },
] as const;

const INTERVAL_MS = 6000;

export default function AuthCarousel() {
  const { t } = useT();
  const [i, setI] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const reducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stopTimer = () => {
    if (timerRef.current !== undefined) clearInterval(timerRef.current);
    timerRef.current = undefined;
  };

  const startTimer = () => {
    stopTimer();
    if (reducedMotion()) return;
    timerRef.current = setInterval(() => {
      setI(prev => (prev + 1) % SLIDES.length);
    }, INTERVAL_MS);
  };

  useEffect(() => {
    startTimer();
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dotClick = (idx: number) => {
    setI(idx);
    startTimer(); // manual click restarts the auto-advance timer
  };

  const captions = [
    { where: t.caro1Where, head: t.caro1Head, hook: t.caro1Hook },
    { where: t.caro2Where, head: t.caro2Head, hook: t.caro2Hook },
    { where: t.caro3Where, head: t.caro3Head, hook: t.caro3Hook },
    { where: t.caro4Where, head: t.caro4Head, hook: t.caro4Hook },
    { where: t.caro5Where, head: t.caro5Head, hook: t.caro5Hook },
  ];
  const c = captions[i];

  return (
    <div className="caro">
      {/* Login/Join render outside <Shell>, which is where <IconDefs> normally
          lives — mount it here too so <Icon> resolves on both auth pages. */}
      <IconDefs />
      {SLIDES.map((s, idx) => (
        <div
          key={s.key}
          className={`ph${idx === i ? ' on' : ''}`}
          style={{ backgroundImage: s.gradient }}
        >
          <span className="scene" aria-hidden="true">{s.scene}</span>
        </div>
      ))}
      <div className="veil" />
      <div className="brand">
        <span className="logo"><Icon name="pin" size={20} /></span>
        <strong>{t.appName}</strong>
      </div>
      <div className="cap">
        <div className="where"><Icon name="pin" size={16} /><span>{c.where}</span></div>
        <div className="place">{c.head}</div>
        <div className="hook">{c.hook}</div>
        <div className="dots">
          {SLIDES.map((s, idx) => (
            <i
              key={s.key}
              className={idx === i ? 'on' : ''}
              role="button"
              aria-label={captions[idx].where}
              onClick={() => dotClick(idx)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
