import { resolveBlockTier } from '@civitai/blocks-react';
import { describe, expect, it } from 'vitest';

import { boardLayout, breakpointForWidth, layoutForWidth, type BoardLayout } from './layout.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WIDTH → LAYOUT MAPPING, WITH NO DOM.
 *
 * 🔴 EVERY FIXTURE WIDTH BELOW IS PAIRWISE DISTINCT AND DISTINCT FROM EVERY
 * CONSTANT ANY ASSERTION NAMES. That is not fussiness: a fixture that can only
 * ever produce a threshold's own value cannot see a mutant that hardcodes the
 * literal, so it SURVIVES a fully green suite. 337/412/519/703/861/1307 are
 * chosen to sit in the interior of their tiers, well away from
 * 480/768/1024/1184/1440 (civitai's scale) AND from 576/992/1200/1408
 * (Mantine's, which a copy of this scale would most plausibly drift into).
 *
 * The boundaries themselves are pinned separately, below, where naming the
 * constant is the whole point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Interior widths, one per tier the app distinguishes. Never a breakpoint value. */
const W = {
  phone: 337, // base  — narrower than xs
  phoneWide: 412, // base  — a second point in the same tier
  tablet: 519, // xs    — past the row threshold, short of the toolbar one
  tabletWide: 703, // xs  — a second point in the same tier
  desktop: 861, // sm    — the shipped layout begins here
  desktopWide: 1307, // lg — a second point above the toolbar threshold
} as const;

describe('the breakpoint scale is civitai’s px scale, not Mantine’s em scale', () => {
  // 🔴 The two scales AGREE ON 768 AND ONLY 768, so an assertion that `sm` is
  // 768 passes against the entirely wrong scale. These are the values that
  // discriminate, and they are checked against the pack's own resolver so this
  // repo never carries a second copy of the numbers.
  it('resolves the DISCRIMINATING widths, where the two scales disagree', () => {
    expect(resolveBlockTier(480), '480 is civitai xs; Mantine has no boundary there').toBe('xs');
    expect(resolveBlockTier(576), '576 is Mantine sm — it must NOT promote a tier here').toBe('xs');
    expect(resolveBlockTier(992), '992 is Mantine md — it must NOT promote a tier here').toBe('sm');
    expect(resolveBlockTier(1024), '1024 is civitai md').toBe('md');
    expect(resolveBlockTier(1184), '1184 is civitai lg').toBe('lg');
    expect(resolveBlockTier(1440), '1440 is civitai xl').toBe('xl');
  });

  it('an unmeasured or degenerate width is the most conservative tier', () => {
    expect(resolveBlockTier(0)).toBe('base');
    expect(resolveBlockTier(Number.NaN)).toBe('base');
  });

  it('breakpointForWidth reports the same tier and answers atLeast/below from it', () => {
    const bp = breakpointForWidth(W.tablet);
    expect(bp.tier).toBe(resolveBlockTier(W.tablet));
    expect(bp.measured).toBe(true);
    expect(bp.atLeast('xs')).toBe(true);
    expect(bp.atLeast('sm')).toBe(false);
    expect(bp.below('sm')).toBe(true);
    expect(bp.below('xs')).toBe(false);
  });
});

describe('the toolbar stacks below sm (768) and only below sm', () => {
  it(`stacks at ${W.phone} and ${W.tabletWide}`, () => {
    for (const width of [W.phone, W.phoneWide, W.tablet, W.tabletWide]) {
      const l = layoutForWidth(width);
      expect(l.toolbar, `toolbar at ${width}px must stack (it is below sm)`).toBe('stacked');
      expect(l.sortFullWidth, `sort switcher at ${width}px must stretch`).toBe(true);
      expect(l.heroAction, `hero CTA at ${width}px must take its own line`).toBe('block');
    }
  });

  it(`stays a single row at ${W.desktop} and ${W.desktopWide}`, () => {
    for (const width of [W.desktop, W.desktopWide]) {
      const l = layoutForWidth(width);
      expect(l.toolbar, `toolbar at ${width}px must stay one row (it is at or above sm)`).toBe(
        'row',
      );
      expect(l.sortFullWidth, `sort switcher at ${width}px must NOT stretch`).toBe(false);
      expect(l.heroAction, `hero CTA at ${width}px must stay inline`).toBe('inline');
    }
  });

  it('the threshold is exactly 768 — a tier applies AT its breakpoint', () => {
    expect(layoutForWidth(767).toolbar, '767 is below sm').toBe('stacked');
    expect(layoutForWidth(768).toolbar, '768 IS sm, so the toolbar is a row').toBe('row');
  });
});

describe('the request row goes compact below xs (480) and only below xs', () => {
  it(`is compact at ${W.phone} and ${W.phoneWide}`, () => {
    for (const width of [W.phone, W.phoneWide]) {
      expect(layoutForWidth(width).row, `row at ${width}px must be compact`).toBe('compact');
    }
  });

  it(`keeps the vote rail at ${W.tablet}, ${W.tabletWide}, ${W.desktop} and ${W.desktopWide}`, () => {
    // 🔴 This is the case that separates the two thresholds. At 519 and 703 the
    // TOOLBAR is stacked but the ROW is not compact — a mutant that folds both
    // decisions onto one threshold passes every test above and dies here.
    for (const width of [W.tablet, W.tabletWide, W.desktop, W.desktopWide]) {
      expect(layoutForWidth(width).row, `row at ${width}px must keep the vote rail`).toBe('regular');
    }
    expect(layoutForWidth(W.tablet).toolbar, 'and 519 is still a stacked toolbar').toBe('stacked');
  });

  it('the threshold is exactly 480 — a tier applies AT its breakpoint', () => {
    expect(layoutForWidth(479).row, '479 is below xs').toBe('compact');
    expect(layoutForWidth(480).row, '480 IS xs, so the vote rail returns').toBe('regular');
  });
});

describe('a tier that must NOT change, does not', () => {
  /** Everything except `tier`, which is expected to differ between two widths. */
  function shape(l: BoardLayout) {
    const { tier: _tier, ...rest } = l;
    return rest;
  }

  it('two widths inside the same tier produce an identical layout', () => {
    expect(
      shape(layoutForWidth(W.phone)),
      `${W.phone} and ${W.phoneWide} are both base — nothing may move between them`,
    ).toEqual(shape(layoutForWidth(W.phoneWide)));
    expect(
      shape(layoutForWidth(W.tablet)),
      `${W.tablet} and ${W.tabletWide} are both xs — nothing may move between them`,
    ).toEqual(shape(layoutForWidth(W.tabletWide)));
  });

  it('nothing moves between sm and lg — the app has no threshold up there', () => {
    // 🔴 The mirror of every test above: a mutant that adds a third threshold
    // somewhere above 768, or that pins one tier's layout, is caught here rather
    // than shipping as a silent layout change on desktop.
    expect(
      shape(layoutForWidth(W.desktop)),
      `${W.desktop} and ${W.desktopWide} straddle md and lg but the app draws no line there`,
    ).toEqual(shape(layoutForWidth(W.desktopWide)));
    expect(layoutForWidth(W.desktop).tier).not.toBe(layoutForWidth(W.desktopWide).tier);
  });
});

describe('🔴 UNMEASURED IS NOT NARROW', () => {
  /**
   * The hook reports `{ tier: 'base', measured: false }` until its
   * ResizeObserver lands — indistinguishable from a genuinely 360px slot. This
   * fixture is deliberately HOSTILE: `below()` answers `true` for every key,
   * exactly as the real unmeasured hook does. If the `measured &&` gate is
   * dropped, this renders the compact tree.
   */
  const unmeasured = {
    tier: 'base' as const,
    measured: false,
    atLeast: () => false,
    below: () => true,
  };

  it('renders the REGULAR layout even though below() says narrow for every key', () => {
    const l = boardLayout(unmeasured);
    expect(l.toolbar, 'an unmeasured block must not stack its toolbar').toBe('row');
    expect(l.row, 'an unmeasured block must not compact its rows').toBe('regular');
    expect(l.heroAction, 'an unmeasured block must not drop the hero CTA').toBe('inline');
    expect(l.sortFullWidth, 'an unmeasured block must not stretch the sort switcher').toBe(false);
    expect(l.measured).toBe(false);
    expect(l.tier).toBe('base');
  });

  it('the SAME tier, once measured, DOES go compact — positive control', () => {
    // 🔴 Without this the test above is indistinguishable from a `boardLayout`
    // wired to return the regular layout unconditionally.
    const l = boardLayout({ ...unmeasured, measured: true });
    expect(l.toolbar).toBe('stacked');
    expect(l.row).toBe('compact');
    expect(l.heroAction).toBe('block');
    expect(l.sortFullWidth).toBe(true);
  });
});
