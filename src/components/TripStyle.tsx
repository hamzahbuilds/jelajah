// Trip personalisation: curated emoji + accent colour presets.
export const TRIP_EMOJI = ['🇯🇵', '🇰🇷', '🇹🇭', '🇮🇩', '🇹🇷', '🇸🇦', '✈️', '🚐', '🛳️', '🏝️', '🏔️', '🗼', '⛩️', '🏯', '🌸', '🍜', '🎢', '🕌', '🐘', '🧳'];

// Mid-tone accents that keep white text readable on the hero.
export const TRIP_COLORS = ['', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#b45309', '#475569'];

export function StylePicker({ emoji, color, onEmoji, onColor, labelIcon, labelColor }: {
  emoji: string; color: string;
  onEmoji: (e: string) => void; onColor: (c: string) => void;
  labelIcon: string; labelColor: string;
}) {
  return (
    <>
      <div className="field" style={{ marginBottom: 10 }}>
        <span style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: 'var(--ink-2)', marginBottom: 3 }}>{labelIcon}</span>
        <div className="row" style={{ gap: 4 }}>
          {TRIP_EMOJI.map(e => (
            <button type="button" key={e} className={`emoji-swatch ${emoji === e ? 'on' : ''}`} onClick={() => onEmoji(e)}>{e}</button>
          ))}
          <input value={emoji} onChange={ev => onEmoji(ev.target.value)} maxLength={4}
            style={{ width: 58, textAlign: 'center', fontSize: '1.1rem' }} aria-label={labelIcon} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <span style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: 'var(--ink-2)', marginBottom: 3 }}>{labelColor}</span>
        <div className="row" style={{ gap: 6 }}>
          {TRIP_COLORS.map(c => (
            <button type="button" key={c || 'default'} className={`color-swatch ${color === c ? 'on' : ''}`}
              style={{ background: c || 'var(--brand)' }} onClick={() => onColor(c)} aria-label={c || 'default'} />
          ))}
        </div>
      </div>
    </>
  );
}
