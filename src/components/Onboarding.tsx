// v0.35 onboarding (docs/22). Two short step-through dialogs on the native
// <dialog> (Dialog.tsx: showModal, focus return, Esc):
//   - WelcomeTour: once, right after someone's first sign-up.
//   - PlanIntro: each time someone starts a new plan, until they tick
//     "Don't show this again" (saved on the account, so every device agrees).
// Skip and Esc close; a click outside does not (too easy to lose by accident).
import { useEffect, useId, useRef, useState } from 'react';
import Dialog from './Dialog';
import { Icon } from './Icon';
import type { IconName } from './iconDefs';
import ObArt, { type ArtKind } from './ObArt';
import { useT } from '../i18n';
import { AnimatePresence, StepSwap, motion } from '../lib/motionKit';
import { blur, scale, spring, transition as tk, useTempoTransition } from '@animate-ui/react/utils/motion';
import './onboarding.css';

export interface Step { icon: IconName; title: string; text: string; /** v0.41 animated scene; falls back to the icon tile. */ art?: ArtKind }

interface StepsDialogProps {
  steps: Step[];
  /** Label of the last step's primary button. */
  finishLabel: string;
  /** done = reached the end (Finish); false = skipped (Skip / Esc). */
  onClose: (done: boolean, extra: { dontShow: boolean }) => void;
  /** Optional "Don't show this again" checkbox. */
  dontShowLabel?: string;
  /** Extra action on the last step, e.g. "Plan my first trip". */
  secondary?: { label: string; onClick: () => void };
}

export function StepsDialog({ steps, finishLabel, onClose, dontShowLabel, secondary }: StepsDialogProps) {
  const { t } = useT();
  const id = useId();
  const [i, setI] = useState(0);
  const [dontShow, setDontShow] = useState(false);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const go = (n: number) => { setDir(n > i ? 'fwd' : 'back'); setI(n); };
  const swap = useTempoTransition(tk.swap);
  const slide = useTempoTransition(spring.selection);
  const dotsId = useId();
  const step = steps[i];
  const last = i === steps.length - 1;
  // Focus the primary button on open and after each step change. useEffect
  // runs after Dialog's layout effect has called showModal(), so this wins
  // over the dialog's default first-control focus (Skip).
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => { primary.current?.focus(); }, [i]);

  return (
    <Dialog className="modalwrap modal ob" labelledBy={`${id}-t`} lightDismiss={false}
      onClose={() => onClose(false, { dontShow })}>
      {/* the step's icon swaps in place (Animate UI swap: scale.icon + blur.icon on transition.swap) */}
      <div className={step.art ? 'ob-scene' : 'ob-art'} aria-hidden="true">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={step.art ?? step.icon} className="ob-art-icon"
            initial={{ opacity: 0, scale: scale.icon, filter: blur.icon }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: swap }}
            exit={{ opacity: 0, scale: scale.icon, filter: blur.icon, transition: swap }}>
            {step.art ? <ObArt kind={step.art} /> : <Icon name={step.icon} size={24} />}
          </motion.span>
        </AnimatePresence>
      </div>
      {/* aria-live so moving between steps is announced without moving focus off the buttons */}
      <StepSwap stepKey={String(i)} dir={dir} className="ob-body">
        <div aria-live="polite">
          <p className="ob-count">{t.obStepOf(i + 1, steps.length)}</p>
          <h2 id={`${id}-t`}>{step.title}</h2>
          <p>{step.text}</p>
        </div>
      </StepSwap>
      <ol className="ob-dots" aria-hidden="true">
        {steps.map((_, k) => (
          <li key={k} className={k === i ? 'on' : ''}>
            {k === i && <motion.span className="ob-dot-pill" layoutId={dotsId} transition={slide} />}
          </li>
        ))}
      </ol>
      {dontShowLabel && (
        <label className="ob-dontshow">
          <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)} />
          <span>{dontShowLabel}</span>
        </label>
      )}
      <div className="ob-foot">
        {!last && <button type="button" className="btn ghost" onClick={() => onClose(false, { dontShow })}>{t.obSkip}</button>}
        {i > 0 && <button type="button" className="btn secondary" onClick={() => go(i - 1)}>{t.obBack}</button>}
        {last && secondary && (
          <button type="button" className="btn secondary" onClick={secondary.onClick}>{secondary.label}</button>
        )}
        <button type="button" className="btn" ref={primary}
          onClick={() => (last ? onClose(true, { dontShow }) : go(i + 1))}>
          {last ? finishLabel : t.obContinue}
          {!last && <Icon name="arrow-r" size={16} />}
        </button>
      </div>
    </Dialog>
  );
}

/** First sign-up. `onPlan` takes them straight to a new plan. */
export function WelcomeTour({ name, onClose, onPlan }: { name: string; onClose: () => void; onPlan: () => void }) {
  const { t } = useT();
  const first = name.trim().split(/\s+/)[0] || name;
  const steps: Step[] = [
    { icon: 'spark', art: 'route', title: t.obWelcomeTitle(first), text: t.obWelcomeText },
    { icon: 'sparkles', art: 'ai', title: t.obAiTitle, text: t.obAiText },
    { icon: 'users', art: 'together', title: t.obTogetherTitle, text: t.obTogetherText },
  ];
  return (
    <StepsDialog steps={steps} finishLabel={t.obPlanFirst}
      secondary={{ label: t.obLookAround, onClick: onClose }}
      onClose={done => (done ? onPlan() : onClose())} />
  );
}

/** Before a new plan. Continue walks the 3 steps; Skip goes straight in. */
export function PlanIntro({ onClose }: { onClose: (dontShowAgain: boolean) => void }) {
  const { t } = useT();
  const steps: Step[] = [
    { icon: 'chat', art: 'chat', title: t.obPlan1Title, text: t.obPlan1Text },
    { icon: 'link', art: 'link', title: t.obPlan2Title, text: t.obPlan2Text },
    { icon: 'list-check', art: 'checklist', title: t.obPlan3Title, text: t.obPlan3Text },
  ];
  return (
    <StepsDialog steps={steps} finishLabel={t.obStartPlanning} dontShowLabel={t.obDontShow}
      onClose={(_, x) => onClose(x.dontShow)} />
  );
}
