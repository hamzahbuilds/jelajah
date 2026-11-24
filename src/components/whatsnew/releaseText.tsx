// v0.49 Release note text: "## Heading" lines, "- bullet" lines, other lines as
// paragraphs. Rendered as text only (no HTML from the note is ever injected).
export function ReleaseBody({ text }: { text: string }) {
  const blocks: Array<{ kind: 'h' | 'p'; text: string } | { kind: 'ul'; items: string[] }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) blocks.push({ kind: 'h', text: line.slice(3) });
    else if (/^[-*•] /.test(line)) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ul') last.items.push(line.slice(2)); else blocks.push({ kind: 'ul', items: [line.slice(2)] });
    } else blocks.push({ kind: 'p', text: line });
  }
  return (
    <div className="release-body">
      {blocks.map((b, i) => b.kind === 'h' ? <h4 key={i}>{b.text}</h4> : b.kind === 'ul' ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul> : <p key={i}>{b.text}</p>)}
    </div>
  );
}

export interface Release {
  id: number; version: string; title_en: string; title_ms: string; body_en: string; body_ms: string;
  status: 'draft' | 'published'; ai_drafted: number; created_at: string; published_at: string | null;
}

/** Malay when written, else English. */
export const pick = (r: Release, ms: boolean) => ({
  title: ms && r.title_ms ? r.title_ms : r.title_en,
  body: ms && r.body_ms ? r.body_ms : r.body_en,
});

/** "25 Nov 2026" from a SQLite UTC timestamp. */
export const releaseDate = (at: string | null, ms: boolean) => at
  ? new Date(at.replace(' ', 'T') + (/[zZ]$/.test(at) ? '' : 'Z')).toLocaleDateString(ms ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
  : '';

/** Open the What's new dialog from anywhere (sidebar, More sheet, settings). */
export const openWhatsNew = () => window.dispatchEvent(new Event('jl-whats-new-open'));
