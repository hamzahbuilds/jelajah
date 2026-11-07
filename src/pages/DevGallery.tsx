// v0.30 component gallery (docs/18 §9 step 2). Admin-only route /dev/ui —
// renders every src/ui primitive in its states so tokens, both themes and the
// date-range picker can be reviewed in the real app shell. Synthetic data only.
import { useState } from 'react';
import {
  Badge, Button, Card, DateRangePicker, EmptyState, Field, FormSheet, IconButton, List,
  ListRow, Money, PageHeader, PageSkeleton, Segmented, Skeleton, Stat,
} from '../ui';
import { ICON_NAMES } from '../components/iconDefs';
import { Icon } from '../components/Icon';

export default function DevGallery() {
  const [seg, setSeg] = useState<'day' | 'week' | 'month'>('day');
  const [trip, setTrip] = useState({ s: '2026-11-29', e: '2026-12-07' });
  const [stay, setStay] = useState({ s: '', e: '' });
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="dev-gallery">
      <PageHeader
        title="Component gallery"
        sub="Every v0.30 primitive in its states. Toggle the theme in Settings to check dark mode."
        actions={<Button icon="plus" onClick={() => setSheet(true)}>Open form sheet</Button>}
        overflow={[{ icon: 'download', label: 'Export CSV', onPick: () => {} }, '-', { icon: 'trash', label: 'Delete', danger: true, onPick: () => {} }]}
      />

      <Card title="Buttons" icon="spark">
        <div className="dev-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon="trash">Delete</Button>
          <Button size="sm" icon="plus">Small</Button>
          <Button loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}>Save (loading)</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="dev-row">
          <IconButton icon="edit" label="Edit" />
          <IconButton icon="trash" label="Delete" tone="danger" />
          <IconButton icon="more-v" label="More actions" />
          <IconButton icon="x" label="Close" />
        </div>
      </Card>

      <Card title="Badges">
        <div className="dev-row">
          <Badge>Neutral</Badge>
          <Badge tone="brand" icon="users">Leader</Badge>
          <Badge tone="success">Paid</Badge>
          <Badge tone="warning">Due 15 Sept</Badge>
          <Badge tone="danger">Needs review</Badge>
        </div>
      </Card>

      <div className="dev-grid">
        <Card><Stat label="Trip total" icon="wallet" value={8507.27} sub="8 expenses" /></Card>
        <Card><Stat label="Outstanding" icon="clock" value={6305.09} sub="74% of the total" tone="danger" /></Card>
        <Card><Stat label="Next payment" icon="calendar" value="15 Sept" sub={<Money value={50} />} /></Card>
      </div>

      <Card title="List rows" action={<Button size="sm" variant="secondary">View all</Button>}>
        <List label="Expenses">
          <ListRow icon="plane" title="Kuala Lumpur → Tokyo (OD872)" meta="Sun, 29 Nov · Hamzah · 3 people"
            value={<Money value={5508} />} menu={[{ icon: 'edit', label: 'Edit', onPick: () => {} }, { icon: 'trash', label: 'Delete', danger: true, onPick: () => {} }]} />
          <ListRow icon="hotel" title="Y's Hotel Asahikawa Ekimae" meta="20 Dec · 2 people · Trip.com"
            value={<Money value={706.07} />} badge={<Badge tone="warning">Pay at hotel</Badge>} onClick={() => {}} />
          <ListRow icon="food" title="A very long description that should wrap politely rather than overflow the row on a narrow phone" meta="Meta line that truncates with an ellipsis when it runs past the available space in the row"
            value={<Money value={12345.67} />} />
        </List>
      </Card>

      <Card title="Segmented">
        <Segmented label="Plan view" value={seg} onChange={setSeg}
          options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </Card>

      <Card title="Fields and date ranges">
        <form className="dev-form" onSubmit={e => e.preventDefault()}>
          <Field label="Trip name" required hint="Shown to everyone on the trip">
            <input name="name" />
          </Field>
          <Field label="Amount (MYR)" required>
            <input name="amount" type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" />
          </Field>
          <DateRangePicker label="Trip dates" mode="trip" start={trip.s} end={trip.e} required
            onChange={(s, e) => setTrip({ s, e })} names={['start_date', 'end_date']} />
          <DateRangePicker label="Stay dates" mode="stay" start={stay.s} end={stay.e}
            highlight={{ start: trip.s, end: trip.e }} hint="The trip's dates are shaded"
            onChange={(s, e) => setStay({ s, e })} names={['check_in', 'check_out']} />
          <Button type="submit">Submit (shows field errors)</Button>
        </form>
      </Card>

      <Card title="Empty and loading states">
        <EmptyState icon="receipt" title="No expenses yet" text="Add the first booking or receipt and Jelajah splits it for you." action={<Button size="sm" icon="plus">Add expense</Button>} />
        <EmptyState compact icon="check" text="Everything is settled." />
        <Skeleton lines={3} card={false} />
      </Card>

      <Card title={`Icons (${ICON_NAMES.length})`}>
        <ul className="dev-icons">
          {ICON_NAMES.map(n => <li key={n}><Icon name={n} size={20} /><span>{n}</span></li>)}
        </ul>
      </Card>

      <Card title="Page skeleton"><PageSkeleton /></Card>

      <FormSheet open={sheet} onClose={() => setSheet(false)} title="Add expense" icon="plus" sub="Form sheet: full screen on phones"
        onSubmit={() => setSheet(false)}
        footer={<><Button variant="secondary" onClick={() => setSheet(false)}>Cancel</Button><Button type="submit">Save</Button></>}>
        <fieldset className="ui-fieldset">
          <legend>What</legend>
          <Field label="Description" required><input name="desc" /></Field>
          <Field label="Notes"><textarea name="notes" /></Field>
        </fieldset>
        <fieldset className="ui-fieldset">
          <legend>When</legend>
          <DateRangePicker label="Stay dates" mode="stay" start={stay.s} end={stay.e}
            highlight={{ start: trip.s, end: trip.e }} onChange={(s, e) => setStay({ s, e })} />
        </fieldset>
      </FormSheet>
    </div>
  );
}
