// Style tokens for the App Requests chrome.
//
// 🔴 CHANGED IN THE TASTE PASS: this app now runs at `brandDepth: skin`. These
// values used to resolve to the HOST's `--civitai-color-*` tokens, which meant
// the platform owned light/dark. They now resolve to the app's OWN `--ar-*`
// tokens, which `<Board>` writes inline on the block root from `./brand.ts`,
// keyed on the `[data-theme]` value the host still supplies. The host mechanism
// is unchanged — only the values behind it are ours.
//
// The consequence, stated plainly because it is the debt the skin depth
// transfers: NOTHING here flips automatically any more. Every pair below is
// asserted in both themes by `brand.test.ts` (contrast) and `theme.test.tsx`
// (the root actually carries the right values per theme).

import type { CSSProperties } from 'react';

/** The app-owned tokens. Every one is written by `paletteCssVars()` in brand.ts. */
export const token = {
  text: 'var(--ar-text)',
  dimmed: 'var(--ar-text-dim)',
  body: 'var(--ar-body)',
  surface: 'var(--ar-surface)',
  surface2: 'var(--ar-surface-2)',
  border: 'var(--ar-border)',
  borderStrong: 'var(--ar-border-strong)',
  brand: 'var(--ar-brand)',
  brandEdge: 'var(--ar-brand-edge)',
  brandText: 'var(--ar-brand-text)',
  brandOn: 'var(--ar-brand-on)',
  brandSoft: 'var(--ar-brand-soft)',
  error: 'var(--ar-danger)',
  success: 'var(--ar-success)',
  focus: 'var(--ar-focus)',
  font: 'var(--civitai-font)',
} as const;

/** Corner radii. Slightly rounder than the platform default — part of the skin. */
export const radius = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  pill: '999px',
} as const;

// ---- page scaffolding ----

/** Full-bleed page root: app-owned background + text, fills the resizable iframe. */
export const pageStyle: CSSProperties = {
  fontFamily: token.font,
  background: token.body,
  color: token.text,
  width: '100%',
  minHeight: '100dvh',
  boxSizing: 'border-box',
};

/** Centered single-column content well with a fluid gutter. */
export const contentStyle: CSSProperties = {
  margin: '0 auto',
  width: '100%',
  maxWidth: 760,
  padding: 'clamp(14px, 3vw, 24px)',
  boxSizing: 'border-box',
};

// ---- text ----

export const sectionTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 650,
  color: token.text,
  letterSpacing: '-0.005em',
};

/** Muted secondary text. */
export const mutedText: CSSProperties = { color: token.dimmed, fontSize: 13, lineHeight: 1.5 };

/** Smaller meta/caption text (author, timestamps, counters, disclosures). */
export const metaText: CSSProperties = { color: token.dimmed, fontSize: 12, lineHeight: 1.45 };

/** Numeric text that shouldn't jitter as digits change. */
export const tabularNums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

// ---- surfaces ----

export const cardStyle: CSSProperties = {
  background: token.surface,
  border: `1px solid ${token.border}`,
  borderRadius: radius.md,
};

/** A recessed well — the hero band, the menu popover, the search field. */
export const wellStyle: CSSProperties = {
  background: token.surface2,
  border: `1px solid ${token.border}`,
  borderRadius: radius.md,
};

/** The tinted rounded square that holds the brand mark. */
export const brandMarkStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: radius.md,
  color: token.brandOn,
  background: token.brand,
  border: `1px solid ${token.brandEdge}`,
};

/**
 * A visible focus ring, in app-owned colour.
 *
 * Under `skin` the browser default ring can land on a surface it does not
 * contrast with, so every interactive element this app hand-composes uses this.
 */
export const focusRing = `0 0 0 2px ${token.body}, 0 0 0 4px ${token.focus}`;
