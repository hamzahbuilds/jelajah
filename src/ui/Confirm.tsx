// v0.30 (docs/18 R6): in-app confirmation instead of window.confirm().
// window.confirm blocks the page, can't be styled or translated beyond the
// message, and gives no context. This is a native modal <dialog> (Dialog.tsx)
// driven by a promise:
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: t.confirmDelete, tone: 'danger', confirmLabel: t.delete }))) return;
//
// Cancel comes first in the DOM, so it gets initial focus — a stray Enter on a
// destructive prompt cancels rather than deletes. Esc / backdrop = cancel.
import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react';
import Dialog from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { AnimatePresence } from 'motion/react';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}
type ConfirmFn = (o: ConfirmOptions | string) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async o => window.confirm(typeof o === 'string' ? o : o.title));
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const confirm = useCallback<ConfirmFn>(o => new Promise<boolean>(resolve => {
    resolver.current?.(false); // a newer prompt replaces an unanswered one
    resolver.current = resolve;
    setOpts(typeof o === 'string' ? { title: o } : o);
  }), []);

  const finish = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const danger = opts?.tone === 'danger';
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AnimatePresence>{opts && (
        <Dialog onClose={() => finish(false)} className="modalwrap modal ui-confirm" labelledBy={titleId}>
          <div className="ui-confirm-head">
            <span className={'ui-confirm-icon' + (danger ? ' danger' : '')}><Icon name={danger ? 'alert' : 'info'} size={20} /></span>
            <h2 id={titleId}>{opts.title}</h2>
          </div>
          {opts.body && <div className="ui-confirm-body" id={bodyId}>{opts.body}</div>}
          <div className="mfoot">
            <button type="button" className="btn secondary" onClick={() => finish(false)}>{opts.cancelLabel ?? t.cancel}</button>
            <button type="button" className={'btn' + (danger ? ' danger' : '')} onClick={() => finish(true)}
              aria-describedby={opts.body ? bodyId : undefined}>
              {opts.confirmLabel ?? t.confirm}
            </button>
          </div>
        </Dialog>
      )}</AnimatePresence>
    </ConfirmCtx.Provider>
  );
}
