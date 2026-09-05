// Jelajah UI refresh — page header (ported from prototype `.pagehead`).
// Every page that adopts the v0.19 chrome starts with one of these: an
// optional breadcrumb line, the h1, an optional subtitle, and optional
// right-aligned actions (buttons). All copy arrives as props — this
// component has no i18n of its own.
import type { ReactNode } from 'react';

export interface PageHeadProps {
  crumb?: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}

export default function PageHead({ crumb, title, sub, actions }: PageHeadProps) {
  return (
    <div className="pagehead">
      <div className="row">
        <div>
          {crumb && <div className="crumb">{crumb}</div>}
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}
