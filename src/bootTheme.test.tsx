import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOOT_THEME_ATTRIBUTE, bootThemeGuess } from './bootTheme.js';

/**
 * `bootThemeGuess()` is the React half of the boot-theme contract: index.html's
 * inline script resolves a theme and records it on `<html>`, and this reads it
 * back so React's pre-`ready` commit paints the pixels already on screen.
 *
 * It lives in the `dom` project because it reads `document.documentElement` and
 * `window.matchMedia`. The shipped SCRIPT's own behaviour — first-key
 * precedence, the version gate, every fallback — is graded in
 * `bootFragment.test.ts`, against the text of index.html.
 */

function setPainted(value: string | null): void {
  if (value === null) document.documentElement.removeAttribute(BOOT_THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(BOOT_THEME_ATTRIBUTE, value);
}

/**
 * Install a deterministic OS answer.
 *
 * `'throws'` and `undefined` are separate cases on purpose: they exercise the
 * `catch` and the optional-call respectively, and only one of them is reachable
 * by deleting the global.
 */
function setOsPreference(mode: 'light' | 'dark' | 'no-preference' | 'absent' | 'throws'): void {
  if (mode === 'absent') {
    vi.stubGlobal('matchMedia', undefined);
    return;
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      if (mode === 'throws') throw new Error('matchMedia exploded');
      if (mode === 'no-preference') return { matches: false, media: query };
      const wantsLight = /prefers-color-scheme:\s*light/.test(query);
      return { matches: mode === 'light' ? wantsLight : !wantsLight, media: query };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setPainted(null);
});

describe('reads back what the boot script painted', () => {
  it.each([
    ['dark', 'light'],
    ['light', 'dark'],
  ] as const)('returns %s from the attribute even when the OS says %s', (painted, os) => {
    // 🔴 The attribute is the HOST's answer (or the script's own OS read); the
    // OS query here is deliberately the OPPOSITE, so a function that ignored the
    // attribute would return the other value. Without that opposition the test
    // could not tell the two sources apart.
    setPainted(painted);
    setOsPreference(os);
    expect(bootThemeGuess()).toBe(painted);
  });

  it('ignores an attribute value that is neither theme', () => {
    // A truncated or hand-edited attribute must not be trusted into `data-theme`
    // or `palette()`, both of which take a string.
    setPainted('blue');
    setOsPreference('light');
    expect(bootThemeGuess()).toBe('light');
  });

  it('ignores an EMPTY attribute', () => {
    setPainted('');
    setOsPreference('light');
    expect(bootThemeGuess()).toBe('light');
  });
});

describe('falls back the same way round as the stylesheet', () => {
  it('no attribute + OS light → light', () => {
    // Positive control for the whole block: the OS path must be able to produce
    // light, or every "→ dark" below is indistinguishable from a hardcoded
    // return.
    setPainted(null);
    setOsPreference('light');
    expect(bootThemeGuess()).toBe('light');
  });

  it('🔴 no attribute + NO OS preference → dark', () => {
    // index.html puts light only inside `@media (prefers-color-scheme: light)`,
    // so `no-preference` paints dark. Asking `(prefers-color-scheme: dark)` here
    // instead would answer `false` and, read as "light", disagree with the
    // pixels.
    setPainted(null);
    setOsPreference('no-preference');
    expect(bootThemeGuess()).toBe('dark');
  });

  it('no attribute + OS dark → dark', () => {
    setPainted(null);
    setOsPreference('dark');
    expect(bootThemeGuess()).toBe('dark');
  });

  it('no matchMedia at all → dark', () => {
    setPainted(null);
    setOsPreference('absent');
    expect(bootThemeGuess()).toBe('dark');
  });

  it('a matchMedia that throws → dark, not an exception', () => {
    // A throw here would white-screen the block before it ever mounted.
    setPainted(null);
    setOsPreference('throws');
    expect(() => bootThemeGuess()).not.toThrow();
    expect(bootThemeGuess()).toBe('dark');
  });

  it('the attribute still wins over a throwing matchMedia', () => {
    setPainted('light');
    setOsPreference('throws');
    expect(bootThemeGuess()).toBe('light');
  });
});
