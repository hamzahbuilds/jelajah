// v0.48: a "thinking out loud" loader for AI work. Each step types itself out,
// holds for 3–5 seconds, then is ticked off and the next one starts. It loops
// over the last steps if the AI is still busy. Under reduced motion the steps
// appear whole (no typing, no blinking caret).
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const hold = () => 3000 + Math.random() * 2000;

export default function ThinkingSteps({ steps, label }: { steps: string[]; label: string }) {
  const [i, setI] = useState(0);          // current step
  const [typed, setTyped] = useState(0);  // characters shown of the current step
  const still = useRef(reduced());
  const step = steps[i % steps.length] ?? '';

  useEffect(() => {
    const full = still.current || typed >= step.length;
    // Type at ~28 characters a second (each step takes about a second), then hold.
    const t = setTimeout(() => {
      if (!full) { setTyped(n => n + 1); return; }
      // After the last step, keep cycling through the second half so it never looks stuck.
      const half = Math.floor(steps.length / 2);
      setI(n => (n + 1 < steps.length ? n + 1 : half + ((n + 1 - half) % (steps.length - half))));
      setTyped(0);
    }, full ? hold() : 35);
    return () => clearTimeout(t);
  }, [i, typed, step.length, steps.length]);

  const shown = still.current ? step : step.slice(0, typed);
  const done = steps.slice(0, Math.min(i, steps.length)).slice(-3);

  return (
    <div className="thinking" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <ol className="thinking-done" aria-hidden="true">
        {i < steps.length && done.map(s => <li key={s}><Icon name="check" size={16} /> {s}</li>)}
      </ol>
      <p className="thinking-now">
        <span className="thinking-dot" aria-hidden="true" />
        {/* The screen reader hears each step once, whole; the typing is visual only. */}
        <span className="sr-only">{step}</span>
        <span aria-hidden="true">{shown}<span className="thinking-caret" /></span>
      </p>
    </div>
  );
}
