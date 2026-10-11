import { useT } from '../i18n';
import { Icon } from './Icon';

export default function PlanDaySummary({ title, count, completed, minutes, next, partial = false }: {
  title: string; count: number; completed: number; minutes: number; next?: string; partial?: boolean;
}) {
  const { lang } = useT();
  const ms = lang === 'ms';
  const progress = count ? Math.round(completed / count * 100) : 0;
  return <section className="day-overview" aria-label={ms ? 'Ringkasan hari' : 'Day overview'}>
    <div className="day-overview-copy">
      <span className="journal-eyebrow">{ms ? 'Satu hari, banyak kenangan' : 'A day worth exploring'}</span>
      <h2>{title}</h2>
      <p>{next ? `${ms ? 'Seterusnya dalam senarai' : 'Next on your list'}: ${next}` : count ? (ms ? 'Semua aktiviti selesai. Nikmati masa lapang.' : 'Everything checked off. Enjoy a little free time.') : (ms ? 'Mulakan dengan satu tempat yang ingin dilawati.' : 'Start with one place you would love to visit.')}</p>
    </div>
    <div className="day-overview-stats">
      <span><Icon name="pin" size={20} /><strong>{count}</strong>{ms ? 'aktiviti' : 'activities'}</span>
      <span><Icon name="clock" size={20} /><strong>{minutes || '—'}</strong>{partial ? (ms ? 'min laluan tersedia' : 'known route min') : (ms ? 'min perjalanan anggaran' : 'estimated travel min')}</span>
      <div className="day-progress"><span>{completed}/{count} {ms ? 'selesai' : 'completed'}</span><progress value={progress} max={100} aria-label={ms ? 'Aktiviti selesai' : 'Completed activities'} /></div>
    </div>
  </section>;
}

