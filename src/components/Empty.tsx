// Jelajah UI refresh — empty state (ported from prototype `.empty`/`.etile`).
// All copy arrives as props — this component has no i18n of its own.
import { Icon, type IconName } from './Icon';

export interface EmptyProps {
  icon: IconName;
  title: string;
  sub: string;
  action?: { label: string; onClick: () => void };
}

export default function Empty({ icon, title, sub, action }: EmptyProps) {
  return (
    <div className="empty">
      <span className="etile"><Icon name={icon} className="icon" /></span>
      <h4>{title}</h4>
      <p>{sub}</p>
      {action && <button type="button" className="btn sm" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
