/** Brand-shaped progress indicator; stays static when reduced motion is requested. */
export default function Loading({ label = 'Loading…', compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`jelajah-loading${compact ? ' compact' : ''}`} role="status" aria-live="polite">
    <svg viewBox="0 0 128 128" aria-hidden="true">
      <rect width="128" height="128" rx="30" fill="#116B58" />
      <path className="loading-j" pathLength="100" d="M32 80c0 13 9 21 22 21s22-8 22-22V57" fill="none" stroke="white" strokeWidth="12" strokeLinecap="round" />
      <circle className="loading-dot" cx="0" cy="0" r="8" fill="#9FDAC0" />
    </svg><span>{label}</span>
  </div>;
}
