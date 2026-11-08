// v0.32 Plan with AI composer (docs/20 §4.1). One component, two looks:
// `hero` (home page — mode switch, examples, "create manually") and `chat`
// (bottom of the chat planner). Enter sends, Shift+Enter is a newline, and the
// IME check keeps Japanese/Chinese/Korean input from sending mid-conversion.
import { useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { Segmented } from '../ui';
import { toImageData, type ImageData64 } from '../lib/imageData';
import { useToast } from './Toast';
import './planAi.css';

export type ComposerMode = 'plan' | 'import';
export interface ComposerSubmit { mode: ComposerMode; text: string; images: ImageData64[] }

export default function PlanComposer({ variant, mode, onModeChange, onSubmit, busy, disabled, onManual, autoFocus, refine, planSlot }: {
  variant: 'hero' | 'chat';
  mode: ComposerMode;
  onModeChange?: (m: ComposerMode) => void;
  onSubmit: (v: ComposerSubmit) => void;
  busy?: boolean;
  disabled?: boolean;
  onManual?: () => void;
  autoFocus?: boolean;
  /** A draft exists: the box is for asking changes (or another link). */
  refine?: boolean;
  /** v0.36: hero in plan mode shows this (the trip brief's country step) instead of the text box. */
  planSlot?: ReactNode;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageData64[]>([]);

  const canSend = !busy && !disabled && (text.trim().length > 0 || images.length > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    onSubmit({ mode, text: text.trim(), images });
    setText('');
    setImages([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    // isComposing alone misses Safari's out-of-order confirm keydown; keyCode 229 catches it.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    formRef.current?.requestSubmit();
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = 4 - images.length;
    try {
      const next = await Promise.all([...files].filter(f => f.type.startsWith('image/')).slice(0, room).map(toImageData));
      setImages(cur => [...cur, ...next].slice(0, 4));
    } catch { toast(t.aiError); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const examples = [t.planExample1, t.planExample2, t.planExample3];
  const placeholder = refine ? t.composerRefinePh : mode === 'import' ? t.composerImportPh : t.composerPlanPh;

  return (
    <form ref={formRef} className={`pc pc-${variant}`} onSubmit={submit} aria-busy={busy || undefined} data-off={disabled || undefined}>
      {variant === 'hero' && (
        <div className="pc-hero-head">
          <h2>{t.composerHeading}</h2>
          <p>{disabled ? t.aiOffHome : t.composerSub}</p>
        </div>
      )}
      {variant === 'hero' && onModeChange && !disabled && (
        // Three ways to start (v0.38): plan with AI, import a link, or the manual form (opens a sheet, not a mode).
        <Segmented<ComposerMode | 'manual'> className="pc-modes" label={t.composerMode} value={mode}
          onChange={v => (v === 'manual' ? onManual?.() : onModeChange(v))}
          options={[
            { value: 'plan', label: t.planWithAi, icon: 'sparkles' },
            { value: 'import', label: t.importFromLink, icon: 'link' },
            ...(onManual ? [{ value: 'manual' as const, label: t.createManually, icon: 'edit' as const }] : []),
          ]} />
      )}
      {variant === 'hero' && mode === 'plan' && planSlot && !disabled ? planSlot : <>
      <div className="pc-box">
        <label htmlFor={`${id}-ta`} className="sr-only">{t.composerLabel}</label>
        <textarea id={`${id}-ta`} className="pc-input" value={text} rows={variant === 'hero' ? 3 : 1}
          placeholder={placeholder} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown}
          onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          disabled={disabled} autoFocus={autoFocus} enterKeyHint="send" />
        {images.length > 0 && (
          <ul className="pc-thumbs" aria-label={t.composerScreenshotsNote(images.length)}>
            {images.map((img, i) => (
              <li key={i}>
                <img src={img.preview} alt="" />
                <button type="button" className="pc-thumb-x" aria-label={t.removeImage}
                  onClick={() => setImages(images.filter((_, k) => k !== i))}><Icon name="x" size={16} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="pc-actions">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => addFiles(e.target.files)} />
          {(variant === 'chat' || mode === 'import') && (
            <button type="button" className="pc-tool" onClick={() => fileRef.current?.click()}
              disabled={disabled || images.length >= 4} aria-label={t.addScreenshots} title={t.addScreenshots}>
              <Icon name="camera" size={20} />{variant === 'hero' && <span>{t.addScreenshots}</span>}
            </button>
          )}
          <span className="pc-spacer" />
          <button type="submit" className="pc-send" disabled={!canSend} aria-label={t.send}>
            <Icon name={busy ? 'refresh' : 'arrow-r'} size={20} className={busy ? "pc-spin" : undefined} />
          </button>
        </div>
      </div>
      {variant === 'hero' && mode === 'plan' && !disabled && (
        <div className="pc-examples">
          {examples.map(x => (
            <button key={x} type="button" className="chip" onClick={() => setText(x)}>{x}</button>
          ))}
        </div>
      )}
      </>}

    </form>
  );
}
