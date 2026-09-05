// v0.12 global toast system — every add/save/delete confirms itself.
// success: trip-accent check, auto-dismiss; error: red, stays until tapped.
// v0.19: pill restyle (.toast, ported from prototype .jtoast) — API/logic unchanged.
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface ToastMsg { id: number; text: string; kind: 'ok' | 'error'; leaving?: boolean }

const ToastCtx = createContext<{ toast: (text: string, kind?: 'ok' | 'error') => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setList(prev => prev.map(m => (m.id === id ? { ...m, leaving: true } : m)));
    setTimeout(() => setList(prev => prev.filter(m => m.id !== id)), 250);
  }, []);

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = nextId.current++;
    setList(prev => [...prev.slice(-3), { id, text, kind }]);
    if (kind === 'ok') setTimeout(() => dismiss(id), 2600);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {list.map(m => (
          <div key={m.id} className={`toast ${m.kind} ${m.leaving ? 'leaving' : ''}`} onClick={() => dismiss(m.id)}>
            {m.kind === 'ok' ? <Icon name="check" className="i" size={16} /> : <Icon name="alert" className="i" size={16} />}
            {m.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
