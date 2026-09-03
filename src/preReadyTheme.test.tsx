import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOOT_THEME_ATTRIBUTE } from './bootTheme.js';
import { palette } from './brand.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 THE PRE-`ready` THEME SENTINEL — the defect this file pins.
 *
 * `useBlockContext()` returns the SDK's pre-init snapshot until `BLOCK_INIT`
 * lands, and that snapshot hardcodes `theme: 'light'`
 * (`@civitai/blocks-react` → `dist/internal/transport.js`, `EMPTY_SNAPSHOT`).
 * So before `ready`, `theme` is `'light'` for EVERY viewer — a sentinel, not a
 * signal, and indistinguishable from a host that really is light.
 *
 * index.html paints its boot skeleton DARK (this app's documented default). A
 * React first commit that honoured the sentinel therefore produced
 * dark → light → dark, and `bootSkeleton: true` is exactly what stood down the
 * host's opaque veil that used to hide it.
 *
 * 🔴 SO THE MOCK BELOW SEEDS `theme: 'light'` WHILE `ready` IS FALSE, ON
 * PURPOSE. That is the real SDK value, and reproducing it is what makes these
 * tests able to fail: a fixture that seeded `theme: 'dark'` pre-ready would
 * agree with the correct answer by accident and could never see the bug.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const h = vi.hoisted(() => ({
  ctx: {
    ready: false as boolean,
    viewer: null as { id: number; username: string | null } | null,
    // The SDK's EMPTY_SNAPSHOT value. Do not "fix" this to match the host.
    theme: 'light' as 'light' | 'dark',
  },
  shared: {
    list: vi.fn(),
    get: vi.fn(),
    append: vi.fn(),
    update: vi.fn(),
    vote: vi.fn(),
    unvote: vi.fn(),
    withdraw: vi.fn(),
    report: vi.fn(),
    getCount: vi.fn(),
    getCounts: vi.fn(),
  },
  requestSignIn: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@civitai/blocks-react', () => ({
  useBlockContext: () => h.ctx,
  useSharedStorage: () => h.shared,
  useRequestSignIn: () => ({ requestSignIn: h.requestSignIn }),
  useBlockAnalytics: () => ({ track: h.track }),
  useBlockResize: () => {},
  getTransport: () => ({}),
}));

import { App } from './App.js';

/** What index.html's inline script recorded on `<html>`, or nothing. */
function setPainted(value: 'dark' | 'light' | null): void {
  if (value === null) document.documentElement.removeAttribute(BOOT_THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(BOOT_THEME_ATTRIBUTE, value);
}

/** A deterministic OS answer. Reduced motion is always "no" so rows animate normally. */
function setOsPreference(mode: 'light' | 'dark'): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      if (/prefers-reduced-motion/.test(query)) return { matches: false, media: query };
      const wantsLight = /prefers-color-scheme:\s*light/.test(query);
      return { matches: mode === 'light' ? wantsLight : !wantsLight, media: query };
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  h.ctx.ready = false;
  h.ctx.viewer = null;
  h.ctx.theme = 'light';
  h.shared.list.mockResolvedValue({ items: [], nextCursor: undefined });
  h.shared.getCounts.mockResolvedValue({});
  setPainted(null);
  setOsPreference('dark');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPainted(null);
});

/** The theme the first React commit actually painted, read off the DOM. */
function paintedByReact(): { attr: string | null; body: string } {
  const root = screen.getByTestId('app-root');
  return { attr: root.getAttribute('data-theme'), body: root.style.getPropertyValue('--ar-body') };
}

describe('🔴 the pre-ready commit does NOT paint the SDK sentinel', () => {
  it('agrees with a DARK boot skeleton while the sentinel says light', () => {
    // The discriminating case. Sentinel = 'light', OS = light, attribute =
    // 'dark' — so 'dark' is reachable ONLY by reading what was painted. A
    // regression to `theme` returns 'light'; a regression to the OS query
    // returns 'light' too.
    setPainted('dark');
    setOsPreference('light');
    render(<App />);

    expect(paintedByReact()).toEqual({ attr: 'dark', body: palette('dark').body });
  });

  it('agrees with a LIGHT boot skeleton against a dark-mode OS', () => {
    // The other direction. Sentinel = 'light' here too, so this one cannot see a
    // sentinel regression — it exists to catch the OS-query regression, which
    // the case above cannot see. Neither is sufficient alone.
    setPainted('light');
    setOsPreference('dark');
    render(<App />);

    expect(paintedByReact()).toEqual({ attr: 'light', body: palette('light').body });
  });

  it('falls back to the OS the same way the stylesheet does when nothing was painted', () => {
    // Boot script blocked or absent: index.html's unconditioned rules are dark
    // and a dark-mode OS keeps them dark, so React must too — while the sentinel
    // still says light.
    setPainted(null);
    setOsPreference('dark');
    render(<App />);

    expect(paintedByReact()).toEqual({ attr: 'dark', body: palette('dark').body });
  });

  it('and still resolves LIGHT for a light-mode OS with nothing painted', () => {
    // 🔴 Positive control: without it, the three "dark" answers above are
    // indistinguishable from a pre-ready path hardcoded to dark.
    setPainted(null);
    setOsPreference('light');
    render(<App />);

    expect(paintedByReact()).toEqual({ attr: 'light', body: palette('light').body });
  });
});

describe('once ready, the HOST wins — unchanged behaviour', () => {
  it.each(['light', 'dark'] as const)('paints the host theme %s, ignoring the attribute', (host) => {
    // The attribute and the OS are both set to the OPPOSITE of the host, so a
    // fix that kept reading the boot theme after BLOCK_INIT would be caught.
    const opposite = host === 'light' ? 'dark' : 'light';
    h.ctx.ready = true;
    h.ctx.theme = host;
    setPainted(opposite);
    setOsPreference(opposite);
    render(<App />);

    expect(paintedByReact()).toEqual({ attr: host, body: palette(host).body });
  });

  it('flips from the boot theme to the host theme when BLOCK_INIT lands', () => {
    // The behaviour end to end, in one test: dark boot state, then the host says
    // light. A regression that froze the boot theme would keep dark here, and no
    // single-snapshot assertion above would notice.
    setPainted('dark');
    setOsPreference('dark');
    const view = render(<App />);
    expect(paintedByReact().attr).toBe('dark');

    h.ctx.ready = true;
    h.ctx.theme = 'light';
    view.rerender(<App />);

    expect(paintedByReact()).toEqual({ attr: 'light', body: palette('light').body });
  });
});
