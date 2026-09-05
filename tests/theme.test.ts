import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/theme';

describe('resolveTheme', () => {
  it('light pref ignores system', () => expect(resolveTheme('', true)).toBe(''));
  it('dark pref ignores system', () => expect(resolveTheme('dark', false)).toBe('dark'));
  it('system follows OS dark', () => expect(resolveTheme('system', true)).toBe('dark'));
  it('system follows OS light', () => expect(resolveTheme('system', false)).toBe(''));
});
