// v0.47 Settings → Money (leader only). The trip currency every balance is
// kept in, plus the switch for entering amounts in other currencies. Basic
// mode (switch off) is one currency and no exchange rates. Changing the trip
// currency after money exists converts every stored amount, after a confirm
// that shows the rate.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useConfirm } from '../ui/Confirm';
import { useToast } from './Toast';
import { Icon } from './Icon';

export default function TripMoneyCard({ tripId, trip, reload }: { tripId: number; trip: any; reload: () => void }) {
  const { t } = useT();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [all, setAll] = useState<Array<{ code: string; name: string }>>([]);
  const [pick, setPick] = useState<string>(trip.base_currency ?? 'MYR');
  const [busy, setBusy] = useState(false);
  const [multi, setMulti] = useState(!!trip.multi_currency);
  useEffect(() => { api.get('/currencies').then(setAll).catch(() => setAll([])); }, []);
  useEffect(() => { setPick(trip.base_currency ?? 'MYR'); setMulti(!!trip.multi_currency); }, [trip.base_currency, trip.multi_currency]);

  const base: string = trip.base_currency ?? 'MYR';

  const toggleMulti = (on: boolean) => {
    setMulti(on);
    api.patch(`/trips/${tripId}`, { multi_currency: on })
      .then(() => { toast(t.tVisibilitySaved); reload(); })
      .catch(() => { setMulti(!on); toast(t.tSaveFailed, 'error'); });
  };

  const change = async () => {
    if (pick === base) return;
    setBusy(true);
    try {
      let body: any = { base_currency: pick };
      if (trip.money_locked) {
        const today = new Date().toISOString().slice(0, 10);
        let rate: number;
        try { rate = (await api.get(`/fx?date=${today}&from=${base}&to=${pick}`)).rate; }
        catch { toast(t.fxUnavailable, 'error'); return; }
        const shown = rate.toLocaleString(undefined, { maximumSignificantDigits: 6 });
        const ok = await confirm({
          title: t.convertTitle(base, pick), body: t.convertBody(shown, base, pick),
          confirmLabel: t.convertGo, tone: 'danger',
        });
        if (!ok) return;
        body = { ...body, convert: true, rate };
      }
      await api.patch(`/trips/${tripId}/currencies`, body);
      toast(t.currencyChanged);
      reload();
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'fx_unavailable' ? t.fxUnavailable : t.tSaveFailed, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="cardhead"><h2><Icon name="swap" /> {t.moneyTitle}</h2></div>
      <label className="fld"><span>{t.fxRefCurrency}</span>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <select value={pick} onChange={e => setPick(e.target.value)} aria-describedby="money-ref-hint">
            {all.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
            {!all.some(c => c.code === pick) && <option value={pick}>{pick}</option>}
          </select>
          {pick !== base && (
            <button type="button" className="btn sm" disabled={busy} onClick={change}>
              {busy ? '…' : t.changeCurrency}
            </button>
          )}
        </div>
        <span id="money-ref-hint" className="tiny muted">{t.fxRefHint}</span>
      </label>
      <label className="check-row divided">
        <input type="checkbox" role="switch" {...{ switch: '' }} checked={multi} onChange={e => toggleMulti(e.target.checked)} />
        <span><Icon name="swap" size={16} /> {t.multiCurrency}</span>
      </label>
      <p className="hint" style={{ marginTop: 0 }}>{t.multiCurrencyHint}</p>
    </div>
  );
}
