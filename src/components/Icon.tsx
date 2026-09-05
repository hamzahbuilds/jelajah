// Jelajah UI refresh — inline SVG icon system.
// DEFS + ICON_NAMES live in ./iconDefs (a pure module, no JSX) so the
// vitest node tests can assert against the sprite without importing React.
export { DEFS, ICON_NAMES } from './iconDefs';
export type { IconName } from './iconDefs';
import { DEFS, type IconName } from './iconDefs';

export function IconDefs() {
  return <svg style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: DEFS }} />;
}

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: 16 | 20 | 24; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={'icon ' + className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
