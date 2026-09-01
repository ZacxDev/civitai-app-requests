// 🔴 THE SKIN DEBT, ASSERTED ON THE REAL APP.
//
// `brandDepth: skin` moved light/dark correctness from the platform to us.
// `brand.test.ts` proves the PALETTE is correct in both themes; this file proves
// the app actually APPLIES it — that the values reach the DOM, that they change
// when the host flips `[data-theme]`, and that the design-system pack is
// re-pointed at them rather than keeping the platform's own colours.
//
// It also covers reduced motion behaviourally: the assertion is what the
// rendered elements DO, never that a media-query string exists somewhere.

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

import { palette } from './brand.js';
import { DURATION } from './motion.js';

const h = vi.hoisted(() => ({
  ctx: {
    ready: true as boolean,
    viewer: { id: 7777, username: 'dev' } as { id: number; username: string | null } | null,
    theme: 'dark' as 'light' | 'dark',
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

function item(o: Partial<SharedListItem> & { title: string }): SharedListItem {
  const { title, ...rest } = o;
  return {
    key: 'k1',
    authorUserId: 4021,
    value: { title },
    count: 3,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    viewerVoted: false,
    ...rest,
  };
}

/** Install a deterministic `prefers-reduced-motion` answer. */
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reduce : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  h.ctx.ready = true;
  h.ctx.viewer = { id: 7777, username: 'dev' };
  h.ctx.theme = 'dark';
  h.shared.list.mockResolvedValue({
    items: [item({ title: 'A themed request' })],
    nextCursor: undefined,
  });
  h.shared.vote.mockResolvedValue(4);
  setReducedMotion(false);
});

describe.each(['light', 'dark'] as const)('%s theme, end to end', (theme) => {
  it('writes the app palette onto the block root', async () => {
    h.ctx.theme = theme;
    render(<App />);
    await screen.findByText('A themed request');

    const root = screen.getByTestId('app-root');
    const p = palette(theme);

    expect(root).toHaveAttribute('data-theme', theme);
    expect(root.style.getPropertyValue('--ar-body')).toBe(p.body);
    expect(root.style.getPropertyValue('--ar-surface')).toBe(p.surface);
    expect(root.style.getPropertyValue('--ar-text')).toBe(p.text);
    expect(root.style.getPropertyValue('--ar-text-dim')).toBe(p.textDim);
    expect(root.style.getPropertyValue('--ar-border')).toBe(p.border);
    expect(root.style.getPropertyValue('--ar-brand')).toBe(p.brand);
    expect(root.style.getPropertyValue('--ar-brand-text')).toBe(p.brandText);
    expect(root.style.getPropertyValue('--ar-focus')).toBe(p.focus);
  });

  it('🔴 re-points the design-system pack at the app palette', async () => {
    h.ctx.theme = theme;
    render(<App />);
    await screen.findByText('A themed request');

    const root = screen.getByTestId('app-root');
    const p = palette(theme);
    // Without this the pack's Button/Card/Alert would render the PLATFORM's
    // blue-on-grey inside a brand-orange app.
    expect(root.style.getPropertyValue('--civitai-color-primary')).toBe(p.brand);
    expect(root.style.getPropertyValue('--civitai-color-surface')).toBe(p.surface);
    expect(root.style.getPropertyValue('--civitai-color-text')).toBe(p.text);
    expect(root.style.getPropertyValue('--civitai-color-border')).toBe(p.border);
  });

  it('hardcodes no colour that this theme is supposed to flip', async () => {
    h.ctx.theme = theme;
    const { container } = render(<App />);
    await screen.findByText('A themed request');

    // Every inline colour in the app chrome must come from a var(). The two
    // deliberate exceptions are the hero band's text and scrim, which sit on the
    // ARTWORK rather than on a themed surface (see Hero.tsx) — a theme-flipped
    // colour there would be unreadable in one of the two themes.
    const hero = screen.getByTestId('hero');
    const styled = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter(
      (el) => !hero.contains(el) && el !== hero,
    );
    for (const el of styled) {
      const style = el.getAttribute('style') ?? '';
      // The block root itself DEFINES the palette, so it legitimately holds hex.
      if (el.dataset.testid === 'app-root') continue;
      expect(style, style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(style).not.toMatch(/--ci-color-/);
    }
  });
});

describe('the theme actually changes when the host flips it', () => {
  it('produces different root values for light and dark', async () => {
    h.ctx.theme = 'light';
    const first = render(<App />);
    await screen.findByText('A themed request');
    const lightSurface = screen.getByTestId('app-root').style.getPropertyValue('--ar-surface');
    first.unmount();

    h.ctx.theme = 'dark';
    render(<App />);
    await screen.findByText('A themed request');
    const darkSurface = screen.getByTestId('app-root').style.getPropertyValue('--ar-surface');

    // 🔴 The positive control for this whole file: if the app ignored the host's
    // theme, both reads would be identical and every assertion above would still
    // pass while being about one theme twice.
    expect(lightSurface).not.toBe(darkSurface);
    expect(lightSurface).toBe(palette('light').surface);
    expect(darkSurface).toBe(palette('dark').surface);
  });
});

describe('prefers-reduced-motion', () => {
  it('animates rows and menus at full motion', async () => {
    setReducedMotion(false);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('A themed request');

    const row = screen.getByTestId('request-row');
    expect(row).toHaveAttribute('data-motion', 'full');
    expect(row.style.animation).toBe(`ar-row-in ${DURATION.list}ms cubic-bezier(0.2, 0, 0, 1) both`);

    await user.click(screen.getByTestId('row-menu-btn'));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-motion', 'full');
    expect(menu.style.animation).toBe(
      `ar-menu-in ${DURATION.panel}ms cubic-bezier(0.2, 0, 0, 1) both`,
    );
  });

  it('🔴 schedules NO animation at all when the viewer asks for reduced motion', async () => {
    setReducedMotion(true);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('A themed request');

    const row = screen.getByTestId('request-row');
    expect(row).toHaveAttribute('data-motion', 'reduced');
    // `none`, not "0ms" — nothing is scheduled and nothing fires transitionend.
    expect(row.style.animation).toBe('none');

    await user.click(screen.getByTestId('row-menu-btn'));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-motion', 'reduced');
    expect(menu.style.animation).toBe('none');
  });

  it('🔴 removes the vote button\'s transition too, not just the showy ones', async () => {
    setReducedMotion(true);
    render(<App />);
    await screen.findByText('A themed request');

    const vote = screen.getByTestId('vote-btn');
    expect(vote).toHaveAttribute('data-motion', 'reduced');
    expect(vote.style.transition).toBe('none');
  });

  it('the same control at FULL motion does transition — the positive control', async () => {
    setReducedMotion(false);
    render(<App />);
    await screen.findByText('A themed request');

    const vote = screen.getByTestId('vote-btn');
    expect(vote).toHaveAttribute('data-motion', 'full');
    expect(vote.style.transition).toContain(`${DURATION.control}ms`);
  });

  it('survives an environment with no matchMedia at all', async () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<App />);
    // Degrades to full motion rather than throwing and white-screening the block.
    expect(await screen.findByText('A themed request')).toBeInTheDocument();
    expect(screen.getByTestId('request-row')).toHaveAttribute('data-motion', 'full');
  });
});

describe('hero slot', () => {
  it('renders the committed placeholder artwork', async () => {
    render(<App />);
    await screen.findByText('A themed request');
    const img = screen.getByTestId('hero-image');
    const src = img.getAttribute('src') ?? '';
    // Vite inlines a small SVG as a data URI and emits a hashed file for a big
    // one, so accept either — what matters is that the slot resolved to real
    // artwork rather than an empty src.
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/(^data:image\/svg\+xml)|(\.svg)/);
    // Decorative — the name and tagline beside it carry the meaning.
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('role', 'presentation');
  });

  it('degrades to the plain band if the artwork fails to load', async () => {
    render(<App />);
    await screen.findByText('A themed request');
    fireEvent.error(screen.getByTestId('hero-image'));

    expect(screen.queryByTestId('hero-image')).toBeNull();
    // The text it sat behind is untouched.
    expect(screen.getByTestId('hero-title')).toHaveTextContent('App Requests');
  });
});
