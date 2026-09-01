// The App Requests BRAND PALETTE — app-owned, not the host's.
//
// 🔴 This app runs at `brandDepth: skin` (see taste.json). That means the app
// declares its OWN surface / border / text ramp instead of inheriting the
// platform's `--civitai-color-*` values, and therefore **owns light/dark
// correctness**. The host still tells us which theme to render, via the
// `[data-theme]` attribute it sets on the block root — that mechanism is
// unchanged; only the values behind it are ours now.
//
// Everything here is a PURE function over literal hex values so the palette is
// unit-testable: `contrastRatio()` below is a real WCAG 2.1 implementation and
// `brand.test.ts` asserts every text-on-surface pair in BOTH themes clears its
// threshold. A palette that is only eyeballed in one theme is exactly the debt
// the skin depth transfers to us.

/** The brand hue. Single source of truth — the mark, the fills and the focus ring all derive from it. */
export const BRAND_HUE = '#F09800';

export type ThemeName = 'light' | 'dark';

/**
 * The app-owned token set. Names are ROLES, never colours, so a future re-hue
 * touches this file only.
 */
export interface Palette {
  /** Page background behind every card. */
  body: string;
  /** Raised card / composer surface. */
  surface: string;
  /** Recessed surface — hero band, menu popover, input wells. */
  surface2: string;
  /** Hairline separating surfaces. */
  border: string;
  /** A heavier border for focused / hovered affordances. */
  borderStrong: string;
  /** Primary body text. */
  text: string;
  /** Secondary / meta text. Still held to 4.5:1 — "dimmed" is not licence to fail. */
  textDim: string;
  /** The brand hue as a FILL (mark, active vote pill, primary button). */
  brand: string;
  /**
   * The OUTLINE drawn around a brand-filled control.
   *
   * 🔴 Not cosmetic: `brand` (#F09800) is only 2.28:1 against white, so in LIGHT
   * theme a brand-filled button has no perceivable boundary against the page —
   * WCAG 1.4.11 wants 3:1 for a control's visual boundary. This token is a
   * darkened brand that clears it, and equals `brand` in dark theme where the
   * fill already contrasts. Measured, not guessed; asserted in `brand.test.ts`.
   */
  brandEdge: string;
  /** The brand hue as TEXT on `surface`. Necessarily different per theme. */
  brandText: string;
  /** Text/glyph colour that sits ON a `brand` fill. */
  brandOn: string;
  /** A soft brand-tinted fill (badges, the voted pill's rest state, hero band). */
  brandSoft: string;
  /** Destructive text/affordance (withdraw). */
  danger: string;
  /** Success text (posted confirmation). */
  success: string;
  /** Focus ring colour — deliberately distinct from `border`. */
  focus: string;
}

const LIGHT: Palette = {
  body: '#FFFBF4',
  surface: '#FFFFFF',
  surface2: '#FDF3E3',
  border: '#E2D5BD',
  borderStrong: '#B29A6E',
  text: '#1F1A12',
  textDim: '#655C4F',
  brand: '#F09800',
  brandEdge: '#C97F00',
  brandText: '#8A5300',
  brandOn: '#241800',
  brandSoft: '#FDF0DA',
  danger: '#A81E14',
  success: '#155F45',
  focus: '#B36F00',
};

const DARK: Palette = {
  body: '#14110C',
  surface: '#1C1813',
  surface2: '#262019',
  border: '#40362B',
  borderStrong: '#6C5C4B',
  text: '#F6F0E6',
  textDim: '#B0A392',
  brand: '#F09800',
  brandEdge: '#F09800',
  brandText: '#FFB43D',
  brandOn: '#241800',
  brandSoft: '#2E2313',
  danger: '#FF8A7E',
  success: '#5FD3A8',
  focus: '#FFB43D',
};

/** The palette for a theme. Total — an unknown/absent theme resolves to dark (the host's default). */
export function palette(theme: ThemeName | string | null | undefined): Palette {
  return theme === 'light' ? LIGHT : DARK;
}

// ---- CSS custom properties ----

/**
 * The app-owned custom properties, applied INLINE on the block root.
 *
 * Inline beats every stylesheet rule, which matters for the second half of the
 * map: the `@civitai/blocks-react/ui` pack renders Buttons/Cards/Alerts off
 * `--civitai-color-*`, so re-pointing those at our ramp is what makes the pack
 * components read as part of the skin instead of fighting it. Without that the
 * app would be two colour systems stacked.
 */
export function paletteCssVars(theme: ThemeName | string | null | undefined): Record<string, string> {
  const p = palette(theme);
  return {
    // App-owned tokens (consumed by ./theme.ts).
    '--ar-body': p.body,
    '--ar-surface': p.surface,
    '--ar-surface-2': p.surface2,
    '--ar-border': p.border,
    '--ar-border-strong': p.borderStrong,
    '--ar-text': p.text,
    '--ar-text-dim': p.textDim,
    '--ar-brand': p.brand,
    '--ar-brand-edge': p.brandEdge,
    '--ar-brand-text': p.brandText,
    '--ar-brand-on': p.brandOn,
    '--ar-brand-soft': p.brandSoft,
    '--ar-danger': p.danger,
    '--ar-success': p.success,
    '--ar-focus': p.focus,

    // Re-point the design-system pack at the app palette so pack components
    // (Button/Card/Alert/Badge/Modal/SegmentedControl) inherit the skin.
    '--civitai-color-body': p.body,
    '--civitai-color-surface': p.surface,
    '--civitai-color-surface-2': p.surface2,
    '--civitai-color-border': p.border,
    '--civitai-color-text': p.text,
    '--civitai-color-text-dimmed': p.textDim,
    '--civitai-color-primary': p.brand,
    '--civitai-color-primary-hover': p.brandText,
    '--civitai-color-primary-fg': p.brandOn,
    '--civitai-color-primary-light': p.brandSoft,
    '--civitai-color-error': p.danger,
    '--civitai-color-success': p.success,
  };
}

// ---- WCAG contrast, for real assertions ----

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parse `#rgb` / `#rrggbb` into 0-255 triples. Throws on anything else — a silent 0 would fake a pass. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const h = m[1];
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio in [1, 21]. Symmetric. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
