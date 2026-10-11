import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';

/** Shared progressive disclosure for both group and personal plan transport. */
export default function TransportLeg({ title, mode, summary, children }: {
  title: string; mode: string; summary: string; children: ReactNode;
}) {
  const { lang } = useT();
  return <details className="journey-transport">
    <summary>
      <span className="transport-symbol"><Icon name={mode === 'walk' ? 'walk' : ['car','taxi','drive'].includes(mode) ? 'car' : 'train'} size={20} /></span>
      <span className="transport-copy"><strong>{title}</strong><small>{summary}</small></span>
      <span className="transport-open">{lang === 'ms' ? 'Pilihan' : 'Options'} <span aria-hidden="true">⌄</span></span>
    </summary>
    <div className="transport-content">{children}</div>
  </details>;
}

