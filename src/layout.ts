// The board's width-adaptive layout decisions, in ONE place.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHY THIS IS A CONTAINER QUERY AND NOT A MEDIA QUERY.
//
// A block renders inside a sandboxed iframe whose width is whatever slot the
// host handed it, and slot width is NOT monotonic in viewport width — the
// `model.sidebar_top` slot is ~360px at a 360px viewport and only ~430px at a
// 1440px one. So "how wide is the browser" is a question nobody here is asking.
// `useBlockBreakpoint` observes the block's own box with a ResizeObserver, which
// is the box every decision below is actually about.
//
// 🔴 AND WHY THE STRUCTURAL BRANCHES ARE GATED ON `measured`.
//
// The hook's `tier` is `'base'` until its first measurement lands, which is
// indistinguishable from a genuinely 360px slot. Painting the compact tree on
// that guess and undoing it a frame later is a visible jump — the same class of
// defect 0.3.3's boot skeleton exists to remove. So every branch here reads
// `measured && below(...)`, and the unmeasured frame renders the REGULAR layout:
// byte-for-byte the tree 0.3.3 shipped. The narrow layouts are an addition, not
// a replacement, and nothing swaps until the width is known.
//
// The two thresholds are deliberately DIFFERENT, because they solve different
// problems:
//
//   · `sm` (768px) — the toolbar. Below it the search field, the count badge and
//     the sort switcher cannot share one line without the search collapsing to a
//     stub, so the toolbar becomes two rows and the sort switcher goes
//     full-width (a fat touch target instead of a squeezed one).
//
//   · `xs` (480px) — the request row. Below it the vote pill's left rail costs
//     the title ~90px it does not have, so the pill moves down into the row's
//     own footer and the title gets the full width. Between 480 and 768 the rail
//     is fine and stays.
//
// Purely COSMETIC scaling (type size, band height) is NOT here — it is `clamp()`
// in the styles, which needs no JS and no re-render. This module is only for
// decisions that change the DOM.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveBlockTier, type BlockBreakpoint, type BlockSizeTier } from '@civitai/blocks-react';
import { BREAKPOINT_KEYS } from '@civitai/theme';

/** Ascending tier order — `base` first, then civitai's px scale. */
const TIER_ORDER: readonly BlockSizeTier[] = ['base', ...BREAKPOINT_KEYS];

export interface BoardLayout {
  /** The measured tier, verbatim from the hook. `'base'` while unmeasured. */
  tier: BlockSizeTier;
  /** Whether a ResizeObserver measurement has landed. See the header. */
  measured: boolean;
  /**
   * `'stacked'` below `sm`: search on its own row, then count + sort beneath it.
   * `'row'` is the single-line toolbar 0.3.x shipped.
   */
  toolbar: 'stacked' | 'row';
  /** Stretch the sort switcher across the toolbar's second row. */
  sortFullWidth: boolean;
  /**
   * `'block'` below `sm`: the hero CTA drops under the title at full width
   * rather than competing with it for the same line.
   */
  heroAction: 'block' | 'inline';
  /**
   * `'compact'` below `xs`: the vote pill moves out of the row's left rail and
   * into a footer line, giving the request title the full column width.
   */
  row: 'compact' | 'regular';
}

/**
 * Map a measured breakpoint onto the board's layout.
 *
 * Pure, and the ONLY place a threshold is named. Everything that renders reads
 * the result rather than re-deriving "am I narrow?" at the call site — a
 * predicate open-coded at N sites is wrong at N−1 of them.
 */
export function boardLayout(bp: BlockBreakpoint): BoardLayout {
  const narrow = bp.measured && bp.below('sm');
  const compact = bp.measured && bp.below('xs');
  return {
    tier: bp.tier,
    measured: bp.measured,
    toolbar: narrow ? 'stacked' : 'row',
    sortFullWidth: narrow,
    heroAction: narrow ? 'block' : 'inline',
    row: compact ? 'compact' : 'regular',
  };
}

/**
 * Build a `BlockBreakpoint` from a width in CSS pixels, as if it had been
 * measured.
 *
 * The tier itself comes from the pack's own `resolveBlockTier`, so this does NOT
 * restate civitai's px scale (480 / 768 / 1024 / 1184 / 1440) — restating it is
 * how a copy drifts, and the scale it would most plausibly drift INTO is
 * Mantine's stock em scale, which agrees with this one on 768 alone.
 */
export function breakpointForWidth(width: number): BlockBreakpoint {
  const tier = resolveBlockTier(width);
  const index = TIER_ORDER.indexOf(tier);
  const atLeast = (key: (typeof BREAKPOINT_KEYS)[number]): boolean =>
    index >= TIER_ORDER.indexOf(key);
  return { tier, measured: true, atLeast, below: (key) => !atLeast(key) };
}

/** `boardLayout` over a raw width — the DOM-free path, for tests and tooling. */
export function layoutForWidth(width: number): BoardLayout {
  return boardLayout(breakpointForWidth(width));
}
