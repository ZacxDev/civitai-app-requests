// Design tokens for the app chrome the `@civitai/blocks-react/ui` pack doesn't
// cover (page background, muted/meta text, the header brand mark, the empty-state
// recess, the vote pill's spacing). Every value resolves to a `@civitai/theme`
// CSS custom property (`--civitai-*`) so there are ZERO hardcoded colors and
// light/dark is driven entirely by the `[data-theme]` attribute the host sets on
// the block root (see App.tsx). The pack (Button/Card/Badge/Alert/…) is self-themed
// off the same tokens, so the hand-composed chrome reads as one system with it.
//
// Token source: `@civitai/theme@0.2.0` — imported once in main.tsx via
// `@civitai/theme/styles.css` (and also injected at runtime by the pack's
// injectBlocksStyles()). NOTE: the `--civitai-color-gray-*` ramp is theme-
// INVARIANT (not redefined under [data-theme='dark']), so it is deliberately NOT
// used for any theme-responsive surface here — only the theme-aware tokens
// (text/body/surface/surface-2/border/primary/error/success) are. And in LIGHT
// theme body == surface == surface-2, so cards are separated by BORDERS, never by
// a fill step — hence `elevate()` for any recess that must read in both themes.

import type { CSSProperties } from 'react';

/** The theme-aware `--civitai-*` tokens this app consumes (all flip with `[data-theme]`). */
export const token = {
  text: 'var(--civitai-color-text)',
  dimmed: 'var(--civitai-color-text-dimmed)',
  body: 'var(--civitai-color-body)',
  surface: 'var(--civitai-color-surface)',
  surface2: 'var(--civitai-color-surface-2)',
  border: 'var(--civitai-color-border)',
  primary: 'var(--civitai-color-primary)',
  primaryLight: 'var(--civitai-color-primary-light)',
  error: 'var(--civitai-color-error)',
  success: 'var(--civitai-color-success)',
  radius: 'var(--civitai-radius)',
  font: 'var(--civitai-font)',
} as const;

/** `--civitai-radius` (0.25rem) and its common multiples, as strings. */
export const radius = {
  sm: token.radius,
  md: `calc(${token.radius} * 2)`,
  lg: `calc(${token.radius} * 3)`,
} as const;

/**
 * A subtle, theme-agnostic elevation tint derived from the tokens: mix a little
 * `text` into `surface`. Works in BOTH themes (in light this darkens white; in
 * dark it lightens the panel) without touching the invariant gray ramp — which
 * is why we don't just use `surface-2` (identical to `body` in light mode).
 * `color-mix` is safe: the pack itself emits it (e.g. the Badge light variant).
 */
export function elevate(pct: number): string {
  return `color-mix(in srgb, var(--civitai-color-text) ${pct}%, var(--civitai-color-surface))`;
}

// ---- page scaffolding ----

/** Full-bleed page root: theme-aware background + text, fills the resizable iframe. */
export const pageStyle: CSSProperties = {
  fontFamily: token.font,
  background: token.body,
  color: token.text,
  width: '100%',
  minHeight: '100dvh',
  boxSizing: 'border-box',
};

/** Centered single-column content well with a fluid gutter and one gap scale. */
export const contentStyle: CSSProperties = {
  margin: '0 auto',
  width: '100%',
  maxWidth: 720,
  padding: 'clamp(14px, 3vw, 24px)',
  boxSizing: 'border-box',
};

// ---- shared text styles (two muted steps only; the dimmed token at full opacity) ----

/** Section / card heading. */
export const sectionTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: token.text,
  letterSpacing: '-0.005em',
};

/** Muted secondary text — the dimmed token at full opacity (crisper than opacity-stacking). */
export const mutedText: CSSProperties = { color: token.dimmed, fontSize: 13, lineHeight: 1.5 };

/** Smaller meta/caption text (author, timestamps, counters). */
export const metaText: CSSProperties = { color: token.dimmed, fontSize: 12, lineHeight: 1.45 };

/** Numeric text that shouldn't jitter as digits change (counts, char counters). */
export const tabularNums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

// ---- card surface (separated by a border, not a fill — required in light theme) ----

export const cardStyle: CSSProperties = {
  background: token.surface,
  border: `1px solid ${token.border}`,
  borderRadius: radius.md,
};

/** The tinted rounded tile that holds the header brand mark (matches the manifest `bulb` icon). */
export const brandMarkStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 38,
  height: 38,
  flexShrink: 0,
  borderRadius: radius.md,
  color: token.primary,
  background: token.primaryLight,
  border: `1px solid ${token.border}`,
};
